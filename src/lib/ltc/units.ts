import { SATS_PER_LTC, LTC_DECIMALS } from "./network";

export function satsToLtc(sats: number | bigint): number {
  return Number(sats) / SATS_PER_LTC;
}

export function ltcToSats(ltc: number | string): number {
  const n = typeof ltc === "string" ? parseFloat(ltc) : ltc;
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * SATS_PER_LTC);
}

export function formatLtc(sats: number | bigint, opts: { withUnit?: boolean } = {}): string {
  const ltc = satsToLtc(sats);
  const str = ltc.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: LTC_DECIMALS,
  });
  return opts.withUnit === false ? str : `${str} LTC`;
}

export function formatLtcCompact(sats: number | bigint): string {
  const ltc = satsToLtc(sats);
  const MAX_LEN = 10;
  const MAX_DEC = 5;
  const intPart = Math.trunc(Math.abs(ltc)).toString();
  const sign = ltc < 0 ? "-" : "";
  const roomForDecimals = MAX_LEN - sign.length - intPart.length - 1;
  const decimals = Math.max(0, Math.min(MAX_DEC, roomForDecimals));
  if (decimals <= 0) return `${sign}${intPart}`;
  return ltc.toFixed(decimals);
}
