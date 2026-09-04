/**
 * Bitcoin (BTC) network parameters.
 * P2PKH 0x00 (1…), P2SH 0x05 (3…), bech32 HRP "bc" (native segwit bc1q…),
 * WIF 0x80. SLIP-44 coin type 0. Chain data comes from Esplora-compatible
 * backends (mempool.space / blockstream.info) via our same-origin proxy.
 */
import type { Network } from "bitcoinjs-lib";

export const BTC_NETWORK: Network = {
  messagePrefix: "\x18Bitcoin Signed Message:\n",
  bech32: "bc",
  bip32: { public: 0x0488b21e, private: 0x0488ade4 },
  pubKeyHash: 0x00,
  scriptHash: 0x05,
  wif: 0x80,
};

export const BTC_UNIT = "BTC";
export const BTC_DECIMALS = 8;
export const SATS_PER_BTC = 100_000_000;
export const BTC_COIN_TYPE = 0;

export const BTC_DERIVATION_PATHS = {
  bip84: `m/84'/${BTC_COIN_TYPE}'/0'`,
  bip49: `m/49'/${BTC_COIN_TYPE}'/0'`,
  bip44: `m/44'/${BTC_COIN_TYPE}'/0'`,
} as const;

export type BtcDerivationKind = keyof typeof BTC_DERIVATION_PATHS;

// Native segwit bc1q… is the modern default.
export const BTC_DEFAULT_KIND: BtcDerivationKind = "bip84";


export const BTC_URI_SCHEMES = ["bitcoin"] as const;

// User-facing explorer links go direct…
export const BTC_MEMPOOL_BASE = "https://mempool.space";
// …but data calls go through our same-origin proxy (/api/utxo/btc) so the
// strict CSP `connect-src` doesn't block them and the native shell can
// forward them via the server-fn bridge.
export const BTC_MEMPOOL_API = "/api/utxo/btc";
