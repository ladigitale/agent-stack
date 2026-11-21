import { defineConfig } from "vite";
import { decoratorsGuardPlugin, decoratorsTransformOptions } from "@supersoniks/concorde/vite-config";

// Demo app (yarn dev). Concorde ships TypeScript sources with legacy decorators:
// Vite 8 (Oxc) only lowers them, with [[Set]] class fields, when told to — for
// node_modules too. The guard fails the build on a raw decorator or on a class
// field that hides a decorated accessor.
export default defineConfig({
  root: "demo",
  plugins: [decoratorsGuardPlugin()],
  oxc: decoratorsTransformOptions,
  optimizeDeps: { rolldownOptions: { transform: decoratorsTransformOptions } },
  build: {
    outDir: "../dist-demo",
    emptyOutDir: true,
    rolldownOptions: { input: { index: "demo/index.html", live: "demo/live.html" } },
  },
});
