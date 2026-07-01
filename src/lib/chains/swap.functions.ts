/**
 * In-app swap quotes via LI.FI's public aggregator API.
 *
 * We hit LI.FI server-side so we can add an integrator key / rate-limit /
 * fee split later without shipping a new client. Same-chain swaps only for
 * the MVP (from/to on the same EVM chain).
 *
 * Docs: https://docs.li.fi/li.fi-api/li.fi-api/requesting-supported-chains-tokens-etc
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/** Sentinel address LI.FI uses for the native token on any EVM chain. */
export const NATIVE_TOKEN_ADDRESS =
  "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE" as const;

const CHAIN_IDS: Record<string, number> = { eth: 1, base: 8453, bsc: 56 };

const quoteInput = z.object({
  chain: z.enum(["eth", "base", "bsc"]),
  fromToken: z.string().min(1),
  toToken: z.string().min(1),
  fromAmount: z.string().regex(/^\d+$/, "fromAmount must be raw integer units"),
  fromAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  slippage: z.number().min(0).max(0.5).optional(),
});

export type SwapQuote = {
  estimate: {
    fromAmount: string;
    toAmount: string;
    toAmountMin: string;
    approvalAddress: string;
    executionDuration: number;
    feeCosts?: Array<{ name: string; amountUSD?: string }>;
    gasCosts?: Array<{ amountUSD?: string; estimate?: string }>;
  };
  transactionRequest: {
    to: `0x${string}`;
    data: `0x${string}`;
    value: `0x${string}`;
    chainId: number;
    gasLimit?: `0x${string}`;
    gasPrice?: `0x${string}`;
  };
  tool: string;
  toolDetails?: { name: string; logoURI?: string };
};

export const getSwapQuote = createServerFn({ method: "POST" })
  .inputValidator((raw: unknown) => quoteInput.parse(raw))
  .handler(async ({ data }): Promise<SwapQuote> => {
    const chainId = CHAIN_IDS[data.chain];
    const params = new URLSearchParams({
      fromChain: String(chainId),
      toChain: String(chainId),
      fromToken: data.fromToken,
      toToken: data.toToken,
      fromAmount: data.fromAmount,
      fromAddress: data.fromAddress,
      slippage: String(data.slippage ?? 0.005),
      order: "RECOMMENDED",
    });
    const integrator = process.env.LIFI_INTEGRATOR;
    if (integrator) params.set("integrator", integrator);

    const url = `https://li.quest/v1/quote?${params}`;
    const headers: Record<string, string> = { accept: "application/json" };
    const apiKey = process.env.LIFI_API_KEY;
    if (apiKey) headers["x-lifi-api-key"] = apiKey;

    const res = await fetch(url, { headers });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      // Bubble up a compact message; LI.FI returns { message } on 4xx.
      let msg = `Quote unavailable (${res.status})`;
      try {
        const j = JSON.parse(text) as { message?: string };
        if (j.message) msg = j.message;
      } catch {
        /* ignore */
      }
      throw new Error(msg);
    }
    return (await res.json()) as SwapQuote;
  });
