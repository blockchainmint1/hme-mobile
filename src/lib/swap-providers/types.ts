/**
 * Provider-agnostic types for LTC/DOGE → stablecoin swaps.
 *
 * THORChain is one route among several. Instant-exchange providers (SideShift,
 * FixedFloat) are non-custodial deposit-address flows: we ask for a quote, the
 * provider gives us a deposit address, and we send an ordinary LTC/DOGE
 * transaction to it — signed on this device, exactly like a normal send. Only
 * THORChain needs an OP_RETURN memo.
 */
import type { StableDestination, UtxoSwapCoin } from "@/lib/thorchain/assets";

export type SwapProviderId = "thorchain" | "sideshift" | "fixedfloat";

export interface SwapProviderMeta {
  id: SwapProviderId;
  label: string;
  /** Short plain-language description of how the route works. */
  blurb: string;
}

export const SWAP_PROVIDERS: Record<SwapProviderId, SwapProviderMeta> = {
  thorchain: {
    id: "thorchain",
    label: "THORChain",
    blurb: "Native cross-chain AMM. No account, no custodian — costs more on small trades.",
  },
  sideshift: {
    id: "sideshift",
    label: "SideShift",
    blurb: "Non-custodial instant exchange. Usually the cheapest spread.",
  },
  fixedfloat: {
    id: "fixedfloat",
    label: "FixedFloat",
    blurb: "Non-custodial instant exchange, floating rate.",
  },
};

/** A comparable quote from any provider. */
export interface SwapQuote {
  provider: SwapProviderId;
  /** Human-readable expected amount out, in destination units (e.g. 41.83). */
  amountOut: number;
  /** Destination asset we quoted for. */
  destAsset: string;
  /** All-in cost versus mid-market, in basis points, when the provider tells us. */
  totalBps: number | null;
  /** Minimum / maximum source amount in sats, when known. */
  minInSats: number | null;
  maxInSats: number | null;
  /** Estimated completion in seconds. */
  etaSeconds: number | null;
  /** Unix seconds after which the quote must be refreshed. */
  expiry: number | null;
  warning?: string | null;
}

/** Everything needed to actually send the inbound transaction. */
export interface SwapOrder {
  provider: SwapProviderId;
  /** Where to send the LTC/DOGE. */
  depositAddress: string;
  /** Exact amount to send, in sats — providers can require an exact amount. */
  amountSats: number;
  /** OP_RETURN memo (THORChain only). */
  memo: string | null;
  /** Provider order id, used for status polling. */
  orderId: string | null;
  amountOut: number;
  destAsset: string;
  etaSeconds: number | null;
  expiry: number | null;
  warning?: string | null;
}

export interface SwapOrderStatus {
  /** Provider saw the deposit. */
  observed: boolean;
  /** Exchange executed. */
  finalised: boolean;
  /** Payout sent on the destination chain. */
  outboundSent: boolean;
  outboundTxid: string | null;
  /** Raw provider status, for display when something unusual happens. */
  raw: string | null;
  failed?: boolean;
  message?: string | null;
}

export interface QuoteRequest {
  coin: UtxoSwapCoin;
  dest: StableDestination;
  amountSats: number;
  /** Destination EVM address that receives the stablecoin. */
  destination: string;
  /** Refund address on the source chain if the swap can't complete. */
  refundAddress: string;
}
