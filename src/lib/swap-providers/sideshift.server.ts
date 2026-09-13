/**
 * SideShift.ai route (server-only).
 *
 * Non-custodial instant exchange: we request a quote, create a fixed-rate
 * shift, and the user sends an ordinary LTC/DOGE transaction to the returned
 * deposit address. Quotes need only a free affiliate id; creating the shift
 * needs the account secret.
 */
import type { StableDestination, UtxoSwapCoin } from "@/lib/thorchain/assets";
import type { QuoteRequest, SwapOrder, SwapOrderStatus, SwapQuote } from "./types";
import { decimalStringToSats, satsToDecimalString } from "./amount";

const BASE = "https://sideshift.ai/api/v2";

const DEPOSIT: Record<UtxoSwapCoin, { coin: string; network: string }> = {
  ltc: { coin: "LTC", network: "litecoin" },
  doge: { coin: "DOGE", network: "doge" },
};

const SETTLE_NETWORK: Record<StableDestination["chain"], string> = {
  eth: "ethereum",
  base: "base",
  bsc: "bsc",
};

function creds() {
  return {
    affiliateId: process.env["SIDESHIFT_AFFILIATE_ID"] ?? null,
    secret: process.env["SIDESHIFT_SECRET"] ?? null,
  };
}

export function sideshiftQuoteEnabled() {
  return !!creds().affiliateId;
}

export function sideshiftOrderEnabled() {
  const c = creds();
  return !!c.affiliateId && !!c.secret;
}

async function call<T>(
  path: string,
  init: { method: "GET" | "POST"; body?: unknown; withSecret?: boolean },
): Promise<T> {
  const c = creds();
  const headers: Record<string, string> = { accept: "application/json" };
  if (init.body) headers["content-type"] = "application/json";
  if (init.withSecret) {
    if (!c.secret) throw new Error("SideShift is not fully configured on this app.");
    headers["x-sideshift-secret"] = c.secret;
  }
  const res = await fetch(`${BASE}${path}`, {
    method: init.method,
    headers,
    body: init.body ? JSON.stringify(init.body) : undefined,
    signal: AbortSignal.timeout(15_000),
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`SideShift returned an unreadable response (${res.status})`);
  }
  const err = (json as { error?: { message?: string } }).error;
  if (!res.ok || err) {
    throw new Error(err?.message ?? `SideShift error ${res.status}`);
  }
  return json as T;
}

interface RawPair {
  min: string;
  max: string;
  rate: string;
  depositCoin: string;
  settleCoin: string;
}

interface RawQuote {
  id: string;
  depositAmount: string;
  settleAmount: string;
  expiresAt: string;
  rate: string;
}

/** Quote id is needed later to create the shift, so we hand it back to the client. */
export interface SideshiftQuoteRef {
  quoteId: string;
}

export async function sideshiftQuote(
  req: QuoteRequest,
): Promise<SwapQuote & { ref: SideshiftQuoteRef }> {
  const c = creds();
  if (!c.affiliateId) throw new Error("SideShift is not configured on this app.");
  const from = DEPOSIT[req.coin];
  const settleNetwork = SETTLE_NETWORK[req.dest.chain];

  const pair = await call<RawPair>(
    `/pair/${from.coin}-${from.network}/${req.dest.symbol}-${settleNetwork}`,
    { method: "GET" },
  ).catch(() => null);

  const quote = await call<RawQuote>("/quotes", {
    method: "POST",
    body: {
      depositCoin: from.coin,
      depositNetwork: from.network,
      settleCoin: req.dest.symbol,
      settleNetwork,
      depositAmount: satsToDecimalString(req.amountSats),
      affiliateId: c.affiliateId,
    },
  });

  return {
    provider: "sideshift",
    amountOut: Number(quote.settleAmount),
    destAsset: req.dest.asset,
    totalBps: null,
    minInSats: pair ? decimalStringToSats(pair.min) : null,
    maxInSats: pair ? decimalStringToSats(pair.max) : null,
    etaSeconds: null,
    expiry: Math.floor(new Date(quote.expiresAt).getTime() / 1000),
    ref: { quoteId: quote.id },
  };
}

interface RawShift {
  id: string;
  depositAddress: string;
  depositMemo?: string | null;
  depositAmount: string;
  settleAmount: string;
  expiresAt: string;
  averageShiftSeconds?: string | number | null;
  status: string;
}

export async function sideshiftCreate(args: {
  quoteId: string;
  settleAddress: string;
  refundAddress: string;
  dest: StableDestination;
}): Promise<SwapOrder> {
  const c = creds();
  const shift = await call<RawShift>("/shifts/fixed", {
    method: "POST",
    withSecret: true,
    body: {
      quoteId: args.quoteId,
      settleAddress: args.settleAddress,
      refundAddress: args.refundAddress,
      affiliateId: c.affiliateId,
    },
  });
  if (shift.depositMemo) {
    // A memo on a UTXO deposit address would mean funds could be lost.
    throw new Error("SideShift asked for a deposit memo, which this route can't provide.");
  }
  const eta = shift.averageShiftSeconds ? Number(shift.averageShiftSeconds) : null;
  return {
    provider: "sideshift",
    depositAddress: shift.depositAddress,
    amountSats: decimalStringToSats(shift.depositAmount),
    memo: null,
    orderId: shift.id,
    amountOut: Number(shift.settleAmount),
    destAsset: args.dest.asset,
    etaSeconds: Number.isFinite(eta) ? eta : null,
    expiry: Math.floor(new Date(shift.expiresAt).getTime() / 1000),
  };
}

export async function sideshiftStatus(id: string): Promise<SwapOrderStatus> {
  const shift = await call<{ status: string; settleHash?: string | null }>(`/shifts/${id}`, {
    method: "GET",
  });
  const s = shift.status;
  const done = s === "settled";
  return {
    observed: !["waiting", "expired"].includes(s),
    finalised: ["settling", "settled"].includes(s),
    outboundSent: done,
    outboundTxid: shift.settleHash ?? null,
    raw: s,
    failed: ["expired", "refund", "refunding", "refunded"].includes(s),
    message:
      s === "review"
        ? "SideShift is reviewing this shift. It usually clears on its own."
        : s.startsWith("refund")
          ? "SideShift is refunding this swap to your wallet."
          : null,
  };
}
