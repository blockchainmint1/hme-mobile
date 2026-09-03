import { Connection, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import { SOLANA_RPC, type SolanaAccount } from "./network";

export interface SolanaTransfer {
  signature: string;
  slot: number;
  blockTime: number | null;
  from: string;
  to: string;
  lamports: number;
  incoming: boolean;
  confirmed: boolean;
}

export interface SolanaSignature {
  signature: string;
  slot: number;
  blockTime: number | null;
  err: unknown;
}

export function solanaConnection(): Connection {
  return new Connection(SOLANA_RPC, { commitment: "confirmed" });
}

export async function getSolBalance(address: string): Promise<number> {
  const connection = solanaConnection();
  return await connection.getBalance(new PublicKey(address), "confirmed");
}

export async function getSolSignatures(address: string, limit = 25): Promise<SolanaSignature[]> {
  const rows = await solanaConnection().getSignaturesForAddress(new PublicKey(address), { limit }, "confirmed");
  return rows.map((row) => ({
    signature: row.signature,
    slot: row.slot,
    blockTime: row.blockTime ?? null,
    err: row.err,
  }));
}

export async function getSolanaHistory(address: string, limit = 25): Promise<SolanaTransfer[]> {
  const connection = solanaConnection();
  const publicKey = new PublicKey(address);
  const signatures = await connection.getSignaturesForAddress(publicKey, { limit }, "confirmed");
  const rows = await Promise.all(
    signatures
      .filter((row) => !row.err)
      .slice(0, limit)
      .map(async (row) => {
        try {
          const tx = await connection.getParsedTransaction(row.signature, {
            commitment: "confirmed",
            maxSupportedTransactionVersion: 0,
          });
          const instructions = tx?.transaction.message.instructions ?? [];
          for (const instruction of instructions) {
            if (!("parsed" in instruction) || instruction.program !== "system") continue;
            const parsed = instruction.parsed as {
              type?: string;
              info?: { source?: string; destination?: string; lamports?: number };
            };
            if (parsed.type !== "transfer" || !parsed.info?.source || !parsed.info.destination) continue;
            const from = parsed.info.source;
            const to = parsed.info.destination;
            const transfer: SolanaTransfer = {
              signature: row.signature,
              slot: row.slot,
              blockTime: row.blockTime ?? null,
              from,
              to,
              lamports: parsed.info.lamports ?? 0,
              incoming: to === address,
              confirmed: true,
            };
            return transfer;
          }
        } catch {
          return null;
        }
        return null;
      }),
  );
  return rows.filter((row): row is SolanaTransfer => row !== null);
}

export async function sendSol(
  account: SolanaAccount,
  to: string,
  lamports: bigint,
): Promise<string> {
  if (lamports <= 0n) throw new Error("Enter an amount");
  if (lamports > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("Amount is too large");
  const connection = solanaConnection();
  const recipient = new PublicKey(to.trim());
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
  const transaction = new Transaction({ recentBlockhash: blockhash, feePayer: account.keypair.publicKey });
  transaction.add(
    SystemProgram.transfer({
      fromPubkey: account.keypair.publicKey,
      toPubkey: recipient,
      lamports: Number(lamports),
    }),
  );
  transaction.sign(account.keypair);
  const signature = await connection.sendRawTransaction(transaction.serialize(), {
    skipPreflight: false,
    preflightCommitment: "confirmed",
  });
  await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, "confirmed");
  return signature;
}
