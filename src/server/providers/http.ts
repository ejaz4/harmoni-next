export class HttpStatusError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

// Streams a URL in ranged chunks. Some CDNs (googlevideo) answer ranged
// requests immediately but throttle a single whole-file request.
// The first chunk is fetched before returning, so a dead URL fails here.
export async function rangedStream(
  url: string,
  headers: Record<string, string>,
  chunkSize = 1 << 20,
): Promise<{ body: ReadableStream<Uint8Array>; total?: number }> {
  const fetchChunk = async (offset: number) => {
    const res = await fetch(url, {
      headers: { ...headers, Range: `bytes=${offset}-${offset + chunkSize - 1}` },
    });
    if (res.status !== 206 && res.status !== 200) {
      throw new HttpStatusError(res.status, `HTTP ${res.status} fetching bytes from ${offset}`);
    }
    const total = Number(res.headers.get("content-range")?.split("/")[1]) || undefined;
    // A 200 means the server ignored the range and sent everything.
    return { data: new Uint8Array(await res.arrayBuffer()), total, whole: res.status === 200 };
  };

  const first = await fetchChunk(0);
  let offset = first.data.byteLength;
  const total = first.whole ? first.data.byteLength : first.total;

  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(first.data);
      if (first.whole || (total !== undefined && offset >= total)) controller.close();
    },
    async pull(controller) {
      const chunk = await fetchChunk(offset);
      offset += chunk.data.byteLength;
      if (chunk.data.byteLength) controller.enqueue(chunk.data);
      if (!chunk.data.byteLength || (total !== undefined && offset >= total)) controller.close();
    },
  });
  return { body, total };
}
