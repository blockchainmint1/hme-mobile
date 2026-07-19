/**
 * Dogecoin USD price via CoinGecko (public, no key). Optional CMC fallback.
 */
import { createServerFn } from "@tanstack/react-start";

export interface PriceQuote {
  usd: number | null;
  source: "coingecko" | "cmc" | "unavailable";
  fetchedAt: number;
}

export const getDogePriceUsd = createServerFn({ method: "GET" }).handler(
  async (): Promise<PriceQuote> => {
    try {
      const res = await fetch(
        "https://api.coingecko.com/api/v3/simple/price?ids=dogecoin&vs_currencies=usd",
        { headers: { accept: "application/json" } },
      );
      if (res.ok) {
        const json = (await res.json()) as { dogecoin?: { usd?: number } };
        const p = json.dogecoin?.usd;
        if (typeof p === "number") return { usd: p, source: "coingecko", fetchedAt: Date.now() };
      }
    } catch { /* fall through */ }

    const key = process.env.CMC_API ?? process.env.CMC_API_KEY;
    if (key) {
      try {
        const res = await fetch(
          "https://pro-api.coinmarketcap.com/v2/cryptocurrency/quotes/latest?symbol=DOGE&convert=USD",
          { headers: { "X-CMC_PRO_API_KEY": key, accept: "application/json" } },
        );
        if (res.ok) {
          const json = (await res.json()) as {
            data?: Record<string, Array<{ quote?: { USD?: { price?: number } } }>>;
          };
          const p = json.data?.DOGE?.[0]?.quote?.USD?.price;
          if (typeof p === "number") return { usd: p, source: "cmc", fetchedAt: Date.now() };
        }
      } catch { /* fall through */ }
    }
    return { usd: null, source: "unavailable", fetchedAt: Date.now() };
  },
);
