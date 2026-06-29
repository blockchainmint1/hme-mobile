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

// Derivation paths. The existing app derives under Bitcoin's coin type (0'),
// not a TEXITcoin-specific SLIP-44 slot — kept identical for seed compatibility.
export const DERIVATION_PATHS = {
  bip84: "m/84'/0'/0'", // native segwit, txc1... (default)
  bip49: "m/49'/0'/0'", // wrapped segwit
  bip44: "m/44'/0'/0'", // legacy, T...
} as const;

export type DerivationKind = keyof typeof DERIVATION_PATHS;

export const URI_SCHEMES = ["texitcoin", "TEXITCOIN"] as const;

// Public mempool-style explorer / REST backend for TEXITcoin.
export const MEMPOOL_BASE = "https://mempool.texitcoin.org";
export const MEMPOOL_API = `${MEMPOOL_BASE}/api`;
