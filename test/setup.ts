/**
 * Concorde's PublisherProxy expects CompressionStream on window (localStorage cache),
 * which jsdom does not provide. Same workaround as Concorde's own vitest.setup.ts.
 */
import { CompressionStream, DecompressionStream } from "node:stream/web";

const g = globalThis as Record<string, unknown>;
for (const target of [g, g.window as Record<string, unknown> | undefined]) {
  if (!target) continue;
  target.CompressionStream ??= CompressionStream;
  target.DecompressionStream ??= DecompressionStream;
}

afterEach(async () => {
  await new Promise((r) => setTimeout(r, 0));
});
