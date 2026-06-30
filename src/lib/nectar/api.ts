/**
 * Nectar.Pay HTTP client. All calls go through our same-origin proxy
 * (`/api/nectar/pay/:id`) so we don't worry about CORS and so we can swap
 * the upstream host in one place.
 *
 * Spec: see HME-MOBILE-NFC-SPEC.md.
 */

export interface NectarMerchant {
  name: string;
  website?: string | null;
}

export interface NectarPayOption {
  /** Chain hint from the spec — e.g. "eth", "base", "btc", "sol", "tron". */
  chain: string;
  /** Token symbol, or null for the chain's native asset. */
  tokenSymbol: string | null;
  /** Server-side stable identifier — pass this back in the POST body. */
  key: string;
  /** Display label suggested by the server. */
  label: string;
}

export interface NectarInvoiceRead {
  id: string;
  status: "pending" | "paid" | "expired" | "cancelled" | string;
  fiat_amount: number;
  currency: string;
  description?: string | null;
  expires_at: string;
  merchant: NectarMerchant;
  chain: string | null;
  token_symbol: string | null;
  crypto_amount: number | null;
  rate: number | null;
  address: string | null;
  options: NectarPayOption[];
}

export interface NectarInvoiceSelected {
  id: string;
  status: string;
  chain: string;
  token_symbol: string | null;
  address: string;
  /** EXACT amount — never round. Decimal string from upstream. */
  crypto_amount: number | string;
  rate: number;
  fiat_amount: number;
  currency: string;
  expires_at: string;
}

export interface NectarApiError extends Error {
  status: number;
  body?: unknown;
}

function makeError(status: number, body: unknown): NectarApiError {
  const msg =
    typeof body === "object" && body && "error" in body
      ? String((body as { error: unknown }).error)
      : `Nectar request failed (${status})`;
  const err = new Error(msg) as NectarApiError;
  err.status = status;
  err.body = body;
  return err;
}

async function parse<T>(res: Response): Promise<T> {
  const text = await res.text();
  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    /* keep raw text */
  }
  if (!res.ok) throw makeError(res.status, body);
  return body as T;
}

export async function getInvoice(invoiceId: string, nonce: string): Promise<NectarInvoiceRead> {
  const res = await fetch(
    `/api/nectar/pay/${encodeURIComponent(invoiceId)}?t=${encodeURIComponent(nonce)}`,
    { method: "GET", headers: { Accept: "application/json" } },
  );
  return parse<NectarInvoiceRead>(res);
}

export async function selectOption(
  invoiceId: string,
  nonce: string,
  option: string,
): Promise<NectarInvoiceSelected> {
  const res = await fetch(
    `/api/nectar/pay/${encodeURIComponent(invoiceId)}?t=${encodeURIComponent(nonce)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ option }),
    },
  );
  return parse<NectarInvoiceSelected>(res);
}
