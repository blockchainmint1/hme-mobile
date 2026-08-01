import { z } from "zod";

export const thorQuoteInput = z.object({
  coin: z.enum(["ltc", "doge"]),
  toAsset: z.string().min(3).max(120),
  /** Source amount in sats (1e8), as a decimal string so bigints stay safe. */
  amountSats: z.string().regex(/^\d+$/),
  /** Destination EVM address (0x…). */
  destination: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  /** Price-protection tolerance in basis points. */
  toleranceBps: z.number().int().min(50).max(2000).optional(),
  /** 0 = no streaming, 1 = stream in one-block chunks (cheapest). */
  streamingInterval: z.number().int().min(0).max(10).optional(),
});

export type ThorQuoteInput = z.infer<typeof thorQuoteInput>;

export const thorStatusInput = z.object({
  txid: z.string().regex(/^[0-9a-fA-F]{64}$/),
});
