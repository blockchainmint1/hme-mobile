/**
 * Server-side HTTP client for the TSD Swap public cash-out API
 * (https://tsd.honest.money). Kept off the device so the endpoint host can
 * change server-side and the strict CSP `connect-src` stays closed.
 *
 * Auth is the *user's own* TSD Swap API key, minted on their account page and
 * saved in wallet Settings. It travels from the device to our server function
 * and is forwarded as `x-api-key`; we never store it. The key identifies the
 * account, so TSD Swap decides the fee tier — the wallet does no pricing.
 *
 * Contract lives in docs/tsd-cashout-api.md.
 */
import type { CashoutOrder, CashoutSettings } from "./tsd";

const DEFAULT_BASE = "https://tsd.honest.money";

function baseUrl(): string {
  return (process.env["TSD_SWAP_URL"] || DEFAULT_BASE).replace(/\/+$/, "");
}

async function call<T>(path: string, apiKey: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${baseUrl()}${path}`, {
      ...init,
      headers: {
        accept: "application/json",
        "x-api-key": apiKey,
        ...(init?.body ? { "content-type": "application/json" } : {}),
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
    if (res.status === 401 || res.status === 403) {
      msg = "Your TSD Swap API key was rejected. Check it in Settings.";
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

export function fetchCashoutSettings(apiKey: string): Promise<CashoutSettings> {
  return call<CashoutSettings>("/api/public/v1/cashout/settings", apiKey);
}

export interface CreateArgs {
  apiKey: string;
  amount: number;
  payoutAddress: string;
  refundAddress: string;
}

export function createCashout(args: CreateArgs): Promise<CashoutOrder> {
  return call<CashoutOrder>("/api/public/v1/cashout/orders", args.apiKey, {
    method: "POST",
    body: JSON.stringify({
      amount: args.amount,
      payoutAddress: args.payoutAddress,
      refundAddress: args.refundAddress,
      source: "hme-wallet",
    }),
  });
}

export function fetchCashoutOrder(id: string, apiKey: string): Promise<CashoutOrder> {
  return call<CashoutOrder>(`/api/public/v1/cashout/orders/${encodeURIComponent(id)}`, apiKey);
}

/**
 * Permanent deposit address for the account that owns the key, plus its fee
 * tier. Safe to cache — TSD Swap keeps it stable per account.
 */
export function fetchDepositAddress(apiKey: string): Promise<unknown> {
  return call<unknown>("/api/public/v1/cashout/deposit-address", apiKey);
}

/** Save (once) where USDC payouts should go for this account. */
export function saveDepositPayoutAddress(apiKey: string, payoutAddress: string): Promise<unknown> {
  return call<unknown>("/api/public/v1/cashout/payout-address", apiKey, {
    method: "POST",
    body: JSON.stringify({ payoutAddress }),
  });
}
