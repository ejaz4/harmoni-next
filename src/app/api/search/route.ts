import type { NextRequest } from "next/server";
import { searchSongs, searchSongsStream } from "@/server/search/service";

// ?stream=1 returns NDJSON SearchEvents as each provider answers;
// otherwise one JSON response once every provider is done.
export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get("q")?.trim();
  if (!query) {
    return Response.json({ error: "Missing ?q= parameter" }, { status: 400 });
  }
  if (request.nextUrl.searchParams.get("stream") !== "1") {
    return Response.json(await searchSongs(query));
  }

  const events = searchSongsStream(query);
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
}
