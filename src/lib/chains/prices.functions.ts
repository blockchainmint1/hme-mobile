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

const SYMBOLS = ["TXC", "ETH", "BNB"];

export const getAllPricesUsd = createServerFn({ method: "GET" }).handler(
  async (): Promise<PricesResult> => {
    const key = process.env.CMC_API ?? process.env.CMC_API_KEY;
    if (!key) return { prices: {}, fetchedAt: Date.now(), source: "unavailable" };

    try {
      const url = `https://pro-api.coinmarketcap.com/v2/cryptocurrency/quotes/latest?symbol=${SYMBOLS.join(",")}&convert=USD`;
      const res = await fetch(url, {
        headers: { "X-CMC_PRO_API_KEY": key, accept: "application/json" },
      });
      if (!res.ok) return { prices: {}, fetchedAt: Date.now(), source: "unavailable" };
      const json = (await res.json()) as {
        data?: Record<string, Array<{ quote?: { USD?: { price?: number } } }>>;
      };
      const prices: PriceMap = {};
      for (const sym of SYMBOLS) {
        const p = json.data?.[sym]?.[0]?.quote?.USD?.price;
        if (typeof p === "number") prices[sym] = p;
      }
      return { prices, fetchedAt: Date.now(), source: "cmc" };
    } catch {
      return { prices: {}, fetchedAt: Date.now(), source: "unavailable" };
    }
  },
);
