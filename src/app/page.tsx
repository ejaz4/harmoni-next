"use client";

import { useState } from "react";
import type { SearchResponse } from "@/server/search/service";

// Bare test page for the search pipeline. Not the real UI.
export default function SearchTestPage() {
  const [query, setQuery] = useState("");
  const [data, setData] = useState<SearchResponse>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);

  async function search(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;
    setLoading(true);
    setError(undefined);
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setData(body);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
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

      {error && <p style={{ color: "crimson" }}>{error}</p>}

      {data && (
        <>
          <p>
            {data.results.length} songs in {data.tookMs} ms ·{" "}
            {data.providers.map((p) => (
              <span key={p.prefix} title={p.error} style={{ color: p.ok ? undefined : "crimson" }}>
                {p.prefix}: {p.ok ? `${p.count} results` : "failed"} ({p.ms} ms){" "}
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

function formatDuration(ms?: number) {
  if (!ms) return "?:??";
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
