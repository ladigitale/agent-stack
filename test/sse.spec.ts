import { readSseData } from "../src/chat/sse";

function streamOf(chunks: string[]) {
  const enc = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(c) {
      for (const ch of chunks) c.enqueue(enc.encode(ch));
      c.close();
    },
  });
}

it("reassembles events split across chunks", async () => {
  const out: string[] = [];
  for await (const d of readSseData(streamOf(['data: {"a"', ':1}\n\nevent: x\ndata: two\ndata: lines\n\n', ": comment\n\n", 'data: {"b":2}']))) out.push(d);
  expect(out).toEqual(['{"a":1}', "two\nlines", '{"b":2}']);
});

it("handles CRLF framing", async () => {
  const out: string[] = [];
  for await (const d of readSseData(streamOf(["data: 1\r\n\r\ndata: 2\r\n\r\n"]))) out.push(d);
  expect(out).toEqual(["1", "2"]);
});
