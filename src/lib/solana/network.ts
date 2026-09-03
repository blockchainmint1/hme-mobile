/** Solana network and wallet primitives. */
import { base58 } from "@scure/base";
import { deriveSolanaSeed, SOLANA_COIN_TYPE, SOLANA_DERIVATION_PATH } from "./derive";

export { SOLANA_COIN_TYPE, SOLANA_DERIVATION_PATH };
import { deriveSolanaAddress } from "./derive";
export { deriveSolanaAddress };
export const SOLANA_RPC = "/api/solana";
export const SOLANA_EXPLORER = "https://solscan.io";
export const LAMPORTS_PER_SOL = 1_000_000_000;
/** Conservative rent-free reserve for the small system-transfer network fee. */
export const SOLANA_FEE_RESERVE_LAMPORTS = 10_000;

export interface SolanaAccount {
  address: string;
  /** 32-byte ed25519 private seed; kept in memory only while unlocked. */
  privateSeed: Uint8Array;
  path: string;
}

export function deriveSolanaAccount(seed: Uint8Array): SolanaAccount {
  const privateSeed = deriveSolanaSeed(seed);
  return { address: deriveSolanaAddress(seed), privateSeed, path: SOLANA_DERIVATION_PATH };
}

export function isValidSolanaAddress(address: string): boolean {
  const value = address.trim();
  if (!value) return false;
  try {
    return base58.decode(value).length === 32;
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
