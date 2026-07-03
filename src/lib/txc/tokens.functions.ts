/**
 * TEXITcoin Omni Layer server RPC — token balance + history.
 *
 * Talks to the TXC node (indexed with Omni Core) using the same creds
 * shared with the CryptoPOP issuance pipeline. All heavy queries stay
 * on the server so wallets never need to run a full node.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

function rpcUrl(): string {
  const url = process.env.TXC_RPC_URL ?? process.env.TXC_RPC_ADDRESS;
  if (!url) throw new Error("TXC_RPC_URL (or TXC_RPC_ADDRESS) not configured");
  return url.startsWith("http") ? url : `https://${url}`;
}

function rpcAuth(): string {
  const user = process.env.TXC_RPC_USER;
  const pass = process.env.TXC_RPC_PASS ?? process.env.TXC_RPC_PASSWORD;
  if (!user || !pass) throw new Error("TXC_RPC_USER / TXC_RPC_PASS(WORD) not configured");
  return "Basic " + Buffer.from(`${user}:${pass}`).toString("base64");
}

async function rpc<T = unknown>(method: string, params: unknown[]): Promise<T> {
  const res = await fetch(rpcUrl(), {
    method: "POST",
    headers: { "content-type": "text/plain", authorization: rpcAuth() },
    body: JSON.stringify({ jsonrpc: "1.0", id: "hme", method, params }),
  });
  if (!res.ok) throw new Error(`rpc ${method}: http ${res.status}`);
  const json = (await res.json()) as { result: T; error: { message: string } | null };
  if (json.error) throw new Error(`rpc ${method}: ${json.error.message}`);
  return json.result;
}

interface OmniBalance {
  balance: string; // string decimal for divisible tokens; integer string for indivisible
  reserved?: string;
}

interface OmniAddressBalance {
  propertyid: number;
  name?: string;
  divisible?: boolean;
  balance: string;
  reserved?: string;
  frozen?: string;
}

/**
 * Look up a single Omni token balance for a single address.
 * Returns the raw string balance (matches Omni RPC formatting: decimal for
 * divisible, integer for indivisible). Returns "0" on missing property.
 */
export const getTxcTokenBalance = createServerFn({ method: "POST" })
  .inputValidator((raw: unknown) =>
    z.object({ address: z.string().min(1), propertyId: z.number().int().positive() }).parse(raw),
  )
  .handler(async ({ data }) => {
    try {
      const bal = await rpc<OmniBalance>("omni_getbalance", [data.address, data.propertyId]);
      return { balance: bal.balance ?? "0", reserved: bal.reserved ?? "0" };
    } catch (err) {
      // Address never touched the token → node returns error; treat as zero.
      const msg = err instanceof Error ? err.message : String(err);
      if (/address not found|does not exist/i.test(msg)) return { balance: "0", reserved: "0" };
      throw err;
    }
  });

/**
 * Sum token balances across many addresses (an HD wallet's external + change
 * chain). Runs the RPC calls in parallel and merges by property id.
 */
export const getTxcTokenBalancesForAddresses = createServerFn({ method: "POST" })
  .inputValidator((raw: unknown) =>
    z
      .object({
        addresses: z.array(z.string().min(1)).min(1).max(200),
        propertyIds: z.array(z.number().int().positive()).min(1).max(50),
      })
      .parse(raw),
  )
  .handler(async ({ data }) => {
    const totals: Record<number, bigint> = {};
    // Prefer omni_getallbalancesforaddress: one call per address returns every token.
    await Promise.all(
      data.addresses.map(async (addr) => {
        try {
          const rows = await rpc<OmniAddressBalance[]>("omni_getallbalancesforaddress", [addr]);
          for (const row of rows) {
            if (!data.propertyIds.includes(row.propertyid)) continue;
            const units = toUnits(row.balance, row.divisible !== false);
            totals[row.propertyid] = (totals[row.propertyid] ?? 0n) + units;
          }
        } catch {
          // silently skip addresses the node has no history for
        }
      }),
    );
    // Emit as strings so the wire is JSON-safe.
    const out: Record<number, string> = {};
    for (const id of data.propertyIds) out[id] = (totals[id] ?? 0n).toString();
    return out;
  });

function toUnits(raw: string, divisible: boolean): bigint {
  if (!divisible) return BigInt(raw);
  const [whole, frac = ""] = raw.split(".");
  const padded = (frac + "00000000").slice(0, 8);
  return BigInt(whole) * 100000000n + BigInt(padded);
}

interface OmniTx {
  txid: string;
  sendingaddress: string;
  referenceaddress?: string;
  ismine?: boolean;
  version?: number;
  type_int?: number;
  type?: string;
  propertyid?: number;
  divisible?: boolean;
  amount?: string;
  valid?: boolean;
  confirmations?: number;
  blocktime?: number;
  blockhash?: string;
  block?: number;
}

/**
 * Fetch recent Omni token history involving any of the given addresses.
 * Uses `omni_listtransactions` per-address then merges + sorts.
 */
export const getTxcTokenHistory = createServerFn({ method: "POST" })
  .inputValidator((raw: unknown) =>
    z
      .object({
        addresses: z.array(z.string().min(1)).min(1).max(50),
        propertyIds: z.array(z.number().int().positive()).min(1).max(50).optional(),
        count: z.number().int().min(1).max(200).optional(),
      })
      .parse(raw),
  )
  .handler(async ({ data }) => {
    const count = data.count ?? 50;
    const results = await Promise.all(
      data.addresses.map(async (addr) => {
        try {
          return await rpc<OmniTx[]>("omni_listtransactions", [addr, count, 0]);
        } catch {
          return [] as OmniTx[];
        }
      }),
    );
    const merged = new Map<string, OmniTx>();
    for (const list of results) for (const tx of list) merged.set(tx.txid, tx);
    const filtered = [...merged.values()].filter((tx) => {
      if (tx.valid === false) return false;
      if (!data.propertyIds) return true;
      return tx.propertyid != null && data.propertyIds.includes(tx.propertyid);
    });
    filtered.sort((a, b) => (b.blocktime ?? 0) - (a.blocktime ?? 0));
    return filtered.slice(0, count);
  });
