import { z } from "zod";

export const providerId = z.enum(["thorchain", "sideshift", "changenow", "fixedfloat"]);

export const destSchema = z.object({
  asset: z.string().min(3).max(120),
  symbol: z.string().min(2).max(10),
  chain: z.enum(["eth", "base", "bsc"]),
  label: z.string().min(2).max(60),
});

const baseRequest = z.object({
  coin: z.enum(["ltc", "doge"]),
  dest: destSchema,
  amountSats: z.number().int().positive(),
  destination: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  refundAddress: z.string().min(20).max(120),
});

export const multiQuoteInput = baseRequest;

export const createOrderInput = baseRequest.extend({
  provider: providerId,
  quoteId: z.string().min(1).max(120).nullable().optional(),
});

export const orderStatusInput = z.object({
  provider: providerId,
  orderId: z.string().min(1).max(120).nullable(),
  txid: z.string().regex(/^[0-9a-fA-F]{64}$/),
  token: z.string().min(1).max(200).nullable().optional(),
});
