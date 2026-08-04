/**
 * Tron network constants.
 *
 * Tron runs the TVM (an EVM fork) but its node API is TronGrid's REST API,
 * not JSON-RPC — so none of our viem/EVM plumbing applies. All calls go
 * through our same-origin proxy (/api/tron) so the strict CSP allows them,
 * the TronGrid API key stays server-side, and the Capacitor shell can
 * forward them through the server-fn bridge like the other chains.
 */

/** SLIP-0044 coin type for Tron. */
export const TRON_COIN_TYPE = 195;
export const TRON_DERIVATION_PATH = `m/44'/${TRON_COIN_TYPE}'/0'/0/0`;

export const TRX_UNIT = "TRX";
export const TRX_DECIMALS = 6;
export const SUN_PER_TRX = 1_000_000;

/** Same-origin proxy base. */
export const TRON_API = "/api/tron";

export const TRON_EXPLORER = "https://tronscan.org/#";

export function explorerTxUrl(txid: string): string {
  return `${TRON_EXPLORER}/transaction/${txid}`;
}

export function explorerAddressUrl(address: string): string {
  return `${TRON_EXPLORER}/address/${address}`;
}

export interface Trc20Token {
  symbol: string;
  name: string;
  /** Base58 (T…) contract address. */
  contract: string;
  decimals: number;
}

/** Tokens we show by default. USDT-TRC20 is the reason Tron exists for us. */
export const TRC20_TOKENS: Trc20Token[] = [
  {
    symbol: "USDT",
    name: "Tether USD",
    contract: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
    decimals: 6,
  },
  {
    symbol: "USDC",
    name: "USD Coin",
    contract: "TEkxiTehnzSmSe2XqrBj4w32RUN966rdz8",
    decimals: 6,
  },
];

/**
 * Fee limit (in sun) we attach to TRC-20 transfers. Tron charges "energy";
 * without staked energy a USDT transfer burns roughly 27–65 TRX. The limit
 * is a cap, not a charge — unused amounts are not spent.
 */
export const TRC20_FEE_LIMIT_SUN = 100 * SUN_PER_TRX;
