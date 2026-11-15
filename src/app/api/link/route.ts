import { MAX_QUEUE, type DeviceKind, type LinkCommand, type LinkEvent, type LinkPatch } from "@/lib/link";
import { connect, ping, publishState, sendCommand, transfer } from "@/server/link/hub";
import { withUser } from "@/server/session";
import { getServerSettings } from "@/server/settings";

const linkOff = async () => !(await getServerSettings()).features.link;
const OFF = () => Response.json({ error: "Harmoni Link is off on this server." }, { status: 403 });

// Harmoni Link. GET is a device's event stream (Server-Sent Events): who's
// online, what's playing where, and commands for it. POST is everything a
// device says: its playback, controls for another device, moving playback.

// Devices treat a stream that's gone quiet for a few of these as dead.
const PING_MS = 15_000;
const DEVICE_ID = /^[A-Za-z0-9_-]{8,64}$/;
const KINDS: DeviceKind[] = ["phone", "tablet", "computer"];

export const GET = withUser(async (request, user) => {
  if (await linkOff()) return OFF();
  const url = new URL(request.url);
  const id = url.searchParams.get("device") ?? "";
  const name = (url.searchParams.get("name") ?? "").trim().slice(0, 60);
  const kind = url.searchParams.get("kind") as DeviceKind;
  if (!DEVICE_ID.test(id) || !name || !KINDS.includes(kind)) return Response.json({ error: "Bad device" }, { status: 400 });

  const encoder = new TextEncoder();
  let stop: (() => void) | undefined;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let open = true;
      const write = (text: string) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(text));
        } catch {
          // Gone without telling us: stop, or it stays listed (and touched) forever.
          stop?.();
          open = false;
        }
      };
      const send = (event: LinkEvent) => write(`data: ${JSON.stringify(event)}\n\n`);
      write("retry: 2000\n\n");
      let link: Awaited<ReturnType<typeof connect>>;
      try {
        link = await connect(user.id, { id, name, kind }, send);
      } catch (err) {
        // Valkey hiccuped: end the stream so the device tries again.
        console.warn("link: connecting a device failed", err);
        open = false;
        try {
          controller.close();
        } catch {}
        return;
      }
      // Each ping also keeps the device listed, and carries enough for it to
      // notice it missed something.
      const keepalive = setInterval(() => {
        void link
          .touch()
          .then(() => ping(user.id))
          .then(send)
          .catch(() => write(": still here\n\n"));
      }, PING_MS);
      // Once: the stream closing and the request aborting can both call it.
      stop = () => {
        open = false;
        clearInterval(keepalive);
        stop = undefined;
        void link.close().catch(() => {});
        try {
          controller.close();
        } catch {}
      };
      request.signal.addEventListener("abort", () => stop?.());
      if (request.signal.aborted || !open) stop();
    },
    cancel() {
      stop?.();
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      // no-transform: compression would hold events back until the buffer fills.
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
});

type Body =
  | { action: "state"; device: string; seq: number; claim?: boolean; patch: LinkPatch }
  | { action: "command"; device: string; command: LinkCommand }
  | { action: "transfer"; device: string; to: string };

export const POST = withUser(async (request, user) => {
  if (await linkOff()) return OFF();
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return Response.json({ error: "Bad JSON" }, { status: 400 });
  }
  if (!body || typeof body.device !== "string" || !DEVICE_ID.test(body.device)) return Response.json({ error: "Bad device" }, { status: 400 });

  if (body.action === "state") {
    const p = body.patch;
    const valid =
      p &&
      typeof body.seq === "number" &&
      Number.isInteger(p.index) &&
      typeof p.playing === "boolean" &&
      typeof p.positionMs === "number" &&
      (p.queue === undefined || (Array.isArray(p.queue) && p.queue.length <= MAX_QUEUE)) &&
      (p.unshuffled === undefined || p.unshuffled === null || (Array.isArray(p.unshuffled) && p.unshuffled.length <= MAX_QUEUE));
    if (!valid) return Response.json({ error: "Bad state" }, { status: 400 });
    const patch: LinkPatch = {
      index: p.index,
      shuffle: !!p.shuffle,
      repeat: p.repeat === "all" || p.repeat === "one" ? p.repeat : "off",
      playing: p.playing,
      buffering: !!p.buffering,
      error: typeof p.error === "string" ? p.error.slice(0, 200) : null,
      volume: Math.min(1, Math.max(0, Number(p.volume) || 0)),
      muted: !!p.muted,
      positionMs: Math.max(0, p.positionMs),
      durationMs: typeof p.durationMs === "number" ? p.durationMs : null,
      ...(p.queue !== undefined && { queue: p.queue }),
      ...(p.unshuffled !== undefined && { unshuffled: p.unshuffled }),
    };
    const { result, rev } = await publishState(user.id, body.device, body.seq, patch, !!body.claim);
    return Response.json({ result, rev }, { status: result === "gone" ? 409 : 200 });
  }

  if (body.action === "command") {
    if (!body.command || typeof body.command.type !== "string") return Response.json({ error: "Bad command" }, { status: 400 });
    const sent = await sendCommand(user.id, body.device, body.command);
    return Response.json({ sent }, { status: sent ? 200 : 409 });
  }

  if (body.action === "transfer") {
    if (typeof body.to !== "string" || !DEVICE_ID.test(body.to)) return Response.json({ error: "Bad device" }, { status: 400 });
    const moved = await transfer(user.id, body.device, body.to);
    return Response.json({ moved }, { status: moved ? 200 : 409 });
  }

  return Response.json({ error: "Unknown action" }, { status: 400 });
});
