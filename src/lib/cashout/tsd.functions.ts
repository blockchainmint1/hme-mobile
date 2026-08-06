/**
 * Server functions for the TSD → USDC cash-out. Thin wrappers only.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { CashoutCouponPreview, CashoutOrder, CashoutSettings } from "./tsd";
import {
  createCashout,
  fetchCashoutOrder,
  fetchCashoutSettings,
  previewCoupon,
} from "./tsd.server";

export const getCashoutSettings = createServerFn({ method: "GET" }).handler(
  async (): Promise<CashoutSettings> => fetchCashoutSettings(),
);

export const previewCashoutCoupon = createServerFn({ method: "POST" })
  .inputValidator((raw: unknown) =>
    z
      .object({ code: z.string().trim().min(1).max(40) })
      .transform((v) => ({ code: v.code.toUpperCase() }))
      .parse(raw),
  )
  .handler(async ({ data }): Promise<CashoutCouponPreview> => previewCoupon(data.code));

export const createCashoutOrder = createServerFn({ method: "POST" })
  .inputValidator((raw: unknown) =>
    z
      .object({
        amount: z.number().positive().max(1_000_000),
        payoutAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/, "Enter a valid 0x… address"),
        refundAddress: z.string().min(26).max(64),
        couponCode: z.string().trim().max(40).nullable().optional(),
        accountToken: z.string().max(4096).nullable().optional(),
      })
      .parse(raw),
  )
  .handler(async ({ data }): Promise<CashoutOrder> =>
    createCashout({
      amount: data.amount,
      payoutAddress: data.payoutAddress,
      refundAddress: data.refundAddress,
      couponCode: data.couponCode?.toUpperCase() || null,
      accountToken: data.accountToken || null,
    }),
  );

export const getCashoutOrder = createServerFn({ method: "POST" })
  .inputValidator((raw: unknown) => z.object({ id: z.string().min(4).max(80) }).parse(raw))
  .handler(async ({ data }): Promise<CashoutOrder> => fetchCashoutOrder(data.id));
