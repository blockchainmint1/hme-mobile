/**
 * Bitcoin (BTC) network parameters.
 * P2PKH 0x30 (L…), P2SH 0x32 (M…), bech32 HRP "btc" (native segwit ltc1q…),
 * WIF 0xb0. SLIP-44 coin type 2. We hit the public Esplora-compatible
 * mempool.space instance for chain data.
 */
import type { Network } from "bitcoinjs-lib";

export const BTC_NETWORK: Network = {
  messagePrefix: "\x19Bitcoin Signed Message:\n",
  bech32: "btc",
  bip32: { public: 0x019da462, private: 0x019d9cfe },
  pubKeyHash: 0x30,
  scriptHash: 0x32,
  wif: 0xb0,
};

export const BTC_UNIT = "BTC";
export const BTC_DECIMALS = 8;
export const SATS_PER_BTC = 100_000_000;
export const BTC_COIN_TYPE = 2;

export const BTC_DERIVATION_PATHS = {
  bip84: `m/84'/${BTC_COIN_TYPE}'/0'`,
  bip49: `m/49'/${BTC_COIN_TYPE}'/0'`,
  bip44: `m/44'/${BTC_COIN_TYPE}'/0'`,
} as const;

export type BtcDerivationKind = keyof typeof BTC_DERIVATION_PATHS;

// BTC users overwhelmingly use native segwit ltc1q… since 2017.
export const BTC_DEFAULT_KIND: BtcDerivationKind = "bip84";

export const BTC_URI_SCHEMES = ["bitcoin"] as const;

// User-facing explorer links go direct…
export const BTC_MEMPOOL_BASE = "https://mempool.space";
// …but data calls go through our same-origin proxy (/api/utxo/btc) so the
// strict CSP `connect-src` doesn't block them and the native shell can
// forward them via the server-fn bridge.
export const BTC_MEMPOOL_API = "/api/utxo/btc";
