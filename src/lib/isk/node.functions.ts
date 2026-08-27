import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { sendRawIsk, iskFeeRate } from "./node.server";

export const iskNodeBroadcast = createServerFn({ method: "POST" })
  .inputValidator((data) => z.object({ hex: z.string().min(20) }).parse(data))
  .handler(async ({ data }) => {
    const txid = await sendRawIsk(data.hex);
    return { txid };
  });

export const iskNodeFeeRate = createServerFn({ method: "GET" }).handler(async () => {
  return { satPerVb: await iskFeeRate() };
});
