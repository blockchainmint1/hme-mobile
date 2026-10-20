export function validateCardAmount(units: bigint, fiat: number): number {
  if (units <= 0n || units > BigInt(Number.MAX_SAFE_INTEGER) || !Number.isFinite(fiat) || fiat <= 0) throw new Error("Invalid invoice amount");
  const actual = Number(units) / 100_000_000;
  if (Math.abs(actual - fiat) > fiat * 0.01) throw new Error("TSD amount doesn't match the invoice total");
  return actual;
}

export function escapeTelegramHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}