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

// Chain data goes through our same-origin proxy (/api/utxo/doge), which
// fails over across several public Blockbook instances. Trezor's public
// node now 403s a lot of traffic and the alternatives send no CORS headers,
// so a direct browser fetch is not viable.
export const DOGE_BLOCKBOOK_BASE = "https://dogecoin.atomicwallet.io";
export const DOGE_BLOCKBOOK_API = "/api/utxo/doge";

// User-facing explorer for tx / address links.
export const DOGE_EXPLORER_BASE = "https://dogechain.info";
