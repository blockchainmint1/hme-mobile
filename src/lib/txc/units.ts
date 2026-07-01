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

/**
 * Trim a numeric string (e.g. "1.234567") so the whole string is at most
 * maxLen characters and has at most maxDec decimal places. No rounding of
 * integer part — huge integers pass through unchanged.
 */
export function compactNumberString(s: string, maxLen = 10, maxDec = 5): string {
  if (!s.includes(".")) return s;
  const [whole, fracRaw] = s.split(".");
  const frac = fracRaw.replace(/0+$/, "");
  if (!frac) return whole;
  const room = maxLen - whole.length - 1; // for "."
  const decimals = Math.max(0, Math.min(maxDec, frac.length, room));
  if (decimals <= 0) return whole;
  return `${whole}.${frac.slice(0, decimals)}`;
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
