/**
 * Pairing with HME Vault (offline signer).
 *
 * Vault shows a QR containing watch-only account keys:
 *   {"hmvault":1,"fp":"73c5da0a","txc":{"84":"xpub…","49":"…","44":"…"},
 *    "isk":{…},"btc":{…},"ltc":{…},"doge":{"44":"…"},
 *    "evm":{"address":"0x…","path":"m/44'/60'/0'/0/0"}}
 *
 * These are account xpubs (standard xpub version bytes on every coin) at
 * m/<purpose>'/<coin>'/0' plus the master fingerprint. They cannot spend —
 * but they reveal history, so we store them per wallet profile and treat the
 * pairing flow like adding a wallet. Nothing here ever holds an xprv.
 */
import { scopedKey } from "@/lib/profiles";

export type VaultUtxoChain = "txc" | "isk" | "btc" | "ltc" | "doge";
export const VAULT_UTXO_CHAINS: VaultUtxoChain[] = ["txc", "isk", "btc", "ltc", "doge"];
/** Address purposes Vault may export per chain (doge is legacy-only). */
export const VAULT_PURPOSES: Record<VaultUtxoChain, number[]> = {
  txc: [44, 49, 84],
  isk: [44, 49, 84],
  btc: [44, 49, 84],
  ltc: [44, 49, 84],
  doge: [44],
};

export interface VaultPairing {
  v: 1;
  /** Master fingerprint, 8 lowercase hex chars. */
  fp: string;
  /** Account xpubs per chain, keyed by purpose ("44" | "49" | "84"). */
  chains: Partial<Record<VaultUtxoChain, Partial<Record<"44" | "49" | "84", string>>>>;
  evm?: { address: string; path: string };
  pairedAt: number;
}

const XPUB_RE = /^xpub[1-9A-HJ-NP-Za-km-z]{20,200}$/;

/**
 * Parse and validate a pairing payload. Throws with a user-readable message
 * on anything malformed — a bad pairing must fail loudly here, not at send
 * time.
 */
export function parsePairing(text: string): VaultPairing {
  let raw: unknown;
  try {
    raw = JSON.parse(text.trim());
  } catch {
    throw new Error("That QR code isn't a Vault pairing code.");
  }
  const o = raw as Record<string, unknown>;
  if (!o || typeof o !== "object" || o.hmvault !== 1)
    throw new Error("That QR code isn't a Vault pairing code.");
  const fp = typeof o.fp === "string" ? o.fp.toLowerCase() : "";
  if (!/^[0-9a-f]{8}$/.test(fp)) throw new Error("Pairing code is missing the wallet fingerprint.");

  const chains: VaultPairing["chains"] = {};
  let chainCount = 0;
  for (const c of VAULT_UTXO_CHAINS) {
    const entry = o[c] as Record<string, unknown> | undefined;
    if (!entry || typeof entry !== "object") continue;
    const purposes: Partial<Record<"44" | "49" | "84", string>> = {};
    for (const p of VAULT_PURPOSES[c]) {
      const xpub = entry[String(p)];
      if (typeof xpub !== "string") continue;
      if (!XPUB_RE.test(xpub)) throw new Error(`Pairing code has an invalid ${c.toUpperCase()} key.`);
      purposes[String(p) as "44" | "49" | "84"] = xpub;
    }
    if (Object.keys(purposes).length) {
      chains[c] = purposes;
      chainCount++;
    }
  }

  let evm: VaultPairing["evm"];
  const e = o.evm as Record<string, unknown> | undefined;
  if (e && typeof e === "object") {
    const address = typeof e.address === "string" ? e.address : "";
    const path = typeof e.path === "string" ? e.path : "";
    if (!/^0x[0-9a-fA-F]{40}$/.test(address)) throw new Error("Pairing code has an invalid Ethereum address.");
    if (!/^m\/44'\/60'\/\d+'\/0\/\d+$/.test(path)) throw new Error("Pairing code has an invalid Ethereum path.");
    evm = { address, path };
  }

  if (!chainCount && !evm) throw new Error("Pairing code contains no wallet keys.");
  return { v: 1, fp, chains, evm, pairedAt: Date.now() };
}

/* -----------------------------------------------------------------------
 * Per-profile persistence. Pairing data is watch-only (public keys), so it
 * lives unencrypted but namespaced to the wallet profile it belongs to.
 * --------------------------------------------------------------------- */

const STORE_BASE = "hme.vault-link.v1";

export function savePairing(profileId: string, p: VaultPairing): void {
  try {
    localStorage.setItem(scopedKey(STORE_BASE, profileId), JSON.stringify(p));
  } catch {
    /* quota — non-fatal, pairing can be redone */
  }
}

export function loadPairing(profileId: string): VaultPairing | null {
  try {
    const raw = localStorage.getItem(scopedKey(STORE_BASE, profileId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as VaultPairing;
    if (parsed?.v !== 1 || typeof parsed.fp !== "string") return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearPairing(profileId: string): void {
  try {
    localStorage.removeItem(scopedKey(STORE_BASE, profileId));
  } catch {
    /* noop */
  }
}
