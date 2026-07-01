// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, nitro (build-only using cloudflare as a default target),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
    // Capacitor needs a static index.html entry point. The built-in TanStack
    // SPA prerender currently looks for dist/server/server.js, while Nitro emits
    // dist/server/index.mjs in this project. Keep framework prerender disabled
    // and generate the native webview shell in scripts/generate-capacitor-index.mjs.
    spa: {
      enabled: false,
    },
    prerender: { enabled: false },
  },
});
