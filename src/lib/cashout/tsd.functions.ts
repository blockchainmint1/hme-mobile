/**
 * Server functions for the TSD → USDC cash-out. Thin wrappers only.
 *
 * Every call carries the user's own TSD Swap API key from wallet Settings;
 * without it the feature is not available at all.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { CashoutAccount, CashoutOrder, CashoutSettings } from "./tsd";
import {
  createCashout,
  fetchCashoutOrder,
  fetchCashoutSettings,
  fetchDepositAddress,
  saveDepositPayoutAddress,
} from "./tsd.server";

const apiKey = z.string().trim().min(16).max(200);

/**
 * TSD Swap has returned numeric fields as strings in some responses.
 * Coercing here keeps the UI from showing a phantom fee or hanging on
 * "Checking…" because `typeof redeemFeeBps === "number"` was false.
 */
const settingsSchema = z.object({
  live: z.coerce.boolean(),
  minAmount: z.coerce.number(),
  maxAmount: z.coerce.number(),
  redeemFeeBps: z.coerce.number(),
});

const orderSchema = z.object({
  id: z.string(),
  status: z.string(),
  depositAddress: z.string(),
  amountExpected: z.coerce.number(),
  feeBps: z.coerce.number(),
  payoutAmount: z.coerce.number(),
  payoutAddress: z.string(),
  refundAddress: z.string().nullable(),
  expiresAt: z.string().nullable(),
  releaseTxHash: z.string().nullable(),
  refundTxid: z.string().nullable(),
  error: z.string().nullable(),
});

export const getCashoutSettings = createServerFn({ method: "POST" })
  .inputValidator((raw: unknown) => z.object({ apiKey }).parse(raw))
  .handler(async ({ data }): Promise<CashoutSettings> => {
    const raw = await fetchCashoutSettings(data.apiKey);
    return settingsSchema.parse(raw);
  });

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
  .handler(async ({ data }): Promise<CashoutOrder> => {
    const raw = await createCashout({
      apiKey: data.apiKey,
      amount: data.amount,
      payoutAddress: data.payoutAddress,
      refundAddress: data.refundAddress,
    });
    return orderSchema.parse(raw);
  });

export const getCashoutOrder = createServerFn({ method: "POST" })
  .inputValidator((raw: unknown) =>
    z.object({ apiKey, id: z.string().min(4).max(80) }).parse(raw),
  )
  .handler(async ({ data }): Promise<CashoutOrder> => {
    const raw = await fetchCashoutOrder(data.id, data.apiKey);
    return orderSchema.parse(raw);
  });

/**
 * The account's permanent TSD deposit address + fee. TSD Swap has been
 * inconsistent about field names/types, so accept both `redeemFeeBps` and
 * `feePercent` and coerce numbers.
 */
const accountSchema = z
  .object({
    address: z.string().min(20).optional(),
    depositAddress: z.string().min(20).optional(),
    redeemFeeBps: z.coerce.number().optional(),
    feePercent: z.coerce.number().optional(),
    payoutAddress: z.string().nullable().optional(),
    live: z.coerce.boolean().optional(),
    minAmount: z.coerce.number().optional(),
    maxAmount: z.coerce.number().optional(),
  })
  .transform((r) => ({
    depositAddress: (r.depositAddress ?? r.address ?? "").trim(),
    feeBps: r.redeemFeeBps ?? (typeof r.feePercent === "number" ? r.feePercent * 100 : 0),
    payoutAddress: r.payoutAddress ?? null,
    live: r.live ?? true,
    minAmount: r.minAmount ?? null,
    maxAmount: r.maxAmount ?? null,
  }));

export const getCashoutAccount = createServerFn({ method: "POST" })
  .inputValidator((raw: unknown) => z.object({ apiKey }).parse(raw))
  .handler(async ({ data }): Promise<CashoutAccount> => {
    return accountSchema.parse(await fetchDepositAddress(data.apiKey));
  });

export const setCashoutPayoutAddress = createServerFn({ method: "POST" })
  .inputValidator((raw: unknown) =>
    z
      .object({
        apiKey,
        payoutAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/, "Enter a valid 0x… address"),
      })
      .parse(raw),
  )
  .handler(async ({ data }): Promise<CashoutAccount> => {
    const raw = await saveDepositPayoutAddress(data.apiKey, data.payoutAddress);
    const parsed = accountSchema.safeParse(raw);
    if (parsed.success && parsed.data.depositAddress) return parsed.data;
    // Some responses only acknowledge the save; read the account back.
    return accountSchema.parse(await fetchDepositAddress(data.apiKey));
  });
