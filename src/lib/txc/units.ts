import { SATS_PER_TXC, TXC_DECIMALS } from "./network";

export function satsToTxc(sats: number | bigint): number {
  return Number(sats) / SATS_PER_TXC;
}

export function txcToSats(txc: number | string): number {
  const n = typeof txc === "string" ? parseFloat(txc) : txc;
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * SATS_PER_TXC);
}

export function formatTxc(sats: number | bigint, opts: { withUnit?: boolean } = {}): string {
  const txc = satsToTxc(sats);
  const str = txc.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: TXC_DECIMALS,
  });
  return opts.withUnit === false ? str : `${str} TXC`;
}

/**
 * Compact display formatter: max 10 characters total, up to 5 decimal places.
 * No thousands separators. Trims decimals first, then falls back to integer.
 */
export function formatTxcCompact(sats: number | bigint): string {
  const txc = satsToTxc(sats);
  const MAX_LEN = 10;
  const MAX_DEC = 5;
  const intPart = Math.trunc(Math.abs(txc)).toString();
  const sign = txc < 0 ? "-" : "";
  // available room for "." + decimals
  const roomForDecimals = MAX_LEN - sign.length - intPart.length - 1;
  const decimals = Math.max(0, Math.min(MAX_DEC, roomForDecimals));
  if (decimals <= 0) {
    // no room for decimals; just the integer (may exceed MAX_LEN for huge balances)
    return `${sign}${intPart}`;
  }
  const fixed = txc.toFixed(decimals);
  return fixed;
}


export function formatFiat(usd: number | null | undefined): string {
  if (usd == null || !Number.isFinite(usd)) return "—";
  return usd.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
