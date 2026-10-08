import { defineConfig } from "vite";

// Demo app (yarn dev). Concorde ships TypeScript sources with legacy decorators.
export default defineConfig({
  root: "demo",
  build: {
    outDir: "../dist-demo",
    emptyOutDir: true,
    rollupOptions: { input: { index: "demo/index.html", live: "demo/live.html" } },
  },
  esbuild: {
    tsconfigRaw: {
      compilerOptions: { experimentalDecorators: true, useDefineForClassFields: false },
    },
  },
});
