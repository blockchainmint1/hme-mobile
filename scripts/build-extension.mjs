/**
 * Build the Chrome extension (extension/) from the SAME wallet app the phone
 * uses. Steps:
 *   1. esbuild: background/content/inpage workers + the approval window
 *      (src/extension/popup.tsx → approve.html).
 *   2. vite build: the full wallet app (every chain, settings, profiles…).
 *   3. Render the SPA shell, move every inline <script> into a file (MV3
 *      forbids inline scripts), copy the app assets into extension/.
 *   4. Zip to public/hme-wallet-extension.zip.
 *
 * Usage: bun scripts/build-extension.mjs   (add --skip-vite to reuse dist/)
 */
import { build } from "esbuild";
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const extDir = join(root, "extension");

// Clean previous generated output (keep hand-written manifest/approve.html).
for (const name of ["dist", "assets", "app-boot", "popup.html", "index.html"]) {
  rmSync(join(extDir, name), { recursive: true, force: true });
}
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

if (!process.argv.includes("--skip-vite")) {
  execSync("bunx vite build", { cwd: root, stdio: "inherit" });
}

const clientDir = [join(root, "dist/client"), join(root, ".output/public")].find(existsSync);
const serverEntry = [join(root, "dist/server/index.mjs"), join(root, ".output/server/index.mjs")].find(existsSync);
if (!clientDir || !serverEntry) throw new Error("vite build output not found");

const serverModule = await import(pathToFileURL(serverEntry).href + `?t=${Date.now()}`);
const server = serverModule.default ?? serverModule;
const res = await server.fetch(
  new Request("http://localhost/", { headers: { "X-TSS_SHELL": "true" } }),
  {},
  { waitUntil() {} },
);
if (!res.ok) throw new Error(`Shell render failed: HTTP ${res.status}`);
let html = await res.text();

// Copy the app's static files (assets/, icons…) into the extension root.
for (const entry of readdirSync(clientDir)) {
  if (entry === "index.html" || entry.endsWith(".zip") || entry.endsWith(".apk")) continue;
  cpSync(join(clientDir, entry), join(extDir, entry), { recursive: true, force: true });
}

// Externalise inline scripts (MV3 CSP: script-src 'self').
mkdirSync(join(extDir, "app-boot"), { recursive: true });
let n = 0;
html = html.replace(/<script\b([^>]*)>([\s\S]*?)<\/script>/g, (full, attrs, body) => {
  if (/\bsrc=/.test(attrs) || !body.trim()) return full;
  if (/type="application\/(ld\+)?json"/.test(attrs)) return full;
  const file = `app-boot/s${n++}.js`;
  writeFileSync(join(extDir, file), body);
  return `<script${attrs} src="/${file}"></script>`;
});

// Boot: make the router see "/" whatever file Chrome opened, size the popup,
// and add an "Open in tab" button when shown as the small toolbar popup.
writeFileSync(
  join(extDir, "app-boot/ext.js"),
  `(function(){
  if (location.pathname !== "/") history.replaceState(null, "", "/" + location.search + location.hash);
  var popup = !/[?&]tab=1/.test(location.search) && window.outerWidth < 500;
  if (popup) document.documentElement.classList.add("hm-ext-popup");
  window.addEventListener("load", function(){
    if (!popup) return;
    setTimeout(function(){
      var b = document.createElement("button");
      b.textContent = "Open in tab \\u2197";
      b.title = "Open the wallet in a full browser tab";
      b.setAttribute("style","position:fixed;right:8px;bottom:8px;z-index:9999;font:12px system-ui;padding:4px 8px;border-radius:999px;border:1px solid rgba(128,128,128,.4);background:rgba(20,16,11,.85);color:#f5efe6;cursor:pointer");
      b.onclick = function(){ chrome.tabs.create({ url: chrome.runtime.getURL("index.html?tab=1") }); window.close(); };
      document.body.appendChild(b);
    }, 800);
  });
})();`,
);
html = html.replace(
  /<head([^>]*)>/,
  `<head$1><script src="/app-boot/ext.js"></script><style>html.hm-ext-popup,html.hm-ext-popup body{width:380px;height:600px}</style>`,
);

writeFileSync(join(extDir, "popup.html"), html);
writeFileSync(join(extDir, "index.html"), html);

// Sanity: every referenced asset must exist.
const missing = [...html.matchAll(/(?:href|src)="(\/[^"]+)"/g)]
  .map((m) => m[1].split("?")[0])
  .filter((p) => /^\/(assets|app-boot)\//.test(p) && !existsSync(join(extDir, p.slice(1))));
if (missing.length) throw new Error("Extension shell references missing files:\n  " + missing.join("\n  "));

copyFileSync(join(root, "resources/hme-mark.png"), join(extDir, "icon.png"));

rmSync(join(root, "public/hme-wallet-extension.zip"), { force: true });
execSync(
  `cd "${extDir}" && nix run nixpkgs#zip -- -qr "${join(root, "public/hme-wallet-extension.zip")}" .`,
  { stdio: "inherit" },
);
console.log("Extension built → public/hme-wallet-extension.zip");
