/**
 * Quote every available LTC/DOGE → stablecoin route in parallel and rank them
 * by the amount the user actually receives. THORChain is always available;
 * the instant-exchange routes appear only when their credentials are set.
 */
import { fetchQuote as thorFetchQuote, fetchTxStatus } from "@/lib/thorchain/thornode.server";
import { fromThorAmount, THOR_UNIT, type StableDestination } from "@/lib/thorchain/assets";
import type {
  QuoteRequest,
  SwapOrder,
  SwapOrderStatus,
  SwapProviderId,
  SwapQuote,
} from "./types";
import {
  sideshiftCreate,
  sideshiftOrderEnabled,
  sideshiftQuote,
  sideshiftQuoteEnabled,
  sideshiftStatus,
} from "./sideshift.server";
import {
  fixedfloatCreate,
  fixedfloatEnabled,
  fixedfloatQuote,
  fixedfloatStatus,
} from "./fixedfloat.server";

export interface QuoteResult {
  quotes: SwapQuote[];
  /** Providers we tried that failed, so the UI can explain the gap. */
  errors: { provider: SwapProviderId; message: string }[];
}

/** THORChain, expressed in the shared quote shape. */
async function thorQuote(req: QuoteRequest): Promise<SwapQuote> {
  const q = await thorFetchQuote({
    coin: req.coin,
    toAsset: req.dest.asset,
    amountSats: String(req.amountSats),
    destination: req.destination,
  });
  return {
    provider: "thorchain",
    amountOut: fromThorAmount(q.expected_amount_out),
    destAsset: req.dest.asset,
    totalBps: q.fees.total_bps ?? null,
    minInSats: q.recommended_min_amount_in ? Number(q.recommended_min_amount_in) : null,
    maxInSats: null,
    etaSeconds: q.total_swap_seconds ?? null,
    expiry: q.expiry,
    warning: q.warning ?? null,
  };
}

export async function quoteAllProviders(req: QuoteRequest): Promise<QuoteResult> {
  const tasks: { provider: SwapProviderId; run: () => Promise<SwapQuote> }[] = [
    { provider: "thorchain", run: () => thorQuote(req) },
  ];
  if (sideshiftQuoteEnabled() && sideshiftOrderEnabled()) {
    tasks.push({ provider: "sideshift", run: () => sideshiftQuote(req) });
  }
  if (fixedfloatEnabled()) tasks.push({ provider: "fixedfloat", run: () => fixedfloatQuote(req) });

  const settled = await Promise.all(
    tasks.map(async (t) => {
      try {
        return { ok: true as const, quote: await t.run() };
      } catch (err) {
        return {
          ok: false as const,
          provider: t.provider,
          message: err instanceof Error ? err.message : "Route unavailable",
        };
      }
    }),
  );

  const quotes = settled
    .filter((s): s is { ok: true; quote: SwapQuote } => s.ok)
    .map((s) => s.quote)
    .filter((q) => Number.isFinite(q.amountOut) && q.amountOut > 0)
    .sort((a, b) => b.amountOut - a.amountOut);

  const errors = settled
    .filter((s): s is { ok: false; provider: SwapProviderId; message: string } => !s.ok)
    .map(({ provider, message }) => ({ provider, message }));

  if (!quotes.length) {
    throw new Error(errors[0]?.message ?? "No swap route is available right now.");
  }
  return { quotes, errors };
}

/** Create the actual order with the chosen provider. */
export async function createProviderOrder(args: {
  provider: SwapProviderId;
  req: QuoteRequest;
  /** SideShift needs the quote id it issued. */
  quoteId?: string | null;
}): Promise<SwapOrder & { ref?: Record<string, string> }> {
  const { provider, req } = args;
  if (provider === "thorchain") {
    const q = await thorFetchQuote({
      coin: req.coin,
      toAsset: req.dest.asset,
      amountSats: String(req.amountSats),
      destination: req.destination,
    });
    return {
      provider: "thorchain",
      depositAddress: q.inbound_address,
      amountSats: req.amountSats,
      memo: q.memo,
      orderId: null,
      amountOut: Number(q.expected_amount_out) / THOR_UNIT,
      destAsset: req.dest.asset,
      etaSeconds: q.total_swap_seconds ?? null,
      expiry: q.expiry,
      warning: q.warning ?? null,
    };
  }
  if (provider === "sideshift") {
    // Re-quote so the rate is fresh at the moment of signing.
    const fresh = args.quoteId ? { quoteId: args.quoteId } : await sideshiftQuote(req);
    return sideshiftCreate({
      quoteId: "quoteId" in fresh ? fresh.quoteId : fresh.ref.quoteId,
      settleAddress: req.destination,
      refundAddress: req.refundAddress,
      dest: req.dest,
    });
  }
  return fixedfloatCreate(req);
}

export async function providerOrderStatus(args: {
  provider: SwapProviderId;
  orderId: string | null;
  txid: string;
  token?: string | null;
}): Promise<SwapOrderStatus> {
  if (args.provider === "thorchain") {
    const s = await fetchTxStatus(args.txid);
    return {
      observed: s.observed,
      finalised: s.finalised,
      outboundSent: s.outboundSent,
      outboundTxid: s.outboundTxid,
      raw: null,
    };
  }
  if (!args.orderId) throw new Error("Missing swap order id.");
  if (args.provider === "sideshift") return sideshiftStatus(args.orderId);
  if (!args.token) throw new Error("Missing FixedFloat order token.");
  return fixedfloatStatus(args.orderId, args.token);
}

export type { StableDestination };
