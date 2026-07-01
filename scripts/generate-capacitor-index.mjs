import { cp, mkdir, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const capacitorWebDir = resolve(root, "dist/client");
const publicCandidates = [resolve(root, "dist/client"), resolve(root, ".output/public")];
const serverCandidates = [resolve(root, "dist/server/index.mjs"), resolve(root, ".output/server/index.mjs")];

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

async function renderSpaShell(serverEntryPath) {
  const serverModule = await import(pathToFileURL(serverEntryPath).href + `?t=${Date.now()}`);
  const server = serverModule.default ?? serverModule;
  if (typeof server.fetch !== "function") {
    throw new Error(`${serverEntryPath} does not export a fetch handler.`);
  }

  const response = await server.fetch(
    new Request("http://localhost/", {
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
    throw new Error("Generated SPA shell is missing TanStack hydration data or asset links.");
  }
  return html;
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

const html = await renderSpaShell(serverEntryPath);
const outputDirs = Array.from(new Set([capacitorWebDir, publicDir]));

for (const outputDir of outputDirs) {
  await mkdir(outputDir, { recursive: true });
  await writeFile(resolve(outputDir, "index.html"), html);
}

console.log(`Generated Capacitor SPA entry: ${outputDirs.map((dir) => `${dir}/index.html`).join(", ")}`);