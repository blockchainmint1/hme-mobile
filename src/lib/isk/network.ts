/**
 * IskanderCoin (ISK) network parameters.
 * Bitcoin-style fork: P2PKH 0x2d ("K…"), P2SH 0x2c, WIF 0xad, bech32 HRP "isk",
 * SLIP-44 coin type 969696. BIP32 uses Bitcoin defaults (xpub/xprv), so the
 * ISK account can be derived from the same seed already unlocked for TXC.
 * All chain calls hit the mempool.space-compatible instance at mempool.iskandercoin.com.
 */
import type { Network } from "bitcoinjs-lib";

export const ISK_NETWORK: Network = {
  messagePrefix: "Iskander Signed Message:\n",
  bech32: "isk",
  bip32: {
    public: 0x0488b21e,
    private: 0x0488ade4,
  },
  pubKeyHash: 0x2d,
  scriptHash: 0x2c,
  wif: 0xad,
};

export const ISK_UNIT = "ISK";
export const ISK_DECIMALS = 8;
export const SATS_PER_ISK = 100_000_000;
export const ISK_COIN_TYPE = 969696;

export const ISK_DERIVATION_PATHS = {
  bip84: `m/84'/${ISK_COIN_TYPE}'/0'/0'`,
  bip49: `m/49'/${ISK_COIN_TYPE}'/0'/0'`,
  bip44: `m/44'/${ISK_COIN_TYPE}'/0'/0'`,
} as const;

// Convenience aliases used when we build /change/index paths.
export const ISK_DERIVATION_BASE = {
  bip84: `m/84'/${ISK_COIN_TYPE}'/0'`,
  bip49: `m/49'/${ISK_COIN_TYPE}'/0'`,
  bip44: `m/44'/${ISK_COIN_TYPE}'/0'`,
} as const;

export type IskDerivationKind = keyof typeof ISK_DERIVATION_PATHS;

export const ISK_URI_SCHEMES = ["iskandercoin", "isk"] as const;

export const ISK_MEMPOOL_BASE = "https://mempool.iskandercoin.com";
export const ISK_MEMPOOL_API = `${ISK_MEMPOOL_BASE}/api`;
