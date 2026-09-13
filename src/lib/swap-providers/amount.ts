/** Shared conversions between our 1e8 sats and the decimal strings providers want. */
export const SATS = 100_000_000;

export function satsToDecimalString(sats: number, decimals = 8): string {
  const s = Math.round(sats).toString().padStart(decimals + 1, "0");
  const whole = s.slice(0, -decimals);
  const frac = s.slice(-decimals).replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole;
}

export function decimalStringToSats(v: string | number): number {
  return Math.round(Number(v) * SATS);
}
