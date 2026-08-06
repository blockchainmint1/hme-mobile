/**
 * Client-safe types + config for the TSD → USDC cash-out (redemption) flow.
 *
 * The wallet never talks to tsd.honest.money directly: every call goes through
 * our own server functions in `tsd.functions.ts`, so the strict CSP
 * `connect-src` stays closed and an API key can be added without shipping a
 * new mobile build.
 *
 * Economics: TSD redeems 1:1 for USDC, minus a redemption fee (default 1%).
 * A coupon code — or a signed-in TSD account — can lower or waive that fee.
 * Refunds (wrong amount, expired order, failed payout) go back to the TXC
 * address the TSD came from, which we pass as `refundAddress`.
 *
 * NOTE: this is an off-ramp / exchange service, so it is gated behind
 * `exchangeFeaturesAllowed()` and never appears in the iOS build.
 */

/** Omni property id of the Texas Stable Dollar. */
export const TSD_PROPERTY_ID = 39;

/** The only payout asset we offer from the wallet today. */
export const CASHOUT_PAYOUT_LABEL = "USDC on Ethereum";
export const CASHOUT_PAYOUT_CHAIN = "eth";

export const ETH_ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;

export interface CashoutSettings {
  live: boolean;
  minAmount: number;
  maxAmount: number;
  /** Standard redemption fee in basis points (100 = 1%). */
  redeemFeeBps: number;
}

export interface CashoutCouponPreview {
  valid: boolean;
  code: string;
  redeemFeeBps: number | null;
  reason?: string | null;
}

export type CashoutOrderStatus =
  | "awaiting_deposit"
  | "detected"
  | "paying"
  | "released"
  | "refunded"
  | "expired"
  | "failed";

export interface CashoutOrder {
  id: string;
  status: CashoutOrderStatus | string;
  /** Legacy T… TEXITcoin address the TSD must be sent to. */
  depositAddress: string;
  amountExpected: number;
  /** Fee actually applied to this order, in basis points. */
  feeBps: number;
  /** USDC the user should receive once settled. */
  payoutAmount: number;
  payoutAddress: string;
  refundAddress: string | null;
  expiresAt: string | null;
  /** Ethereum tx hash of the USDC payout, once sent. */
  releaseTxHash: string | null;
  /** TXC txid of a refund, if the order was refunded. */
  refundTxid: string | null;
  error: string | null;
}

/** Apply a bps fee to a TSD amount and return the USDC payout. */
export function payoutFor(amount: number, feeBps: number): number {
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  const net = amount * (1 - feeBps / 10_000);
  return Math.max(0, Math.round(net * 1e6) / 1e6);
}

export function formatUsd(n: number): string {
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 });
}

export function feeLabel(bps: number): string {
  if (bps <= 0) return "0% (waived)";
  return `${(bps / 100).toFixed(bps % 100 === 0 ? 0 : 2)}%`;
}

/** Human copy for each order status. */
export function cashoutStatusLabel(status: string): string {
  switch (status) {
    case "awaiting_deposit":
      return "Waiting for your TSD";
    case "detected":
      return "TSD received — confirming";
    case "paying":
      return "Sending USDC";
    case "released":
      return "USDC sent";
    case "refunded":
      return "Refunded to your wallet";
    case "expired":
      return "Order expired";
    case "failed":
      return "Something went wrong";
    default:
      return "In progress";
  }
}

export function isTerminalCashoutStatus(status: string): boolean {
  return ["released", "refunded", "expired", "failed"].includes(status);
}
