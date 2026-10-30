"use client";

import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { describeDevice, type DeviceKind, type LinkCommand, type LinkDevice, type LinkEvent, type LinkPatch, type LinkState } from "@/lib/link";

// Harmoni Link on this device: its identity, its event stream from the
// server, and what it knows about the account's other devices and their
// playback. The player (./player) decides what to do with it.

const ID_KEY = "harmoni:device"; // per tab, so two tabs are two devices
const NAME_KEY = "harmoni:device-name"; // per browser, set in Settings
const RENAMED = "harmoni:device-renamed";
const RETRY_MS = [2000, 5000, 10_000, 30_000];

function deviceId(): string {
  try {
    let id = sessionStorage.getItem(ID_KEY);
    if (!id) {
      id = crypto.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
      sessionStorage.setItem(ID_KEY, id);
    }
    return id;
  } catch {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  }
}

export function deviceIdentity(): { name: string; kind: DeviceKind; custom: boolean } {
  const auto = describeDevice();
  try {
    const custom = localStorage.getItem(NAME_KEY)?.trim();
    if (custom) return { ...auto, name: custom, custom: true };
  } catch {}
  return { ...auto, custom: false };
}

export function renameDevice(name: string) {
  try {
    if (name.trim()) localStorage.setItem(NAME_KEY, name.trim().slice(0, 60));
    else localStorage.removeItem(NAME_KEY);
  } catch {}
  window.dispatchEvent(new Event(RENAMED));
}

export interface LinkHandlers {
  onHello(event: Extract<LinkEvent, { type: "hello" }>): void;
  onCommand(command: LinkCommand): void;
  onTransfer(state: LinkState | null, play: boolean): void;
  onRelease(): void;
  // The device that was playing went away while this one was its remote.
  onOrphaned(state: LinkState): void;
}

export interface LinkConnection {
  connected: boolean;
  self: string;
  devices: LinkDevice[]; // online now, this one included
  active: string | null; // the device playing (or last told to), if it's online
  state: LinkState | null; // the account's playback, as last heard
  offset: number; // server clock minus this one's
  publish(patch: LinkPatch, claim: boolean): Promise<string | undefined>;
  command(command: LinkCommand): Promise<boolean>;
  transfer(to: string): Promise<boolean>;
  // Applies a change to `state` ahead of the playing device confirming it.
  nudge(patch: Partial<LinkState>): void;
}

interface Known {
  connected: boolean;
  self: string;
  devices: LinkDevice[];
  active: string | null;
  state: LinkState | null;
  offset: number;
}

async function post(body: object): Promise<Response | undefined> {
  try {
    return await fetch("/api/link", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  } catch {
    return undefined;
  }
}

export function useLinkConnection(handlers: LinkHandlers, enabled: boolean): LinkConnection {
  const [known, setKnown] = useState<Known>({ connected: false, self: "", devices: [], active: null, state: null, offset: 0 });
  const knownRef = useRef(known);
  const handlersRef = useRef(handlers);
  useLayoutEffect(() => {
    knownRef.current = known;
    handlersRef.current = handlers;
  });
  const seq = useRef(0);
  // Devices drop off the list when their time's up, even if no one says so:
  // the clock they're checked against, moved on every few seconds.
  const [clock, setClock] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    const self = deviceId();
    let source: EventSource | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let failures = 0;
    let closed = false;

    const open = () => {
      const { name, kind } = deviceIdentity();
      source = new EventSource(`/api/link?${new URLSearchParams({ device: self, name, kind })}`);
      source.onopen = () => (failures = 0);
      source.onmessage = (message) => {
        let event: LinkEvent;
        try {
          event = JSON.parse(message.data) as LinkEvent;
        } catch {
          return;
        }
        receive(event);
      };
      source.onerror = () => {
        setKnown((k) => ({ ...k, connected: false }));
        // EventSource retries dropped connections itself; one the server refused stays closed.
        if (source?.readyState === EventSource.CLOSED && !closed) {
          retry = setTimeout(open, RETRY_MS[Math.min(failures++, RETRY_MS.length - 1)]);
        }
      };
    };

    const receive = (event: LinkEvent) => {
      const h = handlersRef.current;
      switch (event.type) {
        case "hello": {
          const offset = event.now - Date.now();
          setClock(Date.now());
          const next = { connected: true, self: event.self, devices: event.devices, active: event.active, state: event.state, offset };
          knownRef.current = next;
          setKnown(next);
          h.onHello(event);
          break;
        }
        case "devices": {
          setClock(Date.now());
          const before = knownRef.current;
          const offset = event.now - Date.now();
          const wasRemote = !!before.active && before.active !== before.self;
          setKnown((k) => ({ ...k, devices: event.devices, active: event.active, offset }));
          if (wasRemote && !event.active && before.state) h.onOrphaned(before.state);
          break;
        }
        case "state":
          setKnown((k) => ({ ...k, state: merge(k.state, event.state) }));
          break;
        case "command":
          h.onCommand(event.command);
          break;
        case "transfer":
          setKnown((k) => ({ ...k, active: k.self, state: event.state ?? k.state }));
          h.onTransfer(event.state, event.play);
          break;
        case "release":
          h.onRelease();
          break;
      }
    };

    const rename = () => {
      source?.close();
      open();
    };
    open();
    window.addEventListener(RENAMED, rename);
    const ticker = setInterval(() => setClock(Date.now()), 5000);
    return () => {
      closed = true;
      clearTimeout(retry);
      clearInterval(ticker);
      window.removeEventListener(RENAMED, rename);
      source?.close();
    };
  }, [enabled]);

  const publish = useCallback(async (patch: LinkPatch, claim: boolean) => {
    const k = knownRef.current;
    if (!k.connected) return undefined;
    seq.current = Math.max(seq.current + 1, Date.now());
    const res = await post({ action: "state", device: k.self, seq: seq.current, claim, patch });
    if (!res) return undefined;
    return ((await res.json().catch(() => ({}))) as { result?: string }).result;
  }, []);

  const command = useCallback(async (c: LinkCommand) => (await post({ action: "command", device: knownRef.current.self, command: c }))?.ok ?? false, []);
  const transfer = useCallback(async (to: string) => (await post({ action: "transfer", device: knownRef.current.self, to }))?.ok ?? false, []);
  const nudge = useCallback((patch: Partial<LinkState>) => setKnown((k) => (k.state ? { ...k, state: { ...k.state, ...patch } } : k)), []);

  const { devices: all, offset } = known;
  const devices = useMemo(() => all.filter((d) => d.until > clock + offset), [all, offset, clock]);
  const active = known.active && devices.some((d) => d.id === known.active) ? known.active : null;
  return { ...known, devices, active, publish, command, transfer, nudge };
}

function merge(state: LinkState | null, patch: Partial<LinkState> & { at: number }): LinkState | null {
  if (!state) return patch.queue ? ({ unshuffled: null, ...patch } as LinkState) : null;
  return { ...state, ...patch, queue: patch.queue ?? state.queue, unshuffled: patch.unshuffled !== undefined ? patch.unshuffled : state.unshuffled };
}

// --- For the UI: the device list and picker ---

export interface LinkInfo {
  connected: boolean;
  self: string;
  devices: LinkDevice[];
  active: string | null;
  // Playback is on another device; this one's controls drive that one.
  remote: LinkDevice | null;
  transfer(to: string): void;
}

const LinkContext = createContext<LinkInfo>({ connected: false, self: "", devices: [], active: null, remote: null, transfer: () => {} });
export const LinkProvider = LinkContext;

export function useLink(): LinkInfo {
  return useContext(LinkContext);
}

export function useLinkInfo(link: LinkConnection, transfer: (to: string) => void): LinkInfo {
  const { connected, self, devices, active } = link;
  return useMemo(() => {
    const remote = active && active !== self ? (devices.find((d) => d.id === active) ?? null) : null;
    return { connected, self, devices, active, remote, transfer };
  }, [connected, self, devices, active, transfer]);
}
