/**
 * ChangeNOW route (server-only). Non-custodial deposit-address exchange.
 * Every call needs the partner API key, quotes included.
 */
import type { StableDestination, UtxoSwapCoin } from "@/lib/thorchain/assets";
import type { QuoteRequest, SwapOrder, SwapOrderStatus, SwapQuote } from "./types";
import { decimalStringToSats, satsToDecimalString } from "./amount";

const BASE = "https://api.changenow.io/v2";

const FROM: Record<UtxoSwapCoin, { currency: string; network: string }> = {
  ltc: { currency: "ltc", network: "ltc" },
  doge: { currency: "doge", network: "doge" },
};

const TO_NETWORK: Record<StableDestination["chain"], string> = {
  eth: "eth",
  base: "base",
  bsc: "bsc",
};

function apiKey() {
  return process.env["CHANGENOW_API_KEY"] ?? null;
}

export function changenowEnabled() {
  return !!apiKey();
}

async function call<T>(path: string, init?: { method: "POST"; body: unknown }): Promise<T> {
  const key = apiKey();
  if (!key) throw new Error("ChangeNOW is not configured on this app.");
  const res = await fetch(`${BASE}${path}`, {
    method: init?.method ?? "GET",
    headers: {
      accept: "application/json",
      "x-changenow-api-key": key,
      ...(init ? { "content-type": "application/json" } : {}),
    },
    body: init ? JSON.stringify(init.body) : undefined,
    signal: AbortSignal.timeout(15_000),
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    // ChangeNOW answers auth failures with plain text, so surface it as-is.
    const snippet = text.trim().slice(0, 120) || `status ${res.status}`;
    throw new Error(res.status === 401 ? `ChangeNOW rejected the API key (${snippet})` : snippet);
  }
  if (!res.ok) {
    const msg =
      (json as { message?: string; error?: string }).message ??
      (json as { error?: string }).error ??
      `ChangeNOW error ${res.status}`;
    throw new Error(msg);
  }
  return json as T;
}

function pairParams(coin: UtxoSwapCoin, dest: StableDestination) {
  const from = FROM[coin];
  return {
    fromCurrency: from.currency,
    fromNetwork: from.network,
    toCurrency: dest.symbol.toLowerCase(),
    toNetwork: TO_NETWORK[dest.chain],
  };
}

export async function changenowQuote(req: QuoteRequest): Promise<SwapQuote> {
  const p = pairParams(req.coin, req.dest);
  const fromAmount = satsToDecimalString(req.amountSats);
  const q = new URLSearchParams({ ...p, fromAmount, flow: "standard", type: "direct" });
  const r = new URLSearchParams({ ...p, flow: "standard" });

  const [est, range] = await Promise.all([
    call<{ estimatedAmount: number; transactionSpeedForecast?: string; warningMessage?: string | null }>(
      `/exchange/estimated-amount?${q}`,
    ),
    call<{ minAmount: number; maxAmount: number | null }>(`/exchange/range?${r}`).catch(() => null),
  ]);

  // "10-60" minutes → take the upper bound as the ETA.
  const forecast = est.transactionSpeedForecast?.match(/(\d+)\s*-\s*(\d+)/);
  return {
    provider: "changenow",
    amountOut: Number(est.estimatedAmount),
    destAsset: req.dest.asset,
    totalBps: null,
    minInSats: range ? decimalStringToSats(range.minAmount) : null,
    maxInSats: range?.maxAmount ? decimalStringToSats(range.maxAmount) : null,
    etaSeconds: forecast ? Number(forecast[2]) * 60 : null,
    expiry: null,
    warning: est.warningMessage ?? null,
  };
}

export async function changenowCreate(req: QuoteRequest): Promise<SwapOrder> {
  const p = pairParams(req.coin, req.dest);
  const tx = await call<{
    id: string;
    payinAddress: string;
    payinExtraId?: string | null;
    fromAmount: number | string;
    toAmount: number | string;
    validUntil?: string | null;
  }>("/exchange", {
    method: "POST",
    body: {
      ...p,
      fromAmount: satsToDecimalString(req.amountSats),
      address: req.destination,
      refundAddress: req.refundAddress,
      flow: "standard",
    },
  });
  if (tx.payinExtraId) {
    throw new Error("ChangeNOW asked for a deposit memo, which this route can't provide.");
  }
  return {
    provider: "changenow",
    depositAddress: tx.payinAddress,
    amountSats: tx.fromAmount ? decimalStringToSats(tx.fromAmount) : req.amountSats,
    memo: null,
    orderId: tx.id,
    amountOut: Number(tx.toAmount ?? 0),
    destAsset: req.dest.asset,
    etaSeconds: null,
    expiry: tx.validUntil ? Math.floor(new Date(tx.validUntil).getTime() / 1000) : null,
  };
}

export async function changenowStatus(id: string): Promise<SwapOrderStatus> {
  const t = await call<{ status: string; payoutHash?: string | null }>(
    `/exchange/by-id?id=${encodeURIComponent(id)}`,
  );
  const s = t.status;
  return {
    observed: !["new", "waiting"].includes(s),
    finalised: ["sending", "finished"].includes(s),
    outboundSent: s === "finished",
    outboundTxid: t.payoutHash ?? null,
    raw: s,
    failed: ["failed", "refunded"].includes(s),
    message:
      s === "verifying"
        ? "ChangeNOW has paused this swap for a verification check."
        : s === "refunded"
          ? "ChangeNOW refunded this swap to your wallet."
          : null,
  };
}
