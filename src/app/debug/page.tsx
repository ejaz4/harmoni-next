"use client";

import { useRef, useState } from "react";
import type { ProviderStatus, SearchEvent, SongResult } from "@/server/search/service";
import { LyricsPanel } from "./lyrics-panel";

interface SearchState {
  providers: { prefix: string; name: string; status?: ProviderStatus }[];
  results: SongResult[];
  tookMs?: number;
}

// Developer page: raw search results with every source, for debugging matching.
export default function SearchTestPage() {
  const [query, setQuery] = useState("");
  const [data, setData] = useState<SearchState>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);
  const inFlight = useRef<AbortController>(undefined);
  const [playing, setPlaying] = useState<SongResult>();
  const [playerStatus, setPlayerStatus] = useState("");
  const audioRef = useRef<HTMLAudioElement>(null);

  async function search(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;
    inFlight.current?.abort();
    const controller = (inFlight.current = new AbortController());
    setLoading(true);
    setError(undefined);
    setData(undefined);
    try {
      const res = await fetch(`/api/search?stream=1&q=${encodeURIComponent(query)}`, {
        signal: controller.signal,
      });
      if (!res.ok || !res.body) throw new Error((await res.json()).error ?? `HTTP ${res.status}`);
      for await (const event of readEvents(res.body)) applyEvent(event);
    } catch (err) {
      if (!controller.signal.aborted) setError(String(err));
    } finally {
      if (inFlight.current === controller) setLoading(false);
    }
  }

  function applyEvent(event: SearchEvent | { type: "error"; error: string }) {
    switch (event.type) {
      case "start":
        return setData({ providers: event.providers, results: [] });
      case "provider":
        return setData((d) => d && {
          providers: d.providers.map((p) => (p.prefix === event.status.prefix ? { ...p, status: event.status } : p)),
          results: event.results,
        });
      case "done":
        return setData((d) => d && { ...d, tookMs: event.tookMs });
      case "error":
        return setError(event.error);
    }
  }

  return (
    <main>
      <h1>Harmoni search test</h1>
      <form onSubmit={search}>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="justin bieber baby"
          size={40}
          autoFocus
        />{" "}
        <button disabled={loading}>{loading ? "Searching…" : "Search"}</button>
      </form>

      {playing && (
        <div>
          <strong>{playing.title}</strong> — {playing.artists.map((a) => a.name).join(", ")} <small>{playerStatus}</small>
          <br />
          <audio
            ref={audioRef}
            key={playing.id}
            src={`/api/play/${playing.id}`}
            controls
            autoPlay
            style={{ width: "100%" }}
            onWaiting={() => setPlayerStatus("buffering…")}
            onPlaying={() => setPlayerStatus("playing")}
            onPause={() => setPlayerStatus("paused")}
            onEnded={() => setPlayerStatus("ended")}
            onError={async () => {
              // The audio element hides the server's reason, so ask for it.
              const res = await fetch(`/api/play/${playing.id}`, { method: "GET" });
              const body = res.ok ? undefined : await res.json().catch(() => undefined);
              setPlayerStatus(`couldn't play: ${body?.error ?? "unknown error"} ${body?.attempts?.join("; ") ?? ""}`);
            }}
          />
          <LyricsPanel key={playing.id} songId={playing.id} audioRef={audioRef} />
        </div>
      )}

      {error && <p style={{ color: "crimson" }}>{error}</p>}

      {data && (
        <>
          <p>
            {data.results.length} songs{data.tookMs !== undefined && ` in ${data.tookMs} ms`} ·{" "}
            {data.providers.map(({ prefix, status }) => (
              <span key={prefix} title={status?.error} style={{ color: status && !status.ok ? "crimson" : undefined }}>
                {prefix}:{" "}
                {!status ? "waiting…" : status.ok ? `${status.count} results (${status.ms} ms)` : `failed (${status.ms} ms)`}{" "}
              </span>
            ))}
          </p>
          <ol>
            {data.results.map((song) => (
              <li key={song.id} style={{ marginBottom: 12 }}>
                {song.artworkUrl && (
                  // eslint-disable-next-line @next/next/no-img-element -- test page
                  <img src={song.artworkUrl} alt="" width={48} height={48} style={{ float: "left", marginRight: 8 }} />
                )}
                <button
                  onClick={() => {
                    setPlayerStatus("resolving…");
                    setPlaying(song);
                  }}
                >
                  ▶
                </button>{" "}
                <strong>{song.title}</strong> —{" "}
                {song.artists.map((a) => (a.role === "featured" ? `feat. ${a.name}` : a.name)).join(", ")}
                {song.explicit && " 🅴"}
                <br />
                <small>
                  {song.album?.title ?? "No album"} · {formatDuration(song.durationMs)} · ISRC{" "}
                  {song.isrc ?? "unknown"} · <code>{song.id}</code>
                </small>
                <ul style={{ clear: "both" }}>
                  {song.sources.map((s) => (
                    <li key={s.uri}>
                      <code>{s.uri}</code> {s.matchedBy}
                      {s.matchedBy !== "origin" && ` (${s.confidence.toFixed(2)})`}
                      {s.playable ? " · playable" : ""} · <small>&ldquo;{s.rawTitle}&rdquo;</small>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
        </>
      )}
    </main>
  );
}

async function* readEvents(body: ReadableStream<Uint8Array>) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop()!;
    for (const line of lines) if (line.trim()) yield JSON.parse(line);
  }
}

function formatDuration(ms?: number) {
  if (!ms) return "?:??";
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
