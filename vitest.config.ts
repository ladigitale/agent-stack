import { defineConfig } from "vitest/config";

// Concorde ships TypeScript sources with legacy decorators: force the
// matching compiler options for every transformed file, node_modules included.
export default defineConfig({
  esbuild: {
    tsconfigRaw: {
      compilerOptions: { experimentalDecorators: true, useDefineForClassFields: false },
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./test/setup.ts"],
    server: { deps: { inline: ["@supersoniks/concorde"] } },
  },
});
