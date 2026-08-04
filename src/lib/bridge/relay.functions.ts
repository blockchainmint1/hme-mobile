/**
 * Server functions for the Tron → EVM stablecoin bridge. Thin wrappers only.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { BridgeQuote, BridgeStatus } from "./relay";
import { fetchBridgeQuote, fetchBridgeStatus } from "./relay.server";

const quoteInput = z.object({
  fromAddress: z.string().min(30).max(64),
  fromContract: z.string().min(30).max(64),
  toChainId: z.number().int().positive(),
  toCurrency: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  amount: z.string().regex(/^\d+$/),
  recipient: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
});

export const getBridgeQuote = createServerFn({ method: "POST" })
  .inputValidator((raw: unknown) => quoteInput.parse(raw))
  .handler(async ({ data }): Promise<BridgeQuote> => fetchBridgeQuote(data));

export const getBridgeStatus = createServerFn({ method: "POST" })
  .inputValidator((raw: unknown) => z.object({ requestId: z.string().min(4) }).parse(raw))
  .handler(async ({ data }): Promise<BridgeStatus> => fetchBridgeStatus(data.requestId));
