/**
 * Exchange partner compliance log (server-only).
 *
 * FixedFloat (and SideShift) require the integrator to retain, for one year,
 * the IP address, User-Agent and browser language list of the person who paid
 * for an order, and to be able to tie that back to a specific exchange.
 *
 * Rows are written with the service role, are unreadable by any app user, and
 * a nightly database job deletes them 13 months after creation.
 */
import type { SwapProviderId } from "./types";

/** Providers that are third-party exchanges (THORChain is a public AMM — nothing to report). */
const EXCHANGE_PROVIDERS: SwapProviderId[] = ["sideshift", "fixedfloat"];

export function providerNeedsComplianceLog(provider: SwapProviderId) {
  return EXCHANGE_PROVIDERS.includes(provider);
}

function firstIp(value: string | null): string | null {
  if (!value) return null;
  const first = value.split(",")[0]?.trim();
  return first && first.length <= 64 ? first : null;
}

/** Best-effort client fingerprint from the incoming request headers. */
export function readRequestIdentity(headers: Headers) {
  return {
    ip_address:
      firstIp(headers.get("cf-connecting-ip")) ??
      firstIp(headers.get("x-real-ip")) ??
      firstIp(headers.get("x-forwarded-for")),
    user_agent: headers.get("user-agent")?.slice(0, 500) ?? null,
    lang_list: headers.get("accept-language")?.slice(0, 300) ?? null,
  };
}

export interface ComplianceRecord {
  provider: SwapProviderId;
  order_id: string | null;
  deposit_address: string | null;
  from_coin: string;
  amount_sats: number;
  dest_asset: string | null;
  dest_address: string | null;
  ip_address: string | null;
  user_agent: string | null;
  lang_list: string | null;
}

/** Never let logging break a swap — record failures to the server log only. */
export async function recordExchangeOrder(record: ComplianceRecord) {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("exchange_compliance_log").insert(record);
    if (error) console.error("[compliance] insert failed", error.message);
  } catch (err) {
    console.error("[compliance] insert threw", err instanceof Error ? err.message : err);
  }
}

/** Attach the on-chain deposit transaction id once we know it. */
export async function attachExchangeTxid(args: {
  provider: SwapProviderId;
  orderId: string;
  txid: string;
}) {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    if (!/^[0-9a-f]{64}$/i.test(args.txid)) return;
    const { data: order } = await supabaseAdmin.from("exchange_compliance_log").select("deposit_address, from_coin, amount_sats").eq("provider", args.provider).eq("order_id", args.orderId).is("txid", null).maybeSingle();
    if (!order?.deposit_address) return;
    const bases: Record<string, string> = { LTC: "https://ltcbook.nownodes.io/api/v2", DOGE: "https://dogebook.nownodes.io/api/v2" };
    const base = bases[order.from_coin.toUpperCase()];
    const key = process.env["NOWNODES_API_KEY"];
    if (!base || !key) return;
    const response = await fetch(`${base}/tx/${args.txid}`, { headers: { "api-key": key, accept: "application/json" }, redirect: "error", signal: AbortSignal.timeout(10_000) });
    if (!response.ok) return;
    const tx = await response.json() as { txid?: string; vout?: { addresses?: string[]; value?: string }[] };
    if (tx.txid?.toLowerCase() !== args.txid.toLowerCase() || !tx.vout?.some((out) => out.addresses?.includes(order.deposit_address ?? "") && /^\d+$/.test(out.value ?? "") && BigInt(out.value ?? "0") >= BigInt(order.amount_sats))) return;
    await supabaseAdmin
      .from("exchange_compliance_log")
      .update({ txid: args.txid })
      .eq("provider", args.provider)
      .eq("order_id", args.orderId)
      .is("txid", null);
  } catch (err) {
    console.error("[compliance] txid update failed", err instanceof Error ? err.message : err);
  }
}
