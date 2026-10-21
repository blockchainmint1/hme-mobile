import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export type EvmChainId = "eth" | "base" | "bsc" | "zcu";

export interface EvmTransfer {
  hash: string;
  /** Provider event identity preserves multiple transfers in one transaction. */
  eventId?: string;
  from: string;
  to: string | null;
  /** Decimal value string, already scaled (e.g. "0.05"). */
  value: string;
  asset: string; // "ETH", "USDC", etc.
  category: string; // "external" | "erc20" | "internal"
  blockNum: number;
  /** ISO timestamp when available. */
  timestamp: string | null;
  /** true if this address was the sender. */
  outgoing: boolean;
  /** ERC-20 contract address (lowercase) when category === "erc20". */
  contractAddress: string | null;
  /**
   * Heuristic spam / imposter flag. True for airdropped tokens that
   * impersonate real stablecoins, use phishing symbols/URLs, or come from
   * unknown contracts the user never interacted with. UI hides these when
   * the "Hide worthless / spam tokens" setting is on (default).
   */
  spam: boolean;
  /** Short reason string for the spam classification (for debugging / UI hover). */
  spamReason: string | null;
}

export const getEvmHistory = createServerFn({ method: "POST" })
  .inputValidator((input: { chain: EvmChainId; address: string; fingerprint?: string; force?: boolean }) =>
    z.object({
      chain: z.enum(["eth", "base", "bsc", "zcu"]),
      address: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
      fingerprint: z.string().max(2048).optional(),
      force: z.boolean().optional(),
    }).parse(input))
  .handler(async ({ data }): Promise<{ transfers: EvmTransfer[]; supported: boolean; unavailable?: boolean; cached?: boolean; syncedAt?: string | null }> => {
    try {
      if (data.chain === "zcu") {
        const { fetchZcuHistory } = await import("./zcu-explorer.server");
        return { transfers: await fetchZcuHistory(data.address), supported: true };
      }
      if (data.chain === "bsc") {
        const { fetchBscHistory } = await import("./bsc-history.server");
        return { transfers: await fetchBscHistory(data.address), supported: true };
      }
      const { getCachedHistory } = await import("./history.server");
      return await getCachedHistory({ ...data, chain: data.chain });
    } catch {
      return { transfers: [], supported: true, unavailable: true };
    }
  });
