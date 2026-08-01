/**
 * Server functions for THORChain swaps out of LTC / DOGE into stables.
 * Thin wrappers only — all logic lives in ./thornode.server.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { thorQuoteInput, thorStatusInput } from "./schemas";
import type { StableDestination, ThorQuote, ThorTxStatus } from "./assets";
import { fetchAvailableStables, fetchQuote, fetchTxStatus } from "./thornode.server";

export const getThorDestinations = createServerFn({ method: "POST" })
  .inputValidator((raw: unknown) => z.object({ coin: z.enum(["ltc", "doge"]) }).parse(raw))
  .handler(async ({ data }): Promise<StableDestination[]> => fetchAvailableStables(data.coin));

export const getThorQuote = createServerFn({ method: "POST" })
  .inputValidator((raw: unknown) => thorQuoteInput.parse(raw))
  .handler(async ({ data }): Promise<ThorQuote> => fetchQuote(data));

export const getThorTxStatus = createServerFn({ method: "POST" })
  .inputValidator((raw: unknown) => thorStatusInput.parse(raw))
  .handler(async ({ data }): Promise<ThorTxStatus> => fetchTxStatus(data.txid));
