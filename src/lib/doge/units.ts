import { SATS_PER_DOGE, DOGE_DECIMALS } from "./network";

export function satsToDoge(sats: number | bigint): number {
  return Number(sats) / SATS_PER_DOGE;
}

export function dogeToSats(doge: number | string): number {
  const n = typeof doge === "string" ? parseFloat(doge) : doge;
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * SATS_PER_DOGE);
}

export function formatDoge(sats: number | bigint, opts: { withUnit?: boolean } = {}): string {
  const d = satsToDoge(sats);
  const str = d.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: DOGE_DECIMALS,
  });
  return opts.withUnit === false ? str : `${str} DOGE`;
}

export function formatDogeCompact(sats: number | bigint): string {
  const d = satsToDoge(sats);
  const MAX_LEN = 10;
  const MAX_DEC = 4;
  const intPart = Math.trunc(Math.abs(d)).toString();
  const sign = d < 0 ? "-" : "";
  const roomForDecimals = MAX_LEN - sign.length - intPart.length - 1;
  const decimals = Math.max(0, Math.min(MAX_DEC, roomForDecimals));
  if (decimals <= 0) return `${sign}${intPart}`;
  return d.toFixed(decimals);
}
