/**
 * Single source of truth for the current published release: the APK download
 * (pinned to IPFS) and the human-readable version shown in Settings.
 */
export const APP_VERSION = "0.1.202608030734";

export const APK_URL =
  "https://txc.mypinata.cloud/ipfs/QmQpbDV5oYmh4qr2LhMkjQWq4BrTdinKmfJK1UNdrjygPt?filename=hme-wallet-0.1.202608030734-release.apk";

/**
 * Web update check: the deployed index.html references hashed asset URLs.
 * If the freshly fetched HTML points at scripts this running page never
 * loaded, a newer build is live and a reload will pick it up.
 */
export async function checkForWebUpdate(): Promise<"current" | "update" | "unknown"> {
  if (typeof window === "undefined") return "unknown";
  try {
    const res = await fetch(`/?_=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) return "unknown";
    const html = await res.text();
    const remote = [...html.matchAll(/(?:src|href)="(\/[^"]*\.(?:js|css))"/g)].map((m) => m[1]);
    const jsOnly = remote.filter((u) => u.endsWith(".js"));
    if (jsOnly.length === 0) return "unknown";
    const loaded = new Set(
      [...document.querySelectorAll<HTMLScriptElement>("script[src]")].map(
        (s) => new URL(s.src, window.location.origin).pathname,
      ),
    );
    const hasNew = jsOnly.some((u) => !loaded.has(u));
    return hasNew ? "update" : "current";
  } catch {
    return "unknown";
  }
}

/** Drop caches (incl. service worker) and hard-reload into the new build. */
export async function applyWebUpdate(): Promise<void> {
  try {
    if ("caches" in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
    if ("serviceWorker" in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.update().catch(() => undefined)));
    }
  } catch {
    /* best effort */
  }
  window.location.reload();
}
