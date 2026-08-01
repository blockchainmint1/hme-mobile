/**
 * THORChain asset helpers (client-safe).
 *
 * THORChain is a native cross-chain AMM: you send a plain LTC/DOGE transaction
 * to a vault address with a memo in an OP_RETURN, and the network pays out the
 * destination asset to your address on the other chain. No wrapping, no bridge,
 * no custodian.
 *
 * All THORChain amounts are fixed 1e8 ("tor" units), regardless of the asset's
 * own decimals — including USDC/USDT.
 */

/** THORChain's universal 8-decimal fixed point. */
export const THOR_UNIT = 100_000_000;

export type UtxoSwapCoin = "ltc" | "doge";

/** Source assets we can swap out of, keyed by our internal coin id. */
export const THOR_SOURCE_ASSET: Record<UtxoSwapCoin, string> = {
  ltc: "LTC.LTC",
  doge: "DOGE.DOGE",
};

export interface StableDestination {
  /** Full THORChain asset string, e.g. BASE.USDC-0X8335… */
  asset: string;
  /** Display symbol, e.g. USDC */
  symbol: string;
  /** Our EVM chain id, so we can show the right network name / explorer. */
  chain: "eth" | "base" | "bsc";
  label: string;
}

/**
 * Stablecoin pools we're willing to route into. The live list is filtered
 * against THORChain's available pools at request time — a pool can be halted
 * or staged, in which case we simply don't offer it.
 */
export const STABLE_DESTINATIONS: StableDestination[] = [
  {
    asset: "BASE.USDC-0X833589FCD6EDB6E08F4C7C32D4F71B54BDA02913",
    symbol: "USDC",
    chain: "base",
    label: "USDC on Base",
  },
  {
    asset: "ETH.USDC-0XA0B86991C6218B36C1D19D4A2E9EB0CE3606EB48",
    symbol: "USDC",
    chain: "eth",
    label: "USDC on Ethereum",
  },
  {
    asset: "ETH.USDT-0XDAC17F958D2EE523A2206206994597C13D831EC7",
    symbol: "USDT",
    chain: "eth",
    label: "USDT on Ethereum",
  },
  {
    asset: "BSC.USDC-0X8AC76A51CC950D9822D68B83FE1AD97B32CD580D",
    symbol: "USDC",
    chain: "bsc",
    label: "USDC on BNB Chain",
  },
  {
    asset: "BSC.USDT-0X55D398326F99059FF775485246999027B3197955",
    symbol: "USDT",
    chain: "bsc",
    label: "USDT on BNB Chain",
  },
];

/** 1e8 integer string → human number. */
export function fromThorAmount(v: string | number): number {
  return Number(v) / THOR_UNIT;
}

export function formatThorAmount(v: string | number, maxFrac = 6): string {
  return fromThorAmount(v).toLocaleString(undefined, { maximumFractionDigits: maxFrac });
}

/** THORChain quote shape (only the fields we rely on). */
export interface ThorQuote {
  inbound_address: string;
  memo: string;
  expected_amount_out: string;
  expiry: number;
  fees: {
    asset: string;
    affiliate: string;
    outbound: string;
    liquidity: string;
    total: string;
    slippage_bps: number;
    total_bps: number;
  };
  outbound_delay_seconds?: number;
  total_swap_seconds?: number;
  recommended_min_amount_in?: string;
  dust_threshold?: string;
  max_streaming_quantity?: number;
  streaming_swap_seconds?: number;
  warning?: string;
  notes?: string;
  router?: string;
}

export interface ThorTxStatus {
  observed: boolean;
  finalised: boolean;
  outboundSent: boolean;
  outboundTxid: string | null;
  outboundChain: string | null;
  secondsRemaining: number | null;
}
