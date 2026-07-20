/**
 * Dogecoin (DOGE) network parameters.
 * P2PKH 0x1e (D…), P2SH 0x16, WIF 0x9e. No native segwit on mainnet, so
 * only BIP44 (legacy D… addresses) is used. SLIP-44 coin type 3.
 *
 * The `bech32` field on Network is required by bitcoinjs-lib's type but is
 * never exercised for DOGE — we never call p2wpkh/p2wsh with this network.
 */
import type { Network } from "bitcoinjs-lib";

export const DOGE_NETWORK: Network = {
  messagePrefix: "\x19Dogecoin Signed Message:\n",
  bech32: "doge",
  bip32: { public: 0x02facafd, private: 0x02fac398 },
  pubKeyHash: 0x1e,
  scriptHash: 0x16,
  wif: 0x9e,
};

export const DOGE_UNIT = "DOGE";
export const DOGE_DECIMALS = 8;
export const SATS_PER_DOGE = 100_000_000;
export const DOGE_COIN_TYPE = 3;

export const DOGE_DERIVATION_PATHS = {
  bip44: `m/44'/${DOGE_COIN_TYPE}'/0'`,
} as const;

export type DogeDerivationKind = keyof typeof DOGE_DERIVATION_PATHS;

// DOGE mainnet has no segwit; the reference wallet uses legacy D… only.
export const DOGE_DEFAULT_KIND: DogeDerivationKind = "bip44";

export const DOGE_URI_SCHEMES = ["dogecoin"] as const;

// Trezor public Blockbook v2 instance. Rate-limited but free — the user
// approved this as a temporary backend; something first-party will replace it.
export const DOGE_BLOCKBOOK_BASE = "https://doge1.trezor.io";
export const DOGE_BLOCKBOOK_API = `${DOGE_BLOCKBOOK_BASE}/api/v2`;

// User-facing explorer for tx / address links.
export const DOGE_EXPLORER_BASE = "https://dogechain.info";
