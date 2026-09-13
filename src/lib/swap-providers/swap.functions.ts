/**
 * Server functions for multi-provider LTC/DOGE → stablecoin swaps.
 * Thin wrappers only — routing logic lives in ./registry.server.
 */
import { createServerFn } from "@tanstack/react-start";
import { createOrderInput, multiQuoteInput, orderStatusInput } from "./schemas";
import type { SwapOrder, SwapOrderStatus } from "./types";
import type { QuoteResult } from "./registry.server";

export const getSwapQuotes = createServerFn({ method: "POST" })
  .inputValidator((raw: unknown) => multiQuoteInput.parse(raw))
  .handler(async ({ data }): Promise<QuoteResult> => {
    const { quoteAllProviders } = await import("./registry.server");
    return quoteAllProviders(data);
  });

export const createSwapOrder = createServerFn({ method: "POST" })
  .inputValidator((raw: unknown) => createOrderInput.parse(raw))
  .handler(async ({ data }): Promise<SwapOrder & { ref?: Record<string, string> }> => {
    const { createProviderOrder } = await import("./registry.server");
    const { provider, quoteId, ...req } = data;
    return createProviderOrder({ provider, req, quoteId: quoteId ?? null });
  });

export const getSwapOrderStatus = createServerFn({ method: "POST" })
  .inputValidator((raw: unknown) => orderStatusInput.parse(raw))
  .handler(async ({ data }): Promise<SwapOrderStatus> => {
    const { providerOrderStatus } = await import("./registry.server");
    return providerOrderStatus(data);
  });
