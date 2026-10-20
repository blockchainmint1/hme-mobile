/**
 * Host policy for the QR "Sign in to a website" flow.
 *
 * Any public HTTPS host may request a wallet sign-in — a sign-in signature is
 * domain-bound and authorizes no payment, so the protection is (a) the wallet
 * showing which domain is asking and (b) the strict message template in
 * src/lib/nectar/auth.ts. Hosts are classified into tiers only so the UI can
 * decide how loud the confirmation should be:
 *
 *   first-party — our own honest.money properties (and their previews)
 *   partner     — known partner sites, shown with a friendly name
 *   unknown     — anything else: allowed, with an explicit warning + 2nd tap
 *
 * Both the client validator (src/lib/nectar/auth.ts) and the server proxy
 * (src/routes/api/nectar.link.ts) read from this single source.
 *
 * This module must stay dependency-free: it is imported by client bundles.
 */

export type LoginHostTier = "first-party" | "partner" | "unknown";

export interface LoginHostInfo {
  tier: LoginHostTier;
  /** Friendly name where we know one, otherwise the bare hostname. */
  name: string;
}

/** Named partner sites (friendly labels, no extra confirmation step). */
const PARTNER_NAMES: Record<string, string> = {
  "app.nectar-pay.com": "NectarPay",
  "pay.honest.money": "NectarPay",
  "streamtxc.com": "streamTXC",
  "www.streamtxc.com": "streamTXC",
  "bonfire.honest.money": "Bonfire",
  "hme-bonfire.lovable.app": "Bonfire",
};

/**
 * @deprecated Sign-in is no longer restricted to a list. Kept for the named
 * partner tier only.
 */
export const TRUSTED_LOGIN_HOSTS: ReadonlySet<string> = new Set(Object.keys(PARTNER_NAMES));

const FIRST_PARTY_APEX = "honest.money";

function isFirstParty(hostname: string): boolean {
  if (hostname === FIRST_PARTY_APEX || hostname.endsWith(`.${FIRST_PARTY_APEX}`)) return true;
  // Hosting-provider names are open to anyone: never trust a name pattern.
  return false;
}

/**
 * Is this hostname a routable public DNS name? Rejects IP literals, localhost,
 * single-label names, .local / .internal / .onion, and anything with a label
 * that can't appear in public DNS. Used by both the client and the proxy so an
 * attacker can't aim the sign-in proxy at an internal service (SSRF).
 */
export function isPublicHostname(raw: string): boolean {
  const host = raw.trim().toLowerCase();
  if (!host || host.length > 253) return false;
  if (host.startsWith("[") || host.endsWith("]")) return false; // IPv6 literal
  if (/^[0-9.]+$/.test(host)) return false; // IPv4 literal (incl. private ranges)
  if (/^[0-9a-f:]+$/.test(host) && host.includes(":")) return false;
  const labels = host.split(".");
  if (labels.length < 2) return false; // needs a real TLD
  if (labels.some((l) => !/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(l) || l.length > 63)) return false;
  const tld = labels[labels.length - 1];
  if (!/^[a-z]{2,}$/.test(tld)) return false;
  if (["local", "localhost", "internal", "intranet", "onion", "test", "invalid", "example"].includes(tld)) {
    return false;
  }
  if (host === "localhost" || host.endsWith(".localhost")) return false;
  return true;
}

/**
 * Live ecosystem registry, published by the Honest.Money Ecosystem site
 * (Admin → SSO sites) and loaded at startup by src/lib/ecosystem-sites.ts.
 * Adds friendly names for new partner sites without a wallet release; the
 * built-in list above stays as the offline fallback.
 */
let ecosystemNames: Record<string, string> = {};
let spendingHosts = new Set<string>();
let verifiedUntil = 0;

export function setEcosystemSites(sites: { host: string; label: string }[], verified = false): void {
  const next: Record<string, string> = Object.create(null);
  for (const s of sites) {
    const host = s.host.trim().toLowerCase();
    if (!isPublicHostname(host)) continue;
    next[host] = (s.label || host).slice(0, 40);
  }
  ecosystemNames = next;
  if (verified) {
    spendingHosts = new Set(Object.keys(next));
    verifiedUntil = Date.now() + 5 * 60 * 1000;
  }
}

export function isEcosystemSite(hostname: string): boolean {
  const host = hostname.trim().toLowerCase();
  return Object.hasOwn(ecosystemNames, host) || Object.hasOwn(PARTNER_NAMES, host) || isFirstParty(host);
}

/** Spending is authorized ONLY by a fresh server-verified registry, never offline labels. */
export function isSpendingSite(hostname: string): boolean {
  return Date.now() < verifiedUntil && spendingHosts.has(hostname.trim().toLowerCase());
}

/** Tier + display name for a sign-in host. */
export function classifyLoginHost(hostname: string): LoginHostInfo {
  const host = hostname.trim().toLowerCase();
  const partner = ecosystemNames[host] ?? PARTNER_NAMES[host];
  if (partner) return { tier: isFirstParty(host) ? "first-party" : "partner", name: partner };
  if (isFirstParty(host)) return { tier: "first-party", name: host };
  return { tier: "unknown", name: host };
}

/** Human-friendly site name for a sign-in host, used in the confirm UI. */
export function loginSiteName(hostname: string): string {
  return classifyLoginHost(hostname).name;
}
