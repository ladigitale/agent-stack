import { defineConfig } from "vitest/config";
import { decoratorsTransformOptions } from "@supersoniks/concorde/vite-config";

// Concorde ships TypeScript sources with legacy decorators: force the matching
// Oxc options (legacy decorators, [[Set]] class fields) for every transformed
// file, node_modules included.
export default defineConfig({
  oxc: decoratorsTransformOptions,
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./test/setup.ts"],
    server: { deps: { inline: ["@supersoniks/concorde"] } },
  },
});
