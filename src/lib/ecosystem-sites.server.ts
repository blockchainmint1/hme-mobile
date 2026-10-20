/**
 * Fetches the trusted-site registry published by the Honest.Money Ecosystem
 * site. The response is signed with the shared HME_ECOSYSTEM secret:
 *   x-hme-timestamp: unix seconds
 *   x-hme-signature: hex HMAC-SHA256 of `${timestamp}.${rawBody}`
 * Unsigned or badly signed lists are rejected, so a hijacked response can't
 * mark a phishing site as trusted. Spec: docs/ecosystem-trusted-sites.md
 */
import { createHmac, timingSafeEqual } from "crypto";

export interface EcosystemSite {
  host: string;
  label: string;
}

const DEFAULT_URL = "https://honest.money/api/public/v1/trusted-sites";
let cache: { at: number; sites: EcosystemSite[] } | null = null;
const TTL_MS = 5 * 60 * 1000;

export async function loadEcosystemSites(): Promise<EcosystemSite[]> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.sites;
  // New Honest Money API requires a dedicated per-site credential; never send
  // the cross-partner HME_ECOSYSTEM signing secret as its API bearer token.
  const secret = process.env["HME_SITE_API_KEY"];
  const site = process.env["HME_SITE_CODE"];
  if (!secret || !site) throw new Error("dedicated ecosystem site credential missing");
  const res = await fetch(process.env["ECOSYSTEM_SITES_URL"] || DEFAULT_URL, {
    headers: { accept: "application/json", Authorization: `Bearer ${secret}`, "X-HME-Site": site },
    redirect: "error",
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`registry ${res.status}`);
  const body = await res.text();
  const ts = res.headers.get("x-hme-timestamp") ?? "";
  const sig = res.headers.get("x-hme-signature") ?? "";
  if (!/^\d{10,13}$/.test(ts) || !/^[0-9a-f]{64}$/i.test(sig)) throw new Error("registry signature malformed");
  const expected = createHmac("sha256", secret).update(`${ts}.${body}`).digest("hex");
  const a = Buffer.from(sig, "hex");
  const b = Buffer.from(expected, "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new Error("registry signature invalid");
  // Signed lists are allowed to be served from a cache for up to a day.
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 86400) throw new Error("registry signature stale");
  const parsed = JSON.parse(body) as { sites?: { host?: unknown; label?: unknown; active?: unknown }[] };
  const sites = (parsed.sites ?? [])
    .filter((s) => typeof s.host === "string" && s.active !== false)
    .map((s) => ({ host: String(s.host).toLowerCase(), label: typeof s.label === "string" ? s.label : "" }))
    .slice(0, 500);
  cache = { at: Date.now(), sites };
  return sites;
}
