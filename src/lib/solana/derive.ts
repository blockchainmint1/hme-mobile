/**
 * Dependency-light Solana key derivation.
 *
 * Kept separate from `network.ts` so server-reachable code (e.g. the Nectar
 * merchant-link handoff) can derive a Solana public key without pulling in
 * `@solana/web3.js`, whose `rpc-websockets` dependency does not build for the
 * Cloudflare Worker runtime.
 */
import { ed25519 } from "@noble/curves/ed25519";
import { hmac } from "@noble/hashes/hmac.js";
import { sha512 } from "@noble/hashes/sha2.js";
import { base58 } from "@scure/base";

export const SOLANA_DERIVATION_PATH = "m/44'/501'/0'/0'";
export const SOLANA_COIN_TYPE = 501;

/** Hardened SLIP-0010 ed25519 derivation at m/44'/501'/0'/0'. */
export function deriveSolanaSeed(seed: Uint8Array): Uint8Array {
  let state = hmac(sha512, new TextEncoder().encode("ed25519 seed"), seed);
  for (const segment of [44, SOLANA_COIN_TYPE, 0, 0]) {
    const data = new Uint8Array(37);
    data[0] = 0;
    data.set(state.slice(0, 32), 1);
    new DataView(data.buffer).setUint32(33, segment + 0x80000000, false);
    state = hmac(sha512, state.slice(32), data);
  }
  return state.slice(0, 32);
}

/** Base58 Solana address for the wallet's single account. */
export function deriveSolanaAddress(seed: Uint8Array): string {
  return base58.encode(ed25519.getPublicKey(deriveSolanaSeed(seed)));
}
