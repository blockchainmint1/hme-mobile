/**
 * Server function: fetch USD prices for every chain the wallet supports.
 * Single CMC call -> map of symbol -> usd.
 */
import { createServerFn } from "@tanstack/react-start";

export type PriceMap = Record<string, number>;

export interface PricesResult {
  prices: PriceMap;
  fetchedAt: number;
  source: "cmc" | "unavailable";
}

const SYMBOLS = ["TXC", "ETH", "BNB", "SOL"];

/**
 * ZCU is priced from the wZCU/USDC Uniswap V3 pool via the public wZCU API
 * (no key, CORS-open). We request the 30m TWAP — the pool's built-in
 * observation oracle — so a single manipulated block can't skew the
 * portfolio total; the API returns spot if the window isn't available.
 */
async function fetchZcuUsd(): Promise<number | null> {
  try {
    const res = await fetch(
      "https://wzcu.zerochill.com/api/public/price?twap=30m",
      { headers: { accept: "application/json" } },
    );
    if (!res.ok) return null;
    const json = (await res.json()) as { ok?: boolean; usd?: number };
    return json.ok && typeof json.usd === "number" ? json.usd : null;
  } catch {
    return null;
  }
}

export const getAllPricesUsd = createServerFn({ method: "GET" }).handler(
  async (): Promise<PricesResult> => {
    const key = process.env.CMC_API ?? process.env.CMC_API_KEY;
    const prices: PriceMap = {};

    const [zcu] = await Promise.all([
      fetchZcuUsd(),
      (async () => {
        if (!key) return;
        try {
          const url = `https://pro-api.coinmarketcap.com/v2/cryptocurrency/quotes/latest?symbol=${SYMBOLS.join(",")}&convert=USD`;
          const res = await fetch(url, {
            headers: { "X-CMC_PRO_API_KEY": key, accept: "application/json" },
          });
          if (!res.ok) return;
          const json = (await res.json()) as {
            data?: Record<string, Array<{ quote?: { USD?: { price?: number } } }>>;
          };
          for (const sym of SYMBOLS) {
            const p = json.data?.[sym]?.[0]?.quote?.USD?.price;
            if (typeof p === "number") prices[sym] = p;
          }
        } catch {
          /* CMC unavailable — other sources may still have filled prices */
        }
      })(),
    ]);
    if (zcu != null) prices.ZCU = zcu;

    return {
      prices,
      fetchedAt: Date.now(),
      source: Object.keys(prices).length > 0 ? "cmc" : "unavailable",
    };
  },
);
