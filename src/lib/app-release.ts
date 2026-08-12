/**
 * Single source of truth for the current published release.
 *
 * APP_VERSION / APK_URL are the values baked into *this* build. The live
 * "what's the newest release?" answer comes from the `app_releases` table in
 * the backend, so a freshly pinned APK is visible to already-installed apps
 * without shipping new code.
 */
import { supabase } from "@/integrations/supabase/client";

export const APP_VERSION = "0.1.202608120322";

export const APK_URL =
  "https://txc.mypinata.cloud/ipfs/QmThMNBhM9vuBF2CSFXia1g1iS6kqUsPaQxqKAE7nNkZD3?filename=hme-wallet-0.1.202608120322-release.apk";

export type ReleasePlatform = "android" | "ios" | "web";

export type AppRelease = {
  platform: string;
  version: string;
  ipfs_cid: string | null;
  download_url: string | null;
  notes: string | null;
  mandatory: boolean;
  released_at: string;
};

/** Newest published release for a platform, or null if we can't reach the server. */
export async function fetchLatestRelease(platform: ReleasePlatform): Promise<AppRelease | null> {
  try {
    const { data, error } = await supabase
      .from("app_releases")
      .select("platform, version, ipfs_cid, download_url, notes, mandatory, released_at")
      .eq("platform", platform)
      .order("released_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error || !data) return null;
    return data as AppRelease;
  } catch {
    return null;
  }
}

/** Numeric-aware version compare: 1 if a > b, -1 if a < b, 0 if equal. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(/[.\-+]/);
  const pb = b.split(/[.\-+]/);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = Number(pa[i] ?? 0);
    const nb = Number(pb[i] ?? 0);
    if (Number.isNaN(na) || Number.isNaN(nb)) {
      const sa = pa[i] ?? "";
      const sb = pb[i] ?? "";
      if (sa !== sb) return sa > sb ? 1 : -1;
      continue;
    }
    if (na !== nb) return na > nb ? 1 : -1;
  }
  return 0;
}

/** Best download link for a release row (falls back to the IPFS gateway). */
export function releaseDownloadUrl(r: AppRelease | null): string {
  if (!r) return APK_URL;
  if (r.download_url) return r.download_url;
  if (r.ipfs_cid) return `https://txc.mypinata.cloud/ipfs/${r.ipfs_cid}`;
  return APK_URL;
}

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
