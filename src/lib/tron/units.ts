import { SUN_PER_TRX, TRX_DECIMALS } from "./network";

export function sunToTrx(sun: number | bigint): number {
  return Number(sun) / SUN_PER_TRX;
}

export function trxToSun(trx: number | string): number {
  const n = typeof trx === "string" ? parseFloat(trx) : trx;
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * SUN_PER_TRX);
}

export function formatTrx(sun: number | bigint, opts: { withUnit?: boolean } = {}): string {
  const trx = sunToTrx(sun);
  const str = trx.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: TRX_DECIMALS,
  });
  return opts.withUnit === false ? str : `${str} TRX`;
}

export function formatTrxCompact(sun: number | bigint): string {
  const trx = sunToTrx(sun);
  const MAX_LEN = 10;
  const MAX_DEC = 5;
  const intPart = Math.trunc(Math.abs(trx)).toString();
  const sign = trx < 0 ? "-" : "";
  const room = MAX_LEN - sign.length - intPart.length - 1;
  const decimals = Math.max(0, Math.min(MAX_DEC, room));
  if (decimals <= 0) return `${sign}${intPart}`;
  return trx.toFixed(decimals);
}

/** Format a raw token amount (bigint base units) with its decimals. */
export function formatTokenAmount(raw: bigint, decimals: number, maxFrac = 6): string {
  const neg = raw < 0n;
  const abs = neg ? -raw : raw;
  const base = 10n ** BigInt(decimals);
  const whole = abs / base;
  const frac = (abs % base).toString().padStart(decimals, "0").slice(0, maxFrac).replace(/0+$/, "");
  const s = frac ? `${whole.toLocaleString()}.${frac}` : whole.toLocaleString();
  return neg ? `-${s}` : s;
}

/** Parse a decimal string into base units for a token with `decimals`. */
export function parseTokenAmount(value: string, decimals: number): bigint {
  const clean = (value ?? "").trim();
  if (!clean || !/^\d*\.?\d*$/.test(clean)) return 0n;
  const [whole = "0", frac = ""] = clean.split(".");
  const padded = (frac + "0".repeat(decimals)).slice(0, decimals);
  return BigInt(whole || "0") * 10n ** BigInt(decimals) + BigInt(padded || "0");
}
