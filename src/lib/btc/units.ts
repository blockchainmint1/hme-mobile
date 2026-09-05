import { SATS_PER_BTC, BTC_DECIMALS } from "./network";

export function satsToBtc(sats: number | bigint): number {
  return Number(sats) / SATS_PER_BTC;
}

export function ltcToSats(btc: number | string): number {
  const n = typeof btc === "string" ? parseFloat(btc) : btc;
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * SATS_PER_BTC);
}

export function formatBtc(sats: number | bigint, opts: { withUnit?: boolean } = {}): string {
  const btc = satsToBtc(sats);
  const str = btc.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: BTC_DECIMALS,
  });
  return opts.withUnit === false ? str : `${str} BTC`;
}

export function formatBtcCompact(sats: number | bigint): string {
  const btc = satsToBtc(sats);
  const MAX_LEN = 10;
  const MAX_DEC = 5;
  const intPart = Math.trunc(Math.abs(btc)).toString();
  const sign = btc < 0 ? "-" : "";
  const roomForDecimals = MAX_LEN - sign.length - intPart.length - 1;
  const decimals = Math.max(0, Math.min(MAX_DEC, roomForDecimals));
  if (decimals <= 0) return `${sign}${intPart}`;
  return btc.toFixed(decimals);
}
