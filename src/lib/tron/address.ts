/**
 * Tron address derivation + base58check encoding.
 *
 * A Tron address is the same keccak-256 hash of the uncompressed secp256k1
 * public key that Ethereum uses — the last 20 bytes. Tron then prefixes it
 * with 0x41 and base58check-encodes the 21 bytes, which is why every Tron
 * address starts with "T" instead of "0x". Same key, different clothing.
 */
import type { BIP32Interface } from "bip32";
import { secp256k1 } from "@noble/curves/secp256k1";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { base58 } from "@scure/base";
import { TRON_DERIVATION_PATH } from "./network";

export const TRON_ADDRESS_PREFIX = 0x41;

function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function checksum(payload: Uint8Array): Uint8Array {
  return sha256(sha256(payload)).slice(0, 4);
}

/** 21-byte (0x41 + 20) address bytes -> base58check "T…" string. */
export function encodeBase58Address(raw: Uint8Array): string {
  return base58.encode(concat(raw, checksum(raw)));
}

/** "T…" base58check string -> 21-byte address bytes. Throws when invalid. */
export function decodeBase58Address(address: string): Uint8Array {
  const decoded = base58.decode(address.trim());
  if (decoded.length !== 25) throw new Error("Invalid Tron address length");
  const payload = decoded.slice(0, 21);
  const check = decoded.slice(21);
  const expected = checksum(payload);
  for (let i = 0; i < 4; i++) {
    if (check[i] !== expected[i]) throw new Error("Invalid Tron address checksum");
  }
  if (payload[0] !== TRON_ADDRESS_PREFIX) throw new Error("Invalid Tron address prefix");
  return payload;
}

export function isValidTronAddress(address: string): boolean {
  try {
    const a = address.trim();
    if (!a.startsWith("T") || a.length !== 34) return false;
    decodeBase58Address(a);
    return true;
  } catch {
    return false;
  }
}

/** "T…" -> "41…" hex (what the node API expects when visible=false). */
export function toHexAddress(address: string): string {
  return bytesToHex(decodeBase58Address(address));
}

/** "41…" hex (or 0x-prefixed EVM-style hex) -> "T…". */
export function fromHexAddress(hex: string): string {
  let bytes = hexToBytes(hex);
  if (bytes.length === 20) bytes = concat(new Uint8Array([TRON_ADDRESS_PREFIX]), bytes);
  return encodeBase58Address(bytes);
}

/**
 * ABI-encode an address as a 32-byte word (no 0x prefix). Accepts base58
 * ("T…"), Tron hex ("41…") or bare/0x 20-byte hex — Relay hands us hex.
 */
export function padAddressParam(address: string): string {
  const a = address.trim();
  const hex = a.startsWith("0x") ? a.slice(2) : a;
  if (/^41[0-9a-fA-F]{40}$/.test(hex)) return hex.slice(2).toLowerCase().padStart(64, "0");
  if (/^[0-9a-fA-F]{40}$/.test(hex)) return hex.toLowerCase().padStart(64, "0");
  return toHexAddress(a).slice(2).padStart(64, "0");
}

/** ABI-encode a uint256 as a 32-byte word (no 0x prefix). */
export function padUintParam(value: bigint): string {
  return value.toString(16).padStart(64, "0");
}

export interface TronAccount {
  address: string;
  /** 32-byte private key. Never leaves the device. */
  privateKey: Uint8Array;
  path: string;
}

export function publicKeyToAddress(uncompressedPubKey: Uint8Array): string {
  // Drop the 0x04 SEC1 prefix, keccak the 64-byte key, take the last 20 bytes.
  const hash = keccak_256(uncompressedPubKey.slice(1));
  const raw = concat(new Uint8Array([TRON_ADDRESS_PREFIX]), hash.slice(-20));
  return encodeBase58Address(raw);
}

/** Derive the Tron account from the wallet's existing BIP32 root. */
export function deriveTronAccount(root: BIP32Interface): TronAccount {
  const node = root.derivePath(TRON_DERIVATION_PATH);
  if (!node.privateKey) throw new Error("Failed to derive Tron private key");
  const priv = Uint8Array.from(node.privateKey);
  const pub = secp256k1.getPublicKey(priv, false);
  return {
    address: publicKeyToAddress(pub),
    privateKey: priv,
    path: TRON_DERIVATION_PATH,
  };
}

/** Address-only derivation (no private key retained). */
export function deriveTronAddress(root: BIP32Interface): string {
  const node = root.derivePath(TRON_DERIVATION_PATH);
  if (!node.publicKey) throw new Error("Failed to derive Tron public key");
  const pub = secp256k1.getPublicKey(Uint8Array.from(node.privateKey!), false);
  return publicKeyToAddress(pub);
}
