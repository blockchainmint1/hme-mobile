/** Solana network and wallet primitives. */
import { hmac } from "@noble/hashes/hmac.js";
import { sha512 } from "@noble/hashes/sha2.js";
import { Keypair, PublicKey } from "@solana/web3.js";

export const SOLANA_DERIVATION_PATH = "m/44'/501'/0'/0'";
export const SOLANA_RPC = "/api/solana";
export const SOLANA_EXPLORER = "https://solscan.io";
export const LAMPORTS_PER_SOL = 1_000_000_000;
export const SOLANA_COIN_TYPE = 501;

export interface SolanaAccount {
  address: string;
  keypair: Keypair;
  path: string;
}

function deriveSlip10(seed: Uint8Array): Uint8Array {
  let state = hmac(sha512, new TextEncoder().encode("ed25519 seed"), seed);
  const segments = [44, SOLANA_COIN_TYPE, 0, 0];
  for (const segment of segments) {
    const data = new Uint8Array(37);
    data[0] = 0;
    data.set(state.slice(0, 32), 1);
    new DataView(data.buffer).setUint32(33, segment + 0x80000000, false);
    state = hmac(sha512, state.slice(32), data);
  }
  return state.slice(0, 32);
}

export function deriveSolanaAccount(seed: Uint8Array): SolanaAccount {
  const keypair = Keypair.fromSeed(deriveSlip10(seed));
  return { address: keypair.publicKey.toBase58(), keypair, path: SOLANA_DERIVATION_PATH };
}

export function deriveSolanaAddress(seed: Uint8Array): string {
  return deriveSolanaAccount(seed).address;
}

export function isValidSolanaAddress(address: string): boolean {
  try {
    new PublicKey(address.trim());
    return address.trim().length > 0;
  } catch {
    return false;
  }
}

export function explorerTxUrl(signature: string): string {
  return `${SOLANA_EXPLORER}/tx/${encodeURIComponent(signature)}`;
}

export function explorerAddressUrl(address: string): string {
  return `${SOLANA_EXPLORER}/account/${encodeURIComponent(address)}`;
}

export function lamportsToSol(lamports: number | bigint): number {
  return Number(lamports) / LAMPORTS_PER_SOL;
}

export function solToLamports(sol: string | number): bigint {
  const value = typeof sol === "number" ? String(sol) : sol.trim();
  if (!/^\d+(?:\.\d+)?$/.test(value)) return 0n;
  const [whole, fraction = ""] = value.split(".");
  if (fraction.length > 9) throw new Error("SOL amount has too many decimal places");
  return BigInt(whole) * BigInt(LAMPORTS_PER_SOL) + BigInt(fraction.padEnd(9, "0") || "0");
}

export function formatSol(lamports: number | bigint): string {
  return lamportsToSol(lamports).toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 9,
  });
}
