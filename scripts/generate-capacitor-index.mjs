import { cp, mkdir, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const capacitorWebDir = resolve(root, "dist/client");
const iosWebDir = resolve(root, "ios/App/App/public");
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
const nativeClickFallbackScript = `<script>(function(){document.addEventListener('click',function(e){var a=e.target&&e.target.closest&&e.target.closest('a[href]');if(!a)return;var h=a.getAttribute('href');if(h==='/import'||h==='/create'){e.preventDefault();location.href=h;}},true);})();</script>`;

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
  return html.includes("</body>") ? html.replace("</body>", `${nativeClickFallbackScript}</body>`) : html;
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

console.log(`Generated Capacitor SPA entry: ${outputDirs.map((dir) => `${dir}/index.html`).join(", ")}`);