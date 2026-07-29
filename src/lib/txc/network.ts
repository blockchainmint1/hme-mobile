/**
 * TEXITcoin network parameters.
 * Extracted from the existing TexitCoin Wallet (BlueWallet fork) patch files.
 * https://bitbucket.org/blockchainmint/texitcoin-mobile/  (patches/bitcoinjs-lib+6.1.6.patch et al.)
 */
import type { Network } from "bitcoinjs-lib";

export const TXC_NETWORK: Network = {
  messagePrefix: "\x18Bitcoin Signed Message:\n",
  bech32: "txc",
  bip32: {
    public: 0x0488b21e, // xpub
    private: 0x0488ade4, // xprv
  },
  pubKeyHash: 0x42, // legacy addresses start with 'T'
  scriptHash: 0x41,
  wif: 0xc1,
};

export const TXC_UNIT = "TXC";
export const TXC_DECIMALS = 8;
export const SATS_PER_TXC = 100_000_000;

/**
 * SLIP-0044 registered coin type for TEXITcoin. This is the CORRECT path
 * component for TXC derivation and is what the TXC Web Wallet, the wTXC
 * bridge and Honest Money Wallet all use.
 */
export const TXC_COIN_TYPE = 696969;

// Derivation paths.
// The `*-legacy` kinds use Bitcoin's coin type (0'). That was an accident in
// the original BlueWallet fork the old mobile app was built from — but real
// user funds live there, so we keep deriving and scanning them forever.
// The unsuffixed kinds are the standards-correct SLIP-0044 paths and are what
// new wallets and new receive addresses use.
export const DERIVATION_PATHS = {
  bip84: `m/84'/${TXC_COIN_TYPE}'/0'`, // native segwit, txc1...
  bip49: `m/49'/${TXC_COIN_TYPE}'/0'`, // wrapped segwit
  bip44: `m/44'/${TXC_COIN_TYPE}'/0'`, // legacy, T...
  "bip84-legacy": "m/84'/0'/0'", // old mobile app (BlueWallet fork)
  "bip49-legacy": "m/49'/0'/0'",
  "bip44-legacy": "m/44'/0'/0'",
} as const;

export type DerivationKind = keyof typeof DERIVATION_PATHS;

/** Every path we scan when computing a TXC account balance. */
export const ALL_DERIVATION_KINDS = [
  "bip84",
  "bip49",
  "bip44",
  "bip84-legacy",
  "bip49-legacy",
  "bip44-legacy",
] as const satisfies readonly DerivationKind[];

export type ScriptKind = "bip84" | "bip49" | "bip44";

/** Script type (address encoding) for a derivation kind — coin type stripped. */
export function scriptKindOf(kind: DerivationKind): ScriptKind {
  return kind.replace("-legacy", "") as ScriptKind;
}

export function isLegacyCoinTypeKind(kind: DerivationKind): boolean {
  return kind.endsWith("-legacy");
}

export const URI_SCHEMES = ["texitcoin", "TEXITCOIN"] as const;

// Public mempool-style explorer / REST backend for TEXITcoin.
export const MEMPOOL_BASE = "https://mempool.texitcoin.org";
export const MEMPOOL_API = `${MEMPOOL_BASE}/api`;
