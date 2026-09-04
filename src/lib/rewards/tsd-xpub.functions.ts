/**
 * Server functions for TSD rewards xpub linking. Thin wrappers only.
 *
 * Every call carries the user's own TSD Swap API key from wallet Settings.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { deleteRewardsXpub, postRewardsXpub, type RewardsLinkResponse } from "./tsd-xpub.server";

const apiKey = z.string().trim().min(16).max(200);

const payloadSchema = z.object({
  v: z.literal(1),
  type: z.literal("tsd-rewards-xpub"),
  xpub: z.string().min(20).max(200),
  path: z.string().min(4).max(64),
  identity: z.string().min(26).max(64),
  issued_at: z.string().min(10).max(40),
});

export const linkRewardsXpub = createServerFn({ method: "POST" })
  .inputValidator((raw: unknown) =>
    z
      .object({
        apiKey,
        payload: payloadSchema,
        signature: z.string().min(60).max(200),
        address: z.string().min(26).max(64),
      })
      .parse(raw),
  )
  .handler(async ({ data }): Promise<RewardsLinkResponse> =>
    postRewardsXpub({
      apiKey: data.apiKey,
      payload: data.payload,
      signature: data.signature,
      address: data.address,
    }),
  );

export const unlinkRewardsXpub = createServerFn({ method: "POST" })
  .inputValidator((raw: unknown) => z.object({ apiKey }).parse(raw))
  .handler(async ({ data }): Promise<{ ok: true }> => {
    await deleteRewardsXpub(data.apiKey);
    return { ok: true };
  });
