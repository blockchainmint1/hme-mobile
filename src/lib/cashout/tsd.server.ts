/**
 * Server-side HTTP client for the TSD Swap public cash-out API
 * (https://tsd.honest.money). Kept off the device so the shared API key
 * never ships in a bundle and the endpoint host can change server-side.
 *
 * Contract lives in docs/tsd-cashout-api.md.
 */
import type { CashoutCouponPreview, CashoutOrder, CashoutSettings } from "./tsd";

const DEFAULT_BASE = "https://tsd.honest.money";

function baseUrl(): string {
  return (process.env["TSD_SWAP_URL"] || DEFAULT_BASE).replace(/\/+$/, "");
}

function authHeaders(): Record<string, string> {
  const key = process.env["TSD_CASHOUT_API_KEY"];
  return key ? { "x-api-key": key } : {};
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${baseUrl()}${path}`, {
      ...init,
      headers: {
        accept: "application/json",
        ...(init?.body ? { "content-type": "application/json" } : {}),
        ...authHeaders(),
        ...(init?.headers as Record<string, string> | undefined),
      },
    });
  } catch {
    throw new Error("Couldn't reach the TSD cash-out service. Try again in a moment.");
  }

  const text = await res.text();
  if (!res.ok) {
    let msg = `Cash-out service error (${res.status})`;
    try {
      const j = JSON.parse(text) as { error?: string; message?: string };
      if (j.error || j.message) msg = String(j.error ?? j.message);
    } catch {
      /* keep the status message */
    }
    if (res.status === 404) {
      msg = "The cash-out service isn't available yet. Please try again later.";
    }
    throw new Error(msg);
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error("The cash-out service returned an unexpected response.");
  }
}

export function fetchCashoutSettings(): Promise<CashoutSettings> {
  return call<CashoutSettings>("/api/public/v1/cashout/settings");
}

export function previewCoupon(code: string): Promise<CashoutCouponPreview> {
  return call<CashoutCouponPreview>("/api/public/v1/cashout/coupon", {
    method: "POST",
    body: JSON.stringify({ code }),
  });
}

export interface CreateArgs {
  amount: number;
  payoutAddress: string;
  refundAddress: string;
  couponCode: string | null;
  accountToken: string | null;
}

export function createCashout(args: CreateArgs): Promise<CashoutOrder> {
  return call<CashoutOrder>("/api/public/v1/cashout/orders", {
    method: "POST",
    body: JSON.stringify({
      amount: args.amount,
      payoutAddress: args.payoutAddress,
      refundAddress: args.refundAddress,
      couponCode: args.couponCode,
      source: "hme-wallet",
    }),
    headers: args.accountToken ? { authorization: `Bearer ${args.accountToken}` } : {},
  });
}

export function fetchCashoutOrder(id: string): Promise<CashoutOrder> {
  return call<CashoutOrder>(`/api/public/v1/cashout/orders/${encodeURIComponent(id)}`);
}
