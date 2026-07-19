/**
 * Litecoin (LTC) network parameters.
 * P2PKH 0x30 (L…), P2SH 0x32 (M…), bech32 HRP "ltc" (native segwit ltc1q…),
 * WIF 0xb0. SLIP-44 coin type 2. We hit the public Esplora-compatible
 * litecoinspace.org instance for chain data.
 */
import type { Network } from "bitcoinjs-lib";

export const LTC_NETWORK: Network = {
  messagePrefix: "\x19Litecoin Signed Message:\n",
  bech32: "ltc",
  bip32: { public: 0x019da462, private: 0x019d9cfe },
  pubKeyHash: 0x30,
  scriptHash: 0x32,
  wif: 0xb0,
};

export const LTC_UNIT = "LTC";
export const LTC_DECIMALS = 8;
export const SATS_PER_LTC = 100_000_000;
export const LTC_COIN_TYPE = 2;

export const LTC_DERIVATION_PATHS = {
  bip84: `m/84'/${LTC_COIN_TYPE}'/0'`,
  bip49: `m/49'/${LTC_COIN_TYPE}'/0'`,
  bip44: `m/44'/${LTC_COIN_TYPE}'/0'`,
} as const;

export type LtcDerivationKind = keyof typeof LTC_DERIVATION_PATHS;

// LTC users overwhelmingly use native segwit ltc1q… since 2017.
export const LTC_DEFAULT_KIND: LtcDerivationKind = "bip84";

export const LTC_URI_SCHEMES = ["litecoin"] as const;

export const LTC_MEMPOOL_BASE = "https://litecoinspace.org";
export const LTC_MEMPOOL_API = `${LTC_MEMPOOL_BASE}/api`;
