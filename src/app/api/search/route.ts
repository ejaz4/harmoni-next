import { findSearchSpice } from "@/server/discovery/spice";
import { searchSongs, searchSongsStream, type SearchEvent } from "@/server/search/service";
import { withUser } from "@/server/session";

// ?stream=1 returns NDJSON SearchEvents as each provider answers;
// otherwise one JSON response once every provider is done.
export const GET = withUser(async (request) => {
  const url = new URL(request.url);
  const query = url.searchParams.get("q")?.trim();
  if (!query) {
    return Response.json({ error: "Missing ?q= parameter" }, { status: 400 });
  }
  if (url.searchParams.get("stream") !== "1") {
    return Response.json(await searchSongs(query));
  }

  const events = withSpice(query, searchSongsStream(query));
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { value, done } = await events.next();
        if (done) controller.close();
        else controller.enqueue(encoder.encode(JSON.stringify(value) + "\n"));
      } catch (err) {
        console.error("search stream failed", err);
        controller.enqueue(encoder.encode(JSON.stringify({ type: "error", error: String(err) }) + "\n"));
        controller.close();
      }
    },
    async cancel() {
      await events.return(undefined);
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-cache" },
  });
});

const SPICE_WAIT_MS = 3000;

// Songs as providers answer, with the search's Spice (if it has one) slipped
// in as soon as it's known: it never holds the songs up.
async function* withSpice(query: string, events: AsyncGenerator<SearchEvent>): AsyncGenerator<SearchEvent> {
  let found: SearchEvent | null | undefined; // undefined while still looking
  const spice = findSearchSpice(query).then(
    (card) => (found = card ? { type: "spice", spice: card } : null),
    (err) => {
      console.warn(`search: finding a Spice for "${query}" failed`, err);
      return (found = null);
    },
  );
  let sent = false;
  try {
    for await (const event of events) {
      yield event;
      if (!sent && found !== undefined) {
        sent = true;
        if (found) yield found;
      }
    }
    if (!sent) {
      const late = await Promise.race([spice, new Promise<null>((r) => setTimeout(() => r(null), SPICE_WAIT_MS))]);
      if (late) yield late;
    }
  } finally {
    await events.return(undefined);
  }
}
