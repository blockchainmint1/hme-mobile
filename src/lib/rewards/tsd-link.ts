/**
 * TSD Swap ⇄ wallet account link (v1).
 *
 * The user scans a QR code (or pastes the link URL) shown on their TSD Swap
 * profile page. We read the link manifest through our same-origin proxy,
 * show what's being shared, and on approval hand over:
 *
 *   - the watch-only TEXITcoin account key (xpub at m/44'/696969'/0'), so
 *     TSD Swap can sum TSD across every derived address for rewards, and
 *   - the base EVM address (m/44'/60'/0'/0/0), for payouts/identity.
 *
 * Public key material only — signed by the TXC identity key (BIP-137 over
 * canonical JSON). No seed, no private keys, no spending authority.
 */
import { canonicalJson } from "@/lib/nectar/link";
import { scopedKey } from "@/lib/profiles";
import { deriveEvmAccount } from "@/lib/chains/evm";
import { signMessageWithSeed } from "@/lib/txc/message-sign";
import { DERIVATION_PATHS, TXC_NETWORK } from "@/lib/txc/network";
import { deriveAddress, rootFromSeed, seedFromMnemonic } from "@/lib/txc/wallet";
import * as ecc from "@bitcoinerlab/secp256k1";
import { BIP32Factory } from "bip32";

const bip32 = BIP32Factory(ecc);

const PROXY = "/api/tsd/link";
export const TSD_TRUSTED_HOSTS = ["tsd.honest.money", "app.tsdswap.com"];

export interface TsdLinkManifest {
  v: number;
  type: "tsd-link-xpub";
  challenge_id: string;
  from: string;
  callback_url: string;
  manifest_url: string;
  exp: number;
  account_id?: string;
  account_name?: string;
}

function trustedUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    return (
      u.protocol === "https:" &&
      TSD_TRUSTED_HOSTS.includes(u.hostname) &&
      u.port === "" &&
      u.username === "" &&
      u.password === ""
    );
  } catch {
    return false;
  }
}

/** Accept a pasted URL or a scanned QR payload (URL, or `tsd:` deep link). */
export function parseTsdLinkInput(text: string): string | null {
  const trimmed = text.trim();
  const candidate = trimmed.replace(/^tsd:(\/\/)?/i, (m) => (m.length ? "https://" : m));
  if (trustedUrl(trimmed)) return new URL(trimmed).toString();
  if (trustedUrl(candidate)) return new URL(candidate).toString();
  return null;
}

export function validateTsdManifest(raw: Record<string, unknown>): TsdLinkManifest {
  const fail = (m: string): never => {
    throw new Error(m);
  };
  if (raw["type"] !== "tsd-link-xpub") fail("That QR isn't a TSD Swap account link.");
  if (typeof raw["challenge_id"] !== "string" || !raw["challenge_id"]) fail("Link is malformed.");
  if (typeof raw["callback_url"] !== "string" || !trustedUrl(raw["callback_url"] as string))
    fail("Link points at an untrusted server.");
  if (typeof raw["manifest_url"] !== "string" || !trustedUrl(raw["manifest_url"] as string))
    fail("Link points at an untrusted server.");
  if (new URL(raw["callback_url"] as string).origin !== new URL(raw["manifest_url"] as string).origin)
    fail("Link callback does not match its manifest.");
  const exp = Number(raw["exp"]);
  if (!Number.isFinite(exp) || exp * 1000 <= Date.now()) fail("This link has expired.");
  return {
    v: Number(raw["v"]) || 1,
    type: "tsd-link-xpub",
    challenge_id: raw["challenge_id"] as string,
    from: (raw["from"] as string) ?? new URL(raw["manifest_url"] as string).hostname,
    callback_url: raw["callback_url"] as string,
    manifest_url: raw["manifest_url"] as string,
    exp,
    account_id: (raw["account_id"] as string) ?? undefined,
    account_name: (raw["account_name"] as string) ?? undefined,
  };
}

export async function fetchTsdManifest(manifestUrl: string): Promise<TsdLinkManifest> {
  const res = await fetch(`${PROXY}?url=${encodeURIComponent(manifestUrl)}`, {
    headers: { Accept: "application/json" },
  });
  const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!res.ok || !body) {
    throw new Error(
      (body?.["message"] as string) ?? (body?.["error"] as string) ?? "Could not read that link.",
    );
  }
  const manifest = validateTsdManifest(body);
  if (manifest.manifest_url !== manifestUrl)
    throw new Error("The link manifest does not match its URL.");
  return manifest;
}

export interface TsdWalletKeys {
  /** Watch-only TEXITcoin account key at m/44'/696969'/0'. */
  txcXpub: string;
  txcPath: string;
  /** Stable wallet id: legacy P2PKH at m/44'/696969'/0'/0/0. */
  identity: string;
  /** Base EVM address at m/44'/60'/0'/0/0. */
  evmAddress: string;
}

export async function deriveTsdLinkKeys(
  mnemonic: string,
  passphrase = "",
): Promise<TsdWalletKeys> {
  const seed = await seedFromMnemonic(mnemonic, passphrase);
  const root = rootFromSeed(seed);
  const txcPath = DERIVATION_PATHS.bip44;
  return {
    txcXpub: bip32.fromSeed(seed, TXC_NETWORK).derivePath(txcPath).neutered().toBase58(),
    txcPath,
    identity: deriveAddress(root, "bip44", 0, 0).address,
    evmAddress: deriveEvmAccount(root).address,
  };
}

export interface TsdLinkResult {
  ok: boolean;
  account_id?: string;
  account_name?: string;
}

export async function submitTsdLink(args: {
  manifest: TsdLinkManifest;
  mnemonic: string;
  passphrase?: string;
}): Promise<TsdLinkResult> {
  const { manifest, mnemonic, passphrase = "" } = args;
  const keys = await deriveTsdLinkKeys(mnemonic, passphrase);

  const payload = {
    v: 1,
    type: "tsd-link-xpub",
    challenge_id: manifest.challenge_id,
    callback_url: manifest.callback_url,
    xpub: keys.txcXpub,
    path: keys.txcPath,
    identity: keys.identity,
    evm_address: keys.evmAddress,
    exp: manifest.exp,
    issued_at: new Date().toISOString(),
  } as const;

  const message = canonicalJson(payload as unknown as Parameters<typeof canonicalJson>[0]);
  const signed = await signMessageWithSeed({
    mnemonic,
    passphrase,
    kind: "bip44",
    change: 0,
    index: 0,
    message,
  });

  const res = await fetch(`${PROXY}?url=${encodeURIComponent(manifest.callback_url)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ payload, signature: signed.signature, address: signed.address }),
  });
  const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!res.ok) {
    throw new Error(
      (body?.["message"] as string) ??
        (body?.["error"] as string) ??
        `Link failed (${res.status})`,
    );
  }
  return {
    ok: true,
    account_id: body?.["account_id"] as string | undefined,
    account_name: body?.["account_name"] as string | undefined,
  };
}

/* ------------------------------------------------------------------ */
/* Local record (per vault)                                            */
/* ------------------------------------------------------------------ */

export interface TsdLinkRecord {
  accountId: string;
  accountName: string;
  identity: string;
  linkedAt: string;
}

const STORE_BASE = "hme:tsd-account-link";

export function listTsdLinks(): TsdLinkRecord[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(scopedKey(STORE_BASE));
    const parsed = raw ? (JSON.parse(raw) as TsdLinkRecord[]) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveTsdLink(record: TsdLinkRecord) {
  try {
    const next = [...listTsdLinks().filter((l) => l.accountId !== record.accountId), record];
    window.localStorage.setItem(scopedKey(STORE_BASE), JSON.stringify(next));
  } catch {
    /* noop */
  }
}

export function removeTsdLink(accountId: string) {
  try {
    const next = listTsdLinks().filter((l) => l.accountId !== accountId);
    window.localStorage.setItem(scopedKey(STORE_BASE), JSON.stringify(next));
  } catch {
    /* noop */
  }
}
