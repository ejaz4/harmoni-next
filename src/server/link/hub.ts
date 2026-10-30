import { Prisma } from "@/generated/prisma/client";
import { MAX_QUEUE, positionAt, type LinkCommand, type LinkDevice, type LinkEvent, type LinkPatch, type LinkState } from "@/lib/link";
import { db } from "../db";
import { redis, redisSubscriber } from "../redis";

// Harmoni Link's server side. Everything shared lives in Valkey, so any
// number of web instances can serve one account: its devices, which one is
// playing, the playback state, and a channel per account that carries
// events to devices whichever instance they're connected to. The only
// thing an instance keeps to itself is its own open event streams.
//
// The playback state is also saved to Postgres every few seconds, so the
// queue survives everything, and is loaded back from there when Valkey
// doesn't have it.

const LIVE_MS = 45_000; // a connected device checks in well within this
const GRACE_MS = 8_000; // how long a dropped device stays listed, in case it's back
const SAVE_AFTER_MS = 3_000;
const KEEP_S = 7 * 24 * 60 * 60; // idle accounts' live state expires; Postgres has it

const keys = (userId: string) => ({
  devices: `link:${userId}:devices`,
  active: `link:${userId}:active`,
  state: `link:${userId}:state`,
  seq: `link:${userId}:seq`,
  channel: `link:${userId}`,
});

type Send = (event: LinkEvent) => void;
interface Message {
  to?: string;
  except?: string;
  event: LinkEvent;
}

// This instance's open streams, by account and device.
const globalForLink = globalThis as unknown as { linkLocal?: Map<string, Map<string, Send>>; linkListening?: boolean; linkSaves?: Map<string, NodeJS.Timeout> };
const local = (globalForLink.linkLocal ??= new Map<string, Map<string, Send>>());
const saves = (globalForLink.linkSaves ??= new Map<string, NodeJS.Timeout>());

function listen() {
  if (globalForLink.linkListening) return;
  globalForLink.linkListening = true;
  redisSubscriber().on("message", (channel: string, raw: string) => {
    const devices = local.get(channel.slice("link:".length));
    if (!devices) return;
    let message: Message;
    try {
      message = JSON.parse(raw) as Message;
    } catch {
      return;
    }
    for (const [id, send] of devices) {
      if ((message.to && message.to !== id) || message.except === id) continue;
      send(message.event);
    }
  });
}

async function broadcast(userId: string, message: Message) {
  await redis().publish(keys(userId).channel, JSON.stringify(message));
}

async function readDevices(userId: string): Promise<LinkDevice[]> {
  const raw = await redis().hgetall(keys(userId).devices);
  return Object.values(raw).flatMap((v) => {
    try {
      return [JSON.parse(v) as LinkDevice];
    } catch {
      return [];
    }
  });
}

const live = (devices: LinkDevice[], now: number) => devices.filter((d) => d.until > now);
const isLive = (devices: LinkDevice[], id: string | null | undefined, now: number) => !!id && devices.some((d) => d.id === id && d.until > now);

async function readState(userId: string): Promise<LinkState | null> {
  const k = keys(userId);
  const raw = await redis().get(k.state);
  if (raw) return JSON.parse(raw) as LinkState;
  // Not live: the last saved queue, paused where it was left.
  const row = await db.playbackState.findUnique({ where: { userId } });
  if (!row) return null;
  const state: LinkState = {
    queue: row.queue as unknown[],
    unshuffled: (row.unshuffled as unknown[] | null) ?? null,
    index: row.index,
    shuffle: row.shuffle,
    repeat: row.repeat === "all" || row.repeat === "one" ? row.repeat : "off",
    playing: false,
    buffering: false,
    volume: 1,
    muted: false,
    positionMs: row.positionMs,
    at: row.updatedAt.getTime(),
  };
  await redis().set(k.state, JSON.stringify(state), "EX", KEEP_S, "NX");
  return state;
}

async function writeState(userId: string, state: LinkState) {
  await redis().set(keys(userId).state, JSON.stringify(state), "EX", KEEP_S);
  scheduleSave(userId);
}

// Saved a few seconds after the last change, not on every one.
function scheduleSave(userId: string) {
  if (saves.has(userId)) return;
  saves.set(
    userId,
    setTimeout(() => {
      saves.delete(userId);
      void save(userId).catch((err) => console.warn(`link: saving playback for ${userId} failed`, err));
    }, SAVE_AFTER_MS),
  );
}

async function save(userId: string) {
  const raw = await redis().get(keys(userId).state);
  if (!raw) return;
  const s = JSON.parse(raw) as LinkState;
  const data = {
    queue: s.queue.slice(0, MAX_QUEUE) as Prisma.InputJsonValue,
    unshuffled: s.unshuffled ? (s.unshuffled.slice(0, MAX_QUEUE) as Prisma.InputJsonValue) : Prisma.DbNull,
    index: s.index,
    positionMs: Math.round(positionAt(s, Date.now())),
    shuffle: s.shuffle,
    repeat: s.repeat,
  };
  await db.playbackState.upsert({ where: { userId }, create: { userId, ...data }, update: data });
}

async function devicesEvent(userId: string): Promise<LinkEvent> {
  const now = Date.now();
  const [devices, active] = await Promise.all([readDevices(userId), redis().get(keys(userId).active)]);
  return { type: "devices", now, devices: live(devices, now), active: isLive(devices, active, now) ? active : null };
}

// Drops devices that went away; if the playing one did, playback pauses
// where it was, ready for any other device to pick up.
async function sweep(userId: string) {
  const k = keys(userId);
  const now = Date.now();
  const devices = await readDevices(userId);
  const gone = devices.filter((d) => d.until <= now);
  if (!gone.length) return;
  await redis().hdel(k.devices, ...gone.map((d) => d.id));
  const active = await redis().get(k.active);
  if (active && gone.some((d) => d.id === active)) {
    await redis().del(k.active);
    const state = await readState(userId);
    if (state) {
      const paused = { ...state, positionMs: positionAt(state, now), playing: false, buffering: false, at: now };
      await writeState(userId, paused);
      await broadcast(userId, { event: { type: "state", from: active, state: paused } });
    }
  }
  await broadcast(userId, { event: await devicesEvent(userId) });
}

async function checkIn(userId: string, device: Omit<LinkDevice, "until">, until: number) {
  const k = keys(userId);
  await redis().hset(k.devices, device.id, JSON.stringify({ ...device, until }));
  await redis().expire(k.devices, KEEP_S);
}

// A device's event stream opening. Returns what to call as it stays open
// (every so often) and when it closes.
export async function connect(userId: string, device: Omit<LinkDevice, "until">, send: Send) {
  listen();
  let devices = local.get(userId);
  if (!devices) {
    local.set(userId, (devices = new Map()));
    await redisSubscriber().subscribe(keys(userId).channel);
  }
  devices.set(device.id, send);

  await sweep(userId);
  await checkIn(userId, device, Date.now() + LIVE_MS);
  const [state, event] = await Promise.all([readState(userId), devicesEvent(userId)]);
  if (event.type === "devices") send({ type: "hello", self: device.id, now: event.now, devices: event.devices, active: event.active, state });
  await broadcast(userId, { except: device.id, event });

  return {
    touch: () => checkIn(userId, device, Date.now() + LIVE_MS),
    close: async () => {
      const mine = local.get(userId);
      if (mine?.get(device.id) !== send) return; // the same device reconnected on a new stream
      mine.delete(device.id);
      if (!mine.size) {
        local.delete(userId);
        await redisSubscriber().unsubscribe(keys(userId).channel);
      }
      await checkIn(userId, device, Date.now() + GRACE_MS);
      setTimeout(() => void sweep(userId).catch(() => {}), GRACE_MS + 250);
    },
  };
}

// Patches from one device arrive in the order it sent them, or not at all.
const NEWER = `
local last = tonumber(redis.call('HGET', KEYS[1], ARGV[1]) or '-1')
if tonumber(ARGV[2]) <= last then return 0 end
redis.call('HSET', KEYS[1], ARGV[1], ARGV[2])
redis.call('EXPIRE', KEYS[1], ARGV[3])
return 1`;

// The playing device reporting its playback. Another device takes over by
// starting to play and saying so (`claim`), or when no one else is live.
// Only a device that knows it isn't the one playing claims: a report from
// the old one, sent before it heard playback moved, can't take it back.
export async function publishState(userId: string, deviceId: string, seq: number, patch: LinkPatch, claim: boolean): Promise<"ok" | "stale" | "gone" | "not-playing"> {
  const k = keys(userId);
  if (!(await redis().eval(NEWER, 1, k.seq, deviceId, String(seq), String(KEEP_S)))) return "stale";
  const now = Date.now();
  const [devices, active] = await Promise.all([readDevices(userId), redis().get(k.active)]);
  if (!isLive(devices, deviceId, now)) return "gone";
  let changed = false;
  if (active !== deviceId) {
    const activeLive = isLive(devices, active, now);
    if (activeLive && !(claim && patch.playing)) return "not-playing";
    await redis().set(k.active, deviceId, "EX", KEEP_S);
    if (activeLive) await broadcast(userId, { to: active!, event: { type: "release" } });
    changed = true;
  }
  const prev = await readState(userId);
  const { queue, unshuffled, ...rest } = patch;
  const state: LinkState = {
    ...rest,
    queue: queue ?? prev?.queue ?? [],
    unshuffled: unshuffled !== undefined ? unshuffled : (prev?.unshuffled ?? null),
    at: now,
  };
  await writeState(userId, state);
  await broadcast(userId, { except: deviceId, event: { type: "state", from: deviceId, state: { ...patch, at: now } } });
  if (changed) await broadcast(userId, { event: await devicesEvent(userId) });
  return "ok";
}

// Another device's controls, passed to the one playing.
export async function sendCommand(userId: string, from: string, command: LinkCommand): Promise<boolean> {
  const k = keys(userId);
  const [devices, active] = await Promise.all([readDevices(userId), redis().get(k.active)]);
  if (!active || active === from || !isLive(devices, active, Date.now())) return false;
  await broadcast(userId, { to: active, event: { type: "command", command } });
  return true;
}

// Moves playback to `to`: it carries on from where the queue is up to, and
// whichever device was playing stops. A device taking playback for itself
// has already started (it needs the tap to be allowed to play sound).
export async function transfer(userId: string, from: string, to: string): Promise<boolean> {
  const k = keys(userId);
  const now = Date.now();
  if (!isLive(await readDevices(userId), to, now)) return false;
  const old = await redis().set(k.active, to, "EX", KEEP_S, "GET");
  let state = await readState(userId);
  if (state) {
    state = { ...state, positionMs: positionAt(state, now), at: now };
    await writeState(userId, state);
  }
  if (old && old !== to) await broadcast(userId, { to: old, event: { type: "release" } });
  if (to !== from) await broadcast(userId, { to, event: { type: "transfer", state, play: state?.playing ?? false } });
  await broadcast(userId, { event: await devicesEvent(userId) });
  return true;
}
