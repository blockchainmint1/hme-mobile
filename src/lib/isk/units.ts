import { SATS_PER_ISK, ISK_DECIMALS } from "./network";

export function satsToIsk(sats: number | bigint): number {
  return Number(sats) / SATS_PER_ISK;
}

export function iskToSats(isk: number | string): number {
  const n = typeof isk === "string" ? parseFloat(isk) : isk;
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * SATS_PER_ISK);
}

export function formatIsk(sats: number | bigint, opts: { withUnit?: boolean } = {}): string {
  const isk = satsToIsk(sats);
  const str = isk.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: ISK_DECIMALS,
  });
  return opts.withUnit === false ? str : `${str} ISK`;
}

export function formatIskCompact(sats: number | bigint): string {
  const isk = satsToIsk(sats);
  const MAX_LEN = 10;
  const MAX_DEC = 5;
  const intPart = Math.trunc(Math.abs(isk)).toString();
  const sign = isk < 0 ? "-" : "";
  const roomForDecimals = MAX_LEN - sign.length - intPart.length - 1;
  const decimals = Math.max(0, Math.min(MAX_DEC, roomForDecimals));
  if (decimals <= 0) return `${sign}${intPart}`;
  return isk.toFixed(decimals);
}
