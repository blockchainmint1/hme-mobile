/**
 * Bitcoin-style signed messages for TEXITcoin addresses (BIP-137 compatible).
 *
 * Everything runs locally: the seed is derived in memory, the compact
 * signature is returned base64-encoded exactly like Electrum / Bitcoin Core.
 */
import * as ecc from "@bitcoinerlab/secp256k1";
import { sha256 } from "@noble/hashes/sha2.js";
import { base64 } from "@scure/base";
import { TXC_NETWORK, scriptKindOf, type DerivationKind } from "./network";
import { deriveAddress, rootFromSeed, seedFromMnemonic } from "./wallet";

function varint(n: number): Uint8Array {
  if (n < 0xfd) return Uint8Array.of(n);
  if (n <= 0xffff) return Uint8Array.of(0xfd, n & 0xff, (n >> 8) & 0xff);
  return Uint8Array.of(0xfe, n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >> 24) & 0xff);
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

const enc = new TextEncoder();

/** double-SHA256 of the magic-prefixed message, as used by Bitcoin Core. */
export function messageHash(message: string): Uint8Array {
  const prefix = enc.encode(TXC_NETWORK.messagePrefix);
  const msg = enc.encode(message);
  const buf = concat(varint(prefix.length), prefix, varint(msg.length), msg);
  return sha256(sha256(buf));
}

function headerBase(kind: DerivationKind): number {
  switch (scriptKindOf(kind)) {
    case "bip84":
      return 39; // p2wpkh
    case "bip49":
      return 35; // p2sh-p2wpkh
    default:
      return 31; // compressed p2pkh
  }
}

export interface SignedMessage {
  address: string;
  path: string;
  message: string;
  signature: string;
}

export async function signMessageWithSeed(args: {
  mnemonic: string;
  passphrase?: string;
  kind: DerivationKind;
  change?: 0 | 1;
  index?: number;
  message: string;
}): Promise<SignedMessage> {
  const { mnemonic, passphrase = "", kind, change = 0, index = 0, message } = args;
  const seed = await seedFromMnemonic(mnemonic, passphrase);
  const root = rootFromSeed(seed);
  const derived = deriveAddress(root, kind, change, index);
  const node = root.derivePath(derived.path);
  if (!node.privateKey) throw new Error("No private key available for this address");

  const hash = messageHash(message);
  const { signature, recoveryId } = ecc.signRecoverable(hash, node.privateKey);
  const out = new Uint8Array(65);
  out[0] = headerBase(kind) + recoveryId;
  out.set(signature, 1);

  return {
    address: derived.address,
    path: derived.path,
    message,
    signature: base64.encode(out),
  };
}

/** Sign with a raw private key (WIF / key-only wallets). */
export function signMessageWithKey(args: {
  privateKey: Uint8Array;
  kind: DerivationKind;
  address: string;
  message: string;
}): SignedMessage {
  const { privateKey, kind, address, message } = args;
  const hash = messageHash(message);
  const { signature, recoveryId } = ecc.signRecoverable(hash, privateKey);
  const out = new Uint8Array(65);
  out[0] = headerBase(kind) + recoveryId;
  out.set(signature, 1);
  return { address, path: "", message, signature: base64.encode(out) };
}
