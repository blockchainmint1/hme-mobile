/**
 * Server function returning the current TEXITcoin price in USD.
 * Uses CoinMarketCap if a CMC_API_KEY is configured; otherwise returns null
 * so the UI can degrade gracefully ("Price unavailable").
 *
 * The API key is read inside the handler so it stays server-only.
 */
import { createServerFn } from "@tanstack/react-start";

export interface PriceQuote {
  usd: number | null;
  source: "cmc" | "unavailable";
  fetchedAt: number;
}

export const getTxcPriceUsd = createServerFn({ method: "GET" }).handler(async (): Promise<PriceQuote> => {
  const key = process.env.CMC_API_KEY;
  if (!key) return { usd: null, source: "unavailable", fetchedAt: Date.now() };

  try {
    const res = await fetch(
      "https://pro-api.coinmarketcap.com/v2/cryptocurrency/quotes/latest?symbol=TXC&convert=USD",
      { headers: { "X-CMC_PRO_API_KEY": key, accept: "application/json" } },
    );
    if (!res.ok) return { usd: null, source: "unavailable", fetchedAt: Date.now() };
    const json = (await res.json()) as {
      data?: Record<string, Array<{ quote?: { USD?: { price?: number } } }>>;
    };
    const entries = json.data?.TXC ?? [];
    const price = entries[0]?.quote?.USD?.price;
    return {
      usd: typeof price === "number" ? price : null,
      source: typeof price === "number" ? "cmc" : "unavailable",
      fetchedAt: Date.now(),
    };
  } catch {
    return { usd: null, source: "unavailable", fetchedAt: Date.now() };
  }
});
