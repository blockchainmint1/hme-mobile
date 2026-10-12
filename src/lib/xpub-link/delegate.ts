/**
 * `hm-link-delegate` — a site (Seeds Exchange) asks to trade from the user's
 * Trading pocket. The user picks one of two modes:
 *
 * - "access":  the wallet hands over the pocket's account-level xprv per
 *   chain, sealed to the site's X25519 key on this device. Instant trades.
 * - "approve": the wallet hands over xpubs only. The site proposes each trade
 *   as an unsigned transaction and the user approves it in the wallet.
 *
 * Hard rules (never configurable by the site):
 * - Site must be on the honest.money trusted list (no "continue anyway").
 * - Requested paths must be exactly account 1106' on the known coin types.
 *   The wallet substitutes its own active pocket account (1106, 1107, …).
 * - submit_url / revoke_url share the manifest origin.
 * - The signed identity message is rebuilt locally from a fixed shape.
 */
import { x25519 } from "@noble/curves/ed25519";
import { gcm } from "@noble/ciphers/aes";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { base64url } from "@scure/base";
import { seedFromMnemonic } from "@/lib/txc/wallet";
import { signMessageWithSeed } from "@/lib/txc/message-sign";
import { scopedKey } from "@/lib/profiles";
import { isEcosystemSite, loginSiteName } from "@/lib/web-login-hosts";
import {
  accountPath,
  activePocketAccount,
  chainRoot,
  POCKET_BASE_ACCOUNT,
  POCKET_CHAINS,
  type PocketChain,
} from "@/lib/seeds/pocket";

const PROXY = "/api/nectar/link";

export type DelegateMode = "access" | "approve";

export interface DelegateManifest {
  host: string;
  appName: string;
  purpose?: string;
  token: string;
  challenge: string;
  chains: PocketChain[];
  recipientPub: Uint8Array;
  submitUrl: string;
  revokeUrl: string;
  manifestUrl: string;
}

export function isDelegateDialect(raw: Record<string, unknown>): boolean {
  return raw["type"] === "hm-link-delegate";
}

export function validateDelegate(raw: Record<string, unknown>, manifestUrl: string): DelegateManifest {
  const fail = (m: string): never => {
    throw new Error(m);
  };
  if (!isDelegateDialect(raw)) fail("That code isn't a trading link.");
  const u = new URL(manifestUrl);
  const host = u.hostname;
  if (!isEcosystemSite(host))
    fail(`${host} isn't on the honest.money trusted list, so it can't be given trading access.`);
  const sameOrigin = (s: unknown) => {
    try {
      return typeof s === "string" && new URL(s).origin === u.origin;
    } catch {
      return false;
    }
  };
  if (!sameOrigin(raw["submit_url"]) || !sameOrigin(raw["revoke_url"])) fail("Link sends keys to a different server.");
  const token = raw["challenge_id"];
  const challenge = raw["challenge"];
  if (typeof token !== "string" || !/^[A-Za-z0-9_-]{8,64}$/.test(token)) fail("Link is malformed.");
  if (typeof challenge !== "string" || !/^[A-Za-z0-9_-]{8,128}$/.test(challenge)) fail("Link is malformed.");
  const exp = Date.parse(String(raw["expires_at"] ?? ""));
  if (!Number.isFinite(exp) || exp <= Date.now()) fail("This link has expired.");
  let recipientPub: Uint8Array = new Uint8Array();
  try {
    recipientPub = base64url.decode(String(raw["recipient_pubkey"] ?? "").replace(/=+$/, ""));
  } catch {
    fail("Link is missing its encryption key.");
  }
  if (recipientPub.length !== 32) fail("Link is missing its encryption key.");

  const req = Array.isArray(raw["request"]) ? (raw["request"] as Record<string, unknown>[]) : [];
  if (req.length === 0) fail("Link doesn't ask for any chain.");
  const chains: PocketChain[] = [];
  for (const r of req) {
    const chain = String(r["chain"] ?? "").toUpperCase() as PocketChain;
    if (!POCKET_CHAINS.includes(chain)) fail(`Unsupported chain: ${chain}`);
    // Only the reserved trading account, on that chain's own coin type.
    if (String(r["path"]) !== accountPath(chain, POCKET_BASE_ACCOUNT))
      fail(`Refused key request: ${chain} ${String(r["path"])} (only the 1106 trading branch is allowed).`);
    if (!chains.includes(chain)) chains.push(chain);
  }
  const app = (raw["app"] ?? {}) as Record<string, unknown>;
  return {
    host,
    appName: typeof app["name"] === "string" ? (app["name"] as string).slice(0, 40) : loginSiteName(host),
    purpose: typeof raw["purpose"] === "string" ? (raw["purpose"] as string).slice(0, 300) : undefined,
    token: token as string,
    challenge: challenge as string,
    chains,
    recipientPub,
    submitUrl: raw["submit_url"] as string,
    revokeUrl: raw["revoke_url"] as string,
    manifestUrl,
  };
}

/**
 * Seal bytes to an X25519 public key.
 * Format: base64url( ephemeralPub(32) || nonce(12) || AES-256-GCM ciphertext+tag )
 * key = HKDF-SHA256(ikm = X25519(eph, recipient), salt = ephPub || recipientPub,
 *                   info = "hm-link-delegate v1"), 32 bytes.
 */
export function sealTo(recipientPub: Uint8Array, plaintext: Uint8Array): Uint8Array {
  const eph = x25519.utils.randomPrivateKey();
  const ephPub = x25519.getPublicKey(eph);
  const shared = x25519.getSharedSecret(eph, recipientPub);
  const salt = new Uint8Array(64);
  salt.set(ephPub, 0);
  salt.set(recipientPub, 32);
  const key = hkdf(sha256, shared, salt, new TextEncoder().encode("hm-link-delegate v1"), 32);
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const ct = gcm(key, nonce).encrypt(plaintext);
  const out = new Uint8Array(32 + 12 + ct.length);
  out.set(ephPub, 0);
  out.set(nonce, 32);
  out.set(ct, 44);
  key.fill(0);
  shared.fill(0);
  eph.fill(0);
  return out;
}

function hexOf(b: Uint8Array): string {
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

export function buildDelegateMessage(args: {
  host: string;
  challenge: string;
  paths: string[];
  mode: DelegateMode;
  payloadSha256: string;
}): string {
  const last =
    args.mode === "access"
      ? "I authorize this site to spend from these branches until I revoke."
      : "I authorize this site to propose trades from these branches. Each trade needs my approval.";
  return [
    "Honest Money - Link wallet (delegate)",
    "",
    `Domain: ${args.host}`,
    `Challenge: ${args.challenge}`,
    `Mode: ${args.mode}`,
    `Paths: ${args.paths.join(",")}`,
    `Payload-SHA256: ${args.payloadSha256}`,
    "",
    last,
  ].join("\n");
}

export interface DelegateLinkRecord {
  linkId: string;
  host: string;
  appName: string;
  mode: DelegateMode;
  account: number;
  chains: PocketChain[];
  revokeUrl: string;
  /** Where pending-trade proposals are read from (approve mode). */
  origin: string;
  identity: string;
  linkedAt: string;
}

export async function submitDelegate(args: {
  manifest: DelegateManifest;
  mode: DelegateMode;
  mnemonic: string;
  passphrase?: string;
}): Promise<DelegateLinkRecord> {
  const { manifest, mode, mnemonic, passphrase = "" } = args;
  const account = activePocketAccount();
  const seed = await seedFromMnemonic(mnemonic, passphrase);
  const xpubs: Record<string, string> = {};
  const xprvs: Record<string, string> = {};
  const paths: string[] = [];
  for (const c of manifest.chains) {
    const path = accountPath(c, account);
    const node = chainRoot(seed, c).derivePath(path);
    paths.push(path);
    xpubs[c] = node.neutered().toBase58();
    if (mode === "access") xprvs[c] = node.toBase58();
  }
  seed.fill(0);

  let payload: string | undefined;
  let payloadSha = "none";
  if (mode === "access") {
    const sealed = sealTo(manifest.recipientPub, new TextEncoder().encode(JSON.stringify(xprvs)));
    for (const k of Object.keys(xprvs)) xprvs[k] = "";
    payload = base64url.encode(sealed);
    payloadSha = hexOf(sha256(sealed));
  }

  const message = buildDelegateMessage({
    host: manifest.host,
    challenge: manifest.challenge,
    paths,
    mode,
    payloadSha256: payloadSha,
  });
  const signed = await signMessageWithSeed({ mnemonic, passphrase, kind: "bip44", change: 0, index: 0, message });

  const res = await fetch(`${PROXY}?url=${encodeURIComponent(manifest.submitUrl)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      token: manifest.token,
      mode,
      account,
      paths,
      identity_address: signed.address,
      signature: signed.signature,
      message,
      ...(payload ? { payload } : {}),
      xpubs,
      app_name: "honest.money wallet",
    }),
  });
  const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!res.ok) throw new Error((body?.["error"] as string) ?? (body?.["message"] as string) ?? `Link failed (${res.status})`);
  const linkId = String(body?.["link_id"] ?? manifest.token);
  const record: DelegateLinkRecord = {
    linkId,
    host: manifest.host,
    appName: (body?.["linked_to"] as string) ?? manifest.appName,
    mode,
    account,
    chains: manifest.chains,
    revokeUrl: manifest.revokeUrl,
    origin: new URL(manifest.manifestUrl).origin,
    identity: signed.address,
    linkedAt: new Date().toISOString(),
  };
  saveDelegateLink(record);
  return record;
}

export async function revokeDelegate(args: {
  record: DelegateLinkRecord;
  mnemonic: string;
  passphrase?: string;
}): Promise<void> {
  const { record, mnemonic, passphrase = "" } = args;
  const message = [
    "Honest Money - Revoke link",
    "",
    `Domain: ${record.host}`,
    `Link: ${record.linkId}`,
    `Issued At: ${new Date().toISOString()}`,
  ].join("\n");
  const signed = await signMessageWithSeed({ mnemonic, passphrase, kind: "bip44", change: 0, index: 0, message });
  const res = await fetch(`${PROXY}?url=${encodeURIComponent(record.revokeUrl)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ link_id: record.linkId, identity_address: signed.address, signature: signed.signature, message }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    throw new Error((body?.["error"] as string) ?? `Revoke failed (${res.status})`);
  }
}

/* ------------------------------ local records ---------------------------- */

const STORE = "hme:delegate-links";
export const DELEGATE_LINKS_EVENT = "hme:delegate-links-changed";

export function listDelegateLinks(): DelegateLinkRecord[] {
  if (typeof window === "undefined") return [];
  try {
    const v = JSON.parse(window.localStorage.getItem(scopedKey(STORE)) ?? "[]") as DelegateLinkRecord[];
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function write(list: DelegateLinkRecord[]) {
  window.localStorage.setItem(scopedKey(STORE), JSON.stringify(list));
  window.dispatchEvent(new Event(DELEGATE_LINKS_EVENT));
}

export function saveDelegateLink(r: DelegateLinkRecord) {
  write([...listDelegateLinks().filter((l) => l.linkId !== r.linkId), r]);
}

export function removeDelegateLink(linkId: string) {
  write(listDelegateLinks().filter((l) => l.linkId !== linkId));
}

export async function fetchDelegateManifest(manifestUrl: string): Promise<DelegateManifest> {
  const res = await fetch(`${PROXY}?url=${encodeURIComponent(manifestUrl)}`, { headers: { Accept: "application/json" } });
  const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!res.ok || !body) throw new Error((body?.["error"] as string) ?? "Could not read the link");
  return validateDelegate(body, manifestUrl);
}

/** Peek a manifest's type so the Ecosystem links box can route it. */
export async function peekManifestType(manifestUrl: string): Promise<string | null> {
  try {
    const res = await fetch(`${PROXY}?url=${encodeURIComponent(manifestUrl)}`, { headers: { Accept: "application/json" } });
    const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    return typeof body?.["type"] === "string" ? (body["type"] as string) : null;
  } catch {
    return null;
  }
}
