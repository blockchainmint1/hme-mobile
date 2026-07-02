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

// BIP-44/49/84 account-level paths: m/purpose'/coin'/account'
// Scan appends /change/index — do NOT harden a fourth segment here or the
// full path becomes non-standard and won't match funds derived by the HMW
// reference wallet (which uses m/44'/969696'/0'/0/i for ISK legacy).
export const ISK_DERIVATION_PATHS = {
  bip84: `m/84'/${ISK_COIN_TYPE}'/0'`,
  bip49: `m/49'/${ISK_COIN_TYPE}'/0'`,
  bip44: `m/44'/${ISK_COIN_TYPE}'/0'`,
} as const;

export const ISK_DERIVATION_BASE = ISK_DERIVATION_PATHS;

export type IskDerivationKind = keyof typeof ISK_DERIVATION_PATHS;

// HMW convention: ISK addresses are legacy (K…) BIP44 by default. The
// user's shared BIP32 root may have been unlocked as BIP84 for TXC, but
// their ISK funds live on the legacy path — always scan ISK as BIP44.
export const ISK_DEFAULT_KIND: IskDerivationKind = "bip44";

export const ISK_URI_SCHEMES = ["iskandercoin", "isk"] as const;

export const ISK_MEMPOOL_BASE = "https://mempool.iskandercoin.com";
export const ISK_MEMPOOL_API = `${ISK_MEMPOOL_BASE}/api`;
