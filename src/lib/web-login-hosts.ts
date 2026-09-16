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
  // Our own Lovable preview / published hosts for the ecosystem apps.
  return /^(hme|honest)[a-z0-9-]*\.lovable\.app$/i.test(hostname);
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

/** Tier + display name for a sign-in host. */
export function classifyLoginHost(hostname: string): LoginHostInfo {
  const host = hostname.trim().toLowerCase();
  const partner = PARTNER_NAMES[host];
  if (partner) return { tier: isFirstParty(host) ? "first-party" : "partner", name: partner };
  if (isFirstParty(host)) return { tier: "first-party", name: host };
  return { tier: "unknown", name: host };
}

/** Human-friendly site name for a sign-in host, used in the confirm UI. */
export function loginSiteName(hostname: string): string {
  return classifyLoginHost(hostname).name;
}
