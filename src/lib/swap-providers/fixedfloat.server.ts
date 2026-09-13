/**
 * FixedFloat route (server-only). Non-custodial float-rate exchange.
 * Every JSON call is signed with HMAC-SHA256 over the request body.
 */
import { createHmac } from "crypto";
import type { StableDestination, UtxoSwapCoin } from "@/lib/thorchain/assets";
import type { QuoteRequest, SwapOrder, SwapOrderStatus, SwapQuote } from "./types";
import { decimalStringToSats, satsToDecimalString } from "./amount";

const BASE = "https://ff.io/api/v2";

const FROM_CCY: Record<UtxoSwapCoin, string> = { ltc: "LTC", doge: "DOGE" };

const CHAIN_SUFFIX: Record<StableDestination["chain"], string> = {
  eth: "ETH",
  base: "BASE",
  bsc: "BSC",
};

function toCcy(dest: StableDestination) {
  return `${dest.symbol.toUpperCase()}${CHAIN_SUFFIX[dest.chain]}`;
}

function creds() {
  return {
    key: process.env["FIXEDFLOAT_API_KEY"] ?? null,
    secret: process.env["FIXEDFLOAT_API_SECRET"] ?? null,
  };
}

export function fixedfloatEnabled() {
  const c = creds();
  return !!c.key && !!c.secret;
}

async function call<T>(path: string, body: unknown): Promise<T> {
  const c = creds();
  if (!c.key || !c.secret) throw new Error("FixedFloat is not configured on this app.");
  const payload = JSON.stringify(body);
  const sign = createHmac("sha256", c.secret).update(payload).digest("hex");
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json; charset=UTF-8",
      "X-API-KEY": c.key,
      "X-API-SIGN": sign,
    },
    body: payload,
    signal: AbortSignal.timeout(15_000),
  });
  const text = await res.text();
  let json: { code?: number | string; msg?: string; data?: T } | null = null;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`FixedFloat returned an unreadable response (${res.status})`);
  }
  const code = Number(json?.code ?? 0);
  if (!res.ok || code !== 0 || !json?.data) {
    throw new Error(json?.msg ? `FixedFloat: ${json.msg}` : `FixedFloat error ${res.status}`);
  }
  return json.data;
}

interface RawPrice {
  from: { amount: string; min: string; max: string };
  to: { amount: string; rate?: string };
  errors?: string[];
}

export async function fixedfloatQuote(req: QuoteRequest): Promise<SwapQuote> {
  const data = await call<RawPrice>("/price", {
    type: "float",
    fromCcy: FROM_CCY[req.coin],
    toCcy: toCcy(req.dest),
    direction: "from",
    amount: satsToDecimalString(req.amountSats),
    ccies: false,
    usd: false,
    refundAddress: "",
  });
  if (data.errors?.length) throw new Error(`FixedFloat: ${data.errors.join(", ")}`);
  return {
    provider: "fixedfloat",
    amountOut: Number(data.to.amount),
    destAsset: req.dest.asset,
    totalBps: null,
    minInSats: data.from.min ? decimalStringToSats(data.from.min) : null,
    maxInSats: data.from.max ? decimalStringToSats(data.from.max) : null,
    etaSeconds: null,
    expiry: null,
  };
}

interface RawOrder {
  id: string;
  token: string;
  time?: { expiration?: number | null; left?: number | null };
  from: { address: string; amount: string };
  to: { amount: string };
}

export async function fixedfloatCreate(
  req: QuoteRequest,
): Promise<SwapOrder & { ref: { token: string } }> {
  const data = await call<RawOrder>("/create", {
    type: "float",
    fromCcy: FROM_CCY[req.coin],
    toCcy: toCcy(req.dest),
    direction: "from",
    amount: satsToDecimalString(req.amountSats),
    toAddress: req.destination,
    refundAddress: req.refundAddress,
  });
  return {
    provider: "fixedfloat",
    depositAddress: data.from.address,
    amountSats: decimalStringToSats(data.from.amount),
    memo: null,
    orderId: data.id,
    amountOut: Number(data.to.amount),
    destAsset: req.dest.asset,
    etaSeconds: null,
    expiry: data.time?.expiration ?? null,
    ref: { token: data.token },
  };
}

export async function fixedfloatStatus(id: string, token: string): Promise<SwapOrderStatus> {
  const data = await call<{ status: string; to?: { tx?: { id?: string | null } | null } }>(
    "/order",
    { id, token },
  );
  const s = String(data.status).toUpperCase();
  return {
    observed: s !== "NEW",
    finalised: ["WITHDRAW", "DONE"].includes(s),
    outboundSent: s === "DONE",
    outboundTxid: data.to?.tx?.id ?? null,
    raw: s,
    failed: ["EXPIRED", "EMERGENCY"].includes(s),
    message:
      s === "EMERGENCY"
        ? "FixedFloat needs a choice on this order — open it on their site to continue or refund."
        : null,
  };
}
