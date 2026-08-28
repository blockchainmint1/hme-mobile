/**
 * Reliable EVM broadcast helper.
 *
 * Two failure modes we kept hitting on our own nodes (ZCU especially):
 *
 *  1. `replacement transaction underpriced` — a previous send is still sitting
 *     in the node's mempool at the same nonce. viem asks the node for the
 *     "pending" nonce, but some nodes answer with the mined ("latest") count,
 *     so the new transaction collides with the stuck one and is rejected
 *     unless its fee is meaningfully higher.
 *  2. `already known` / `nonce too low` — same root cause, opposite direction.
 *
 * So: resolve the nonce as max(latest, pending), and on a collision retry with
 * an aggressively bumped fee (which also un-sticks the old transaction, since
 * the replacement wins) or the next nonce when the node says it's too low.
 */
import type { Address, WalletClient } from "viem";
import { evmClient, type EvmChainId } from "./evm";

export interface EvmTxRequest {
  to: Address;
  data?: `0x${string}`;
  value?: bigint;
  gas?: bigint;
}

function msgOf(e: unknown): string {
  const err = e as { message?: string; details?: string; shortMessage?: string };
  return `${err?.message ?? ""} ${err?.details ?? ""} ${err?.shortMessage ?? ""}`.toLowerCase();
}

const isUnderpriced = (m: string) =>
  m.includes("replacement transaction underpriced") ||
  m.includes("replacement_underpriced") ||
  m.includes("already known") ||
  m.includes("transaction underpriced") ||
  m.includes("fee too low");

const isNonceTooLow = (m: string) => m.includes("nonce too low");

/** Bump helper: at least +25% (nodes require >=10%), rounded up. */
const bump = (v: bigint, factor: bigint) => (v * factor) / 100n;

export async function sendEvmTransaction(
  chainId: EvmChainId,
  walletClient: WalletClient,
  tx: EvmTxRequest,
): Promise<`0x${string}`> {
  const pub = evmClient(chainId);
  const account = walletClient.account;
  if (!account) throw new Error("Wallet locked");
  const address = account.address as Address;

  const [latest, pending] = await Promise.all([
    pub.getTransactionCount({ address, blockTag: "latest" }),
    pub.getTransactionCount({ address, blockTag: "pending" }).catch(() => 0),
  ]);
  let nonce = Math.max(latest, pending);

  // Baseline fees from the node.
  let maxFeePerGas: bigint | undefined;
  let maxPriorityFeePerGas: bigint | undefined;
  try {
    const fees = await pub.estimateFeesPerGas();
    maxFeePerGas = fees.maxFeePerGas;
    maxPriorityFeePerGas = fees.maxPriorityFeePerGas;
  } catch {
    /* fall back to viem's own estimation below */
  }

  let lastErr: unknown;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      return await walletClient.sendTransaction({
        account,
        chain: walletClient.chain,
        ...tx,
        nonce,
        ...(maxFeePerGas != null
          ? { maxFeePerGas, maxPriorityFeePerGas: maxPriorityFeePerGas ?? 0n }
          : {}),
      } as Parameters<WalletClient["sendTransaction"]>[0]);
    } catch (e) {
      lastErr = e;
      const m = msgOf(e);
      if (isNonceTooLow(m)) {
        nonce += 1;
        continue;
      }
      if (isUnderpriced(m)) {
        // Either bump the fee to replace the stuck transaction, or (once we've
        // tried that) queue behind it with the next nonce.
        if (attempt < 2) {
          const base = maxFeePerGas ?? (await pub.getGasPrice());
          const prio = maxPriorityFeePerGas ?? base / 10n;
          maxFeePerGas = bump(base, 200n);
          maxPriorityFeePerGas = bump(prio > 0n ? prio : base / 10n, 200n);
        } else {
          nonce += 1;
        }
        continue;
      }
      throw e;
    }
  }
  throw lastErr instanceof Error
    ? new Error(
        `Couldn't broadcast: an earlier transaction from this wallet is still pending on the network. Wait for it to confirm, then try again. (${lastErr.message.split("\n")[0]})`,
      )
    : new Error("Couldn't broadcast this transaction");
}
