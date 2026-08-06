/**
 * Server functions for the TSD → USDC cash-out. Thin wrappers only.
 *
 * Every call carries the user's own TSD Swap API key from wallet Settings;
 * without it the feature is not available at all.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { CashoutOrder, CashoutSettings } from "./tsd";
import { createCashout, fetchCashoutOrder, fetchCashoutSettings } from "./tsd.server";

const apiKey = z.string().trim().min(16).max(200);

export const getCashoutSettings = createServerFn({ method: "POST" })
  .inputValidator((raw: unknown) => z.object({ apiKey }).parse(raw))
  .handler(async ({ data }): Promise<CashoutSettings> => fetchCashoutSettings(data.apiKey));

export const createCashoutOrder = createServerFn({ method: "POST" })
  .inputValidator((raw: unknown) =>
    z
      .object({
        apiKey,
        amount: z.number().positive().max(1_000_000),
        payoutAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/, "Enter a valid 0x… address"),
        refundAddress: z.string().min(26).max(64),
      })
      .parse(raw),
  )
  .handler(
    async ({ data }): Promise<CashoutOrder> =>
      createCashout({
        apiKey: data.apiKey,
        amount: data.amount,
        payoutAddress: data.payoutAddress,
        refundAddress: data.refundAddress,
      }),
  );

export const getCashoutOrder = createServerFn({ method: "POST" })
  .inputValidator((raw: unknown) =>
    z.object({ apiKey, id: z.string().min(4).max(80) }).parse(raw),
  )
  .handler(async ({ data }): Promise<CashoutOrder> => fetchCashoutOrder(data.id, data.apiKey));
