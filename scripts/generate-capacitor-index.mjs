import { cp, mkdir, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const capacitorWebDir = resolve(root, "dist/client");
const iosWebDir = resolve(root, "ios/App/App/public");
const iosConfigPath = resolve(root, "ios/App/App/capacitor.config.json");
const publicCandidates = [resolve(root, "dist/client"), resolve(root, ".output/public")];
const serverCandidates = [resolve(root, "dist/server/index.mjs"), resolve(root, ".output/server/index.mjs")];
const staticSpaRoutes = [
  "create",
  "import",
  "manifesto",
  "legal/privacy",
  "legal/terms",
  "wallet",
  "wallet/backup",
  "wallet/contacts",
  "wallet/receive",
  "wallet/send",
  "wallet/settings",
  "wallet/watch-add",
];
const prerenderedNativeRoutes = new Set(["create", "import"]);
const stableRootAssets = ["icon-512.webp"];
const nativeClickFallbackScript = `<script>(function(){if(window.__HME_NATIVE_NAV_FALLBACK__)return;window.__HME_NATIVE_NAV_FALLBACK__=true;function routeFromEvent(e){var t=e.target;if(!t||!t.closest)return null;var a=t.closest('a[data-native-route],a[href="/import"],a[href="/create"]');if(!a)return null;var h=a.getAttribute('data-native-route')||a.getAttribute('href');return h==='/import'||h==='/create'?h:null}function go(e){if(document.documentElement&&document.documentElement.dataset&&document.documentElement.dataset.hmeHydrated==='true')return;var h=routeFromEvent(e);if(!h)return;e.preventDefault();e.stopPropagation();location.assign(h)}document.addEventListener('pointerup',go,true);document.addEventListener('touchend',go,true);document.addEventListener('click',go,true);})();</script>`;

const inlineHomeIcon = `<div aria-label="Honest Money Ecosystem" role="img" style="width:64px;height:64px;margin:0 auto 20px;border-radius:18px;display:grid;place-items:center;background:linear-gradient(135deg,#fcd34d,#eab308,#92400e);box-shadow:0 12px 32px rgba(120,53,15,.45)"><svg aria-hidden="true" viewBox="0 0 64 64" style="width:48px;height:48px;filter:drop-shadow(0 2px 4px rgba(0,0,0,.25))"><circle cx="32" cy="32" r="25" fill="#111827" opacity=".95"></circle><path d="M18 42V22h7.2v7.1h13.6V22H46v20h-7.2v-7.2H25.2V42H18Z" fill="#facc15"></path><path d="M16 47h32" stroke="#fef3c7" stroke-width="4" stroke-linecap="round" opacity=".9"></path></svg><span style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)">HME</span></div>`;

function hardenNativeHomeHtml(html) {
  return html
    .replace(/<link\s+rel="preload"\s+as="image"\s+href="[^"]*icon-512[^"]*"\s*\/?>/g, "")
    .replace(
      /<header class="text-center mb-12"><img[^>]*alt="Honest Money Ecosystem"[^>]*\/?>/,
      `<header class="text-center mb-12">${inlineHomeIcon}`,
    )
    .replace(/<a href="\/(import|create)" class=/g, '<a href="/$1" data-native-route="/$1" class=');
}

async function isDirectory(path) {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

async function findFirstDirectory(paths) {
  for (const path of paths) {
    if (await isDirectory(path)) return path;
  }
  return undefined;
}

async function findFirstFile(paths) {
  for (const path of paths) {
    if (existsSync(path)) return path;
  }
  return undefined;
}

async function renderSpaShell(serverEntryPath, route = "/") {
  const serverModule = await import(pathToFileURL(serverEntryPath).href + `?t=${Date.now()}`);
  const server = serverModule.default ?? serverModule;
  if (typeof server.fetch !== "function") {
    throw new Error(`${serverEntryPath} does not export a fetch handler.`);
  }

  const response = await server.fetch(
    new Request(`http://localhost${route}`, {
      headers: { "X-TSS_SHELL": "true" },
    }),
    {},
    { waitUntil() {} },
  );

  if (!response.ok) {
    throw new Error(`SPA shell render failed with HTTP ${response.status}: ${await response.text()}`);
  }

  const html = await response.text();
  if (!html.includes("$_TSR") || !html.includes("/assets/")) {
    throw new Error(`Generated SPA shell for ${route} is missing TanStack hydration data or asset links.`);
  }
  const hardened = route === "/" ? hardenNativeHomeHtml(html) : html;
  return hardened.includes("</body>") ? hardened.replace("</body>", `${nativeClickFallbackScript}</body>`) : hardened;
}

const publicDir = await findFirstDirectory(publicCandidates);
if (!publicDir) {
  throw new Error("No built web assets found. Run `bun run build` after `bun install`.");
}

// Capacitor is deliberately pinned to dist/client, even when the adapter writes
// .output/public. Mirror the generated public bundle there so `cap sync` is stable.
if (publicDir !== capacitorWebDir) {
  await mkdir(dirname(capacitorWebDir), { recursive: true });
  await cp(publicDir, capacitorWebDir, { recursive: true, force: true });
}

const serverEntryPath = await findFirstFile(serverCandidates);
if (!serverEntryPath) {
  throw new Error("No server entry found to render the TanStack Start SPA shell.");
}

const outputDirs = Array.from(new Set([capacitorWebDir, publicDir, iosWebDir]));
const routeHtml = new Map();
const homeHtml = await renderSpaShell(serverEntryPath, "/");
routeHtml.set("", homeHtml);
for (const route of staticSpaRoutes) {
  routeHtml.set(
    route,
    prerenderedNativeRoutes.has(route) ? await renderSpaShell(serverEntryPath, `/${route}`) : homeHtml,
  );
}

for (const outputDir of outputDirs) {
  if (outputDir !== publicDir) {
    await mkdir(dirname(outputDir), { recursive: true });
    await cp(publicDir, outputDir, { recursive: true, force: true });
  }
}

for (const outputDir of outputDirs) {
  await mkdir(outputDir, { recursive: true });
  await writeFile(resolve(outputDir, "index.html"), routeHtml.get(""));
  for (const route of staticSpaRoutes) {
    const routeDir = resolve(outputDir, route);
    await mkdir(routeDir, { recursive: true });
    await writeFile(resolve(routeDir, "index.html"), routeHtml.get(route));
  }
  for (const asset of stableRootAssets) {
    const source = resolve(root, "public", asset);
    if (existsSync(source)) {
      await cp(source, resolve(outputDir, asset), { force: true });
    }
  }
}

try {
  const capacitorConfigModule = await import(pathToFileURL(resolve(root, "capacitor.config.ts")).href + `?t=${Date.now()}`);
  const capacitorConfig = capacitorConfigModule.default ?? capacitorConfigModule;
  await mkdir(dirname(iosConfigPath), { recursive: true });
  await writeFile(iosConfigPath, `${JSON.stringify(capacitorConfig, null, 2)}\n`);
} catch (error) {
  console.warn(`Could not stage iOS capacitor.config.json: ${error instanceof Error ? error.message : String(error)}`);
}

console.log(`Generated Capacitor SPA entry: ${outputDirs.map((dir) => `${dir}/index.html`).join(", ")}`);