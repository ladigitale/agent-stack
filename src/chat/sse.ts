/**
 * Minimal Server-Sent Events parser over a fetch body (POST-friendly, unlike EventSource).
 * Yields the `data` payload of each event (multi-line data joined with "\n").
 */
export async function* readSseData(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let sep: number;
      while ((sep = indexOfEventEnd(buffer)) >= 0) {
        const raw = buffer.slice(0, sep);
        buffer = buffer.slice(sep).replace(/^(\r?\n){2}/, "");
        const data = dataOf(raw);
        if (data !== null) yield data;
      }
    }
    buffer += decoder.decode();
    const tail = dataOf(buffer);
    if (tail !== null) yield tail;
  } finally {
    reader.releaseLock();
  }
}

function indexOfEventEnd(buffer: string): number {
  const m = /\r?\n\r?\n/.exec(buffer);
  return m ? m.index : -1;
}

function dataOf(raw: string): string | null {
  const lines = raw.split(/\r?\n/).filter((l) => l.startsWith("data:"));
  if (!lines.length) return null;
  return lines.map((l) => l.slice(5).replace(/^ /, "")).join("\n");
}
