/**
 * Server functions for multi-provider LTC/DOGE → stablecoin swaps.
 * Thin wrappers only — routing logic lives in ./registry.server.
 */
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
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
    const order = await createProviderOrder({ provider, req, quoteId: quoteId ?? null });

    // Exchange partners require us to retain who paid for the order.
    const { providerNeedsComplianceLog, readRequestIdentity, recordExchangeOrder } = await import(
      "./compliance.server"
    );
    if (providerNeedsComplianceLog(provider)) {
      const identity = readRequestIdentity(getRequest().headers);
      await recordExchangeOrder({
        provider,
        order_id: order.orderId,
        deposit_address: order.depositAddress,
        from_coin: req.coin,
        amount_sats: order.amountSats,
        dest_asset: order.destAsset,
        dest_address: req.destination,
        ...identity,
      });
    }
    return order;
  });

export const getSwapOrderStatus = createServerFn({ method: "POST" })
  .inputValidator((raw: unknown) => orderStatusInput.parse(raw))
  .handler(async ({ data }): Promise<SwapOrderStatus> => {
    const { providerOrderStatus } = await import("./registry.server");
    if (data.orderId) {
      const { providerNeedsComplianceLog, attachExchangeTxid } = await import(
        "./compliance.server"
      );
      if (providerNeedsComplianceLog(data.provider)) {
        await attachExchangeTxid({
          provider: data.provider,
          orderId: data.orderId,
          txid: data.txid,
        });
      }
    }
    return providerOrderStatus(data);
  });
