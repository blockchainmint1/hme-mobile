/**
 * Server function returning the current IskanderCoin price in USD.
 *
 * ISK is priced from the wISK/USDC Uniswap V3 pool via the public wISK API
 * (no key, CORS-open) using the 30m TWAP so a single manipulated block can't
 * skew the portfolio total; the API returns spot if the window isn't
 * available. CoinGecko and CMC are kept as fallbacks.
 */
import { createServerFn } from "@tanstack/react-start";

export interface PriceQuote {
  usd: number | null;
  source: "dex" | "coingecko" | "cmc" | "unavailable";
  fetchedAt: number;
}

/**
 * wISK is priced from the wISK/USDC Uniswap V3 pool via the public wISK API
 * (no key, CORS-open). We request the 30m TWAP — the pool's built-in
 * observation oracle — so a single manipulated block can't skew the
 * portfolio total; the API returns spot if the window isn't available.
 */
async function fetchWiskUsd(): Promise<number | null> {
  try {
    const res = await fetch(
      "https://wisk.iskandercoin.com/api/public/price?twap=30m",
      { headers: { accept: "application/json" } },
    );
    if (!res.ok) return null;
    const json = (await res.json()) as { ok?: boolean; usd?: number };
    return json.ok && typeof json.usd === "number" ? json.usd : null;
  } catch {
    return null;
  }
}

export const getIskPriceUsd = createServerFn({ method: "GET" }).handler(
  async (): Promise<PriceQuote> => {
    // 1. Prefer the wISK dex TWAP (Uniswap V3 pool oracle).
    const dex = await fetchWiskUsd();
    if (dex != null) {
      return { usd: dex, source: "dex", fetchedAt: Date.now() };
    }

    // 2. CoinGecko public API (no key required).
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

    // 3. Optional CMC fallback (in case ISK is added later).
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
