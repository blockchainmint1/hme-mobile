/**
 * Server function returning the current IskanderCoin price in USD.
 * ISK is not (yet) on CoinMarketCap. Try CoinGecko first (id: "iskander");
 * if unavailable return null so the UI gracefully shows "Price unavailable".
 */
import { createServerFn } from "@tanstack/react-start";

export interface PriceQuote {
  usd: number | null;
  source: "coingecko" | "cmc" | "unavailable";
  fetchedAt: number;
}

export const getIskPriceUsd = createServerFn({ method: "GET" }).handler(
  async (): Promise<PriceQuote> => {
    // 1. Try CoinGecko public API (no key required, generous free tier).
    try {
      const res = await fetch(
        "https://api.coingecko.com/api/v3/simple/price?ids=iskander&vs_currencies=usd",
        { headers: { accept: "application/json" } },
      );
      if (res.ok) {
        const json = (await res.json()) as { iskander?: { usd?: number } };
        const p = json.iskander?.usd;
        if (typeof p === "number") {
          return { usd: p, source: "coingecko", fetchedAt: Date.now() };
        }
      }
    } catch {
      /* fall through */
    }

    // 2. Optional CMC fallback (in case ISK is added later).
    const key = process.env.CMC_API ?? process.env.CMC_API_KEY;
    if (key) {
      try {
        const res = await fetch(
          "https://pro-api.coinmarketcap.com/v2/cryptocurrency/quotes/latest?symbol=ISK&convert=USD",
          { headers: { "X-CMC_PRO_API_KEY": key, accept: "application/json" } },
        );
        if (res.ok) {
          const json = (await res.json()) as {
            data?: Record<string, Array<{ quote?: { USD?: { price?: number } } }>>;
          };
          const p = json.data?.ISK?.[0]?.quote?.USD?.price;
          if (typeof p === "number") {
            return { usd: p, source: "cmc", fetchedAt: Date.now() };
          }
        }
      } catch {
        /* fall through */
      }
    }

    return { usd: null, source: "unavailable", fetchedAt: Date.now() };
  },
);
