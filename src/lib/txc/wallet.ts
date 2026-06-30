/**
 * TEXITcoin HD wallet primitives.
 *
 * - BIP39 seed phrase (12 / 24 words) with optional passphrase.
 * - BIP32 derivation using TEXITcoin network bytes.
 * - BIP84 native segwit (txc1...) by default; BIP44 / BIP49 supported on import.
 *
 * All crypto runs locally in the browser. Seed material never leaves the device.
 */
import * as ecc from "@bitcoinerlab/secp256k1";
import * as bip39 from "bip39";
import { BIP32Factory, type BIP32Interface } from "bip32";
import { Buffer } from "buffer";
import { ECPairFactory } from "ecpair";
import { payments, Psbt } from "bitcoinjs-lib";
import { TXC_NETWORK, DERIVATION_PATHS, type DerivationKind } from "./network";

if (typeof globalThis !== "undefined" && !(globalThis as { Buffer?: unknown }).Buffer) {
  (globalThis as { Buffer: typeof Buffer }).Buffer = Buffer;
}

const bip32 = BIP32Factory(ecc);
const ECPair = ECPairFactory(ecc);

export type AddressKind = DerivationKind;

export interface DerivedAddress {
  index: number;
  change: 0 | 1;
  path: string;
  address: string;
  pubkey: Uint8Array;
}

export interface UtxoInput {
  txid: string;
  vout: number;
  value: number; // sats
  /** Full raw tx hex — required for legacy / wrapped-segwit (non-witness) inputs. */
  nonWitnessUtxoHex?: string;
  /** scriptPubKey hex — required for witness (BIP84/BIP49) inputs. */
  witnessScriptHex?: string;
  // Which derived key signs this input.
  change: 0 | 1;
  index: number;
}

export function generateMnemonic(strengthBits: 128 | 256 = 128): string {
  return bip39.generateMnemonic(strengthBits);
}

export function validateMnemonic(phrase: string): boolean {
  return bip39.validateMnemonic(phrase.trim().toLowerCase().replace(/\s+/g, " "));
}

export function normalizeMnemonic(phrase: string): string {
  return phrase.trim().toLowerCase().replace(/\s+/g, " ");
}

export async function seedFromMnemonic(phrase: string, passphrase = ""): Promise<Uint8Array> {
  // bip39 returns Buffer in Node; in the browser shim it returns Uint8Array-like.
  const buf = await bip39.mnemonicToSeed(normalizeMnemonic(phrase), passphrase);
  return new Uint8Array(buf);
}

export function rootFromSeed(seed: Uint8Array): BIP32Interface {
  return bip32.fromSeed(Buffer.from(seed), TXC_NETWORK);
}

function pathFor(kind: AddressKind, change: 0 | 1, index: number): string {
  return `${DERIVATION_PATHS[kind]}/${change}/${index}`;
}

function deriveAddressFromNode(node: BIP32Interface, kind: AddressKind): string {
  const pubkey = Buffer.from(node.publicKey);
  switch (kind) {
    case "bip84": {
      const p = payments.p2wpkh({ pubkey, network: TXC_NETWORK });
      if (!p.address) throw new Error("Failed to derive bech32 address");
      return p.address;
    }
    case "bip49": {
      const inner = payments.p2wpkh({ pubkey, network: TXC_NETWORK });
      const p = payments.p2sh({ redeem: inner, network: TXC_NETWORK });
      if (!p.address) throw new Error("Failed to derive p2sh-p2wpkh address");
      return p.address;
    }
    case "bip44": {
      const p = payments.p2pkh({ pubkey, network: TXC_NETWORK });
      if (!p.address) throw new Error("Failed to derive legacy address");
      return p.address;
    }
  }
}

export function deriveAddress(
  root: BIP32Interface,
  kind: AddressKind,
  change: 0 | 1,
  index: number,
): DerivedAddress {
  const path = pathFor(kind, change, index);
  const node = root.derivePath(path);
  return {
    index,
    change,
    path,
    address: deriveAddressFromNode(node, kind),
    pubkey: node.publicKey,
  };
}

export function deriveAddresses(
  root: BIP32Interface,
  kind: AddressKind,
  change: 0 | 1,
  count: number,
  startIndex = 0,
): DerivedAddress[] {
  const out: DerivedAddress[] = [];
  for (let i = 0; i < count; i++) out.push(deriveAddress(root, kind, change, startIndex + i));
  return out;
}

/** Build, sign and serialize a TEXITcoin transaction. Returns raw hex ready to broadcast. */
export function buildAndSignTx(args: {
  root: BIP32Interface;
  kind: AddressKind;
  inputs: UtxoInput[];
  outputs: { address: string; valueSats: number }[];
  changeAddress: string;
  changeIndex: number; // m/.../1/<index>
  feeSats: number;
}): { hex: string; txid: string; feeSats: number; changeSats: number } {
  const { root, kind, inputs, outputs, changeAddress, feeSats } = args;

  const totalIn = inputs.reduce((s, u) => s + u.value, 0);
  const totalOut = outputs.reduce((s, o) => s + o.valueSats, 0);
  const changeSats = totalIn - totalOut - feeSats;
  if (changeSats < 0) throw new Error("Insufficient funds for outputs + fee");

  const psbt = new Psbt({ network: TXC_NETWORK });

  for (const u of inputs) {
    const base: Parameters<typeof psbt.addInput>[0] = { hash: u.txid, index: u.vout };
    if (kind === "bip84") {
      if (!u.witnessScriptHex) throw new Error("witnessScriptHex required for BIP84 input");
      base.witnessUtxo = {
        script: Buffer.from(u.witnessScriptHex, "hex"),
        value: BigInt(u.value),
      };
    } else if (kind === "bip49") {
      if (!u.witnessScriptHex) throw new Error("witnessScriptHex required for BIP49 input");
      const node = root.derivePath(`${DERIVATION_PATHS[kind]}/${u.change}/${u.index}`);
      const inner = payments.p2wpkh({ pubkey: Buffer.from(node.publicKey), network: TXC_NETWORK });
      base.witnessUtxo = {
        script: Buffer.from(u.witnessScriptHex, "hex"),
        value: BigInt(u.value),
      };
      base.redeemScript = inner.output as Buffer;
    } else {
      if (!u.nonWitnessUtxoHex) throw new Error("nonWitnessUtxoHex required for legacy input");
      base.nonWitnessUtxo = Buffer.from(u.nonWitnessUtxoHex, "hex");
    }
    psbt.addInput(base);
  }

  for (const o of outputs) psbt.addOutput({ address: o.address, value: BigInt(o.valueSats) });
  if (changeSats > 0) psbt.addOutput({ address: changeAddress, value: BigInt(changeSats) });


  // Sign every input with its derived key.
  inputs.forEach((u, i) => {
    const node = root.derivePath(`${DERIVATION_PATHS[kind]}/${u.change}/${u.index}`);
    if (!node.privateKey) throw new Error("Missing private key during signing");
    const keypair = ECPair.fromPrivateKey(Buffer.from(node.privateKey), { network: TXC_NETWORK });
    psbt.signInput(i, {
      publicKey: Buffer.from(keypair.publicKey),
      sign: (hash) => Buffer.from(keypair.sign(hash)),
    });
  });

  psbt.finalizeAllInputs();
  const tx = psbt.extractTransaction();
  return {
    hex: tx.toHex(),
    txid: tx.getId(),
    feeSats,
    changeSats: Math.max(0, changeSats),
  };
}
