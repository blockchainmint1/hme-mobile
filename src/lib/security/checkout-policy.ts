export function validateCheckoutAmount(crypto: number, fiat: number, price: number, symbol: string | null): void {
  if (symbol && symbol.toUpperCase() !== "USDC") throw new Error("Unsupported checkout token");
  if (![crypto, fiat, price].every((v) => Number.isFinite(v) && v > 0)) throw new Error("Invalid checkout amount or unavailable price");
  if (Math.abs(crypto * price - fiat) > fiat * 0.02) throw new Error("Crypto amount does not match the checkout total");
}