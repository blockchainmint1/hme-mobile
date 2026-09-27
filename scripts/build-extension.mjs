/**
 * Build the Chrome extension (extension/) from the shared wallet engine.
 *
 * Bundles src/extension/popup.tsx with esbuild (already present via Vite),
 * copies the manifest/popup.html/icon into extension/, and zips the result
 * to public/hme-wallet-extension.zip for download from the site.
 *
 * Usage: bun scripts/build-extension.mjs
 */
import { build } from "esbuild";
import { copyFileSync, mkdirSync, rmSync } from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const extDir = join(root, "extension");

rmSync(join(extDir, "dist"), { recursive: true, force: true });
mkdirSync(join(extDir, "dist"), { recursive: true });

await build({
  entryPoints: {
    popup: join(root, "src/extension/popup.tsx"),
    background: join(root, "src/extension/background.ts"),
    content: join(root, "src/extension/content.ts"),
    inpage: join(root, "src/extension/inpage.ts"),
  },
  outdir: join(extDir, "dist"),
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "chrome111",
  jsx: "automatic",
  alias: { "@": join(root, "src") },
  define: { "process.env.NODE_ENV": '"production"', "import.meta.env.VITE_DISABLE_EXCHANGE": '"true"' },
  logLevel: "info",
});

copyFileSync(join(root, "resources/hme-mark.png"), join(extDir, "icon.png"));

rmSync(join(root, "public/hme-wallet-extension.zip"), { force: true });
execSync(
  `cd "${extDir}" && nix run nixpkgs#zip -- -r "${join(root, "public/hme-wallet-extension.zip")}" .`,
  { stdio: "inherit" },
);

console.log("Extension built → public/hme-wallet-extension.zip");
