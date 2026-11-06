"use client";

import { useEffect, useState } from "react";
import type { SongResult } from "@/server/library/song-view";
import type { SearchEvent } from "@/server/search/service";

// /api/search?stream=1 answers in NDJSON, an event per line.
export async function* readEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<SearchEvent> {
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

// Songs for what's typed, filling in as each provider answers. The last
// results stay up while the next search is on its way.
export function useSongSearch(query: string, delayMs = 300): { results: SongResult[]; searching: boolean } {
  const q = query.trim();
  const [state, setState] = useState<{ query: string; results: SongResult[]; done: boolean }>();

  useEffect(() => {
    if (!q) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?stream=1&q=${encodeURIComponent(q)}`, { signal: controller.signal });
        if (!res.ok || !res.body) throw new Error(`Search failed (${res.status})`);
        for await (const event of readEvents(res.body)) {
          if (event.type === "provider") setState({ query: q, results: event.results, done: false });
          else if (event.type === "done") setState((s) => ({ query: q, results: s?.query === q ? s.results : [], done: true }));
        }
      } catch {
        if (!controller.signal.aborted) setState({ query: q, results: [], done: true });
      }
    }, delayMs);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [q, delayMs]);

  if (!q) return { results: [], searching: false };
  return { results: state?.results ?? [], searching: !(state?.query === q && state.done) };
}
