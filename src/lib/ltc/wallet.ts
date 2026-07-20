/**
 * Litecoin address derivation + PSBT signing. Same shape as src/lib/isk/wallet.ts;
 * uses LTC_NETWORK for address encoding. The BIP32 root is shared with TXC/ISK
 * (Bitcoin xpub bytes), and we derive under SLIP-44 coin type 2.
 */
import * as ecc from "@bitcoinerlab/secp256k1";
import type { BIP32Interface } from "bip32";
import { payments, Psbt } from "bitcoinjs-lib";
import { LTC_NETWORK, LTC_DERIVATION_PATHS, type LtcDerivationKind } from "./network";

export type AddressKind = LtcDerivationKind;

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
  value: number;
  nonWitnessUtxoHex?: string;
  witnessScriptHex?: string;
  change: 0 | 1;
  index: number;
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.trim();
  if (clean.length % 2 !== 0) throw new Error("Invalid hex string");
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    const b = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
    if (Number.isNaN(b)) throw new Error("Invalid hex string");
    out[i] = b;
  }
  return out;
}

function pathFor(kind: AddressKind, change: 0 | 1, index: number): string {
  return `${LTC_DERIVATION_PATHS[kind]}/${change}/${index}`;
}

function deriveAddressFromNode(node: BIP32Interface, kind: AddressKind): string {
  const pubkey = node.publicKey;
  switch (kind) {
    case "bip84": {
      const p = payments.p2wpkh({ pubkey, network: LTC_NETWORK });
      if (!p.address) throw new Error("Failed to derive ltc1q bech32 address");
      return p.address;
    }
    case "bip49": {
      const inner = payments.p2wpkh({ pubkey, network: LTC_NETWORK });
      const p = payments.p2sh({ redeem: inner, network: LTC_NETWORK });
      if (!p.address) throw new Error("Failed to derive ltc M… p2sh address");
      return p.address;
    }
    case "bip44": {
      const p = payments.p2pkh({ pubkey, network: LTC_NETWORK });
      if (!p.address) throw new Error("Failed to derive ltc L… legacy address");
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
  return { index, change, path, address: deriveAddressFromNode(node, kind), pubkey: node.publicKey };
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

export function buildAndSignTx(args: {
  root: BIP32Interface;
  kind: AddressKind;
  inputs: UtxoInput[];
  outputs: { address: string; valueSats: number }[];
  changeAddress: string;
  changeIndex: number;
  feeSats: number;
}): { hex: string; txid: string; feeSats: number; changeSats: number } {
  const { root, kind, inputs, outputs, changeAddress, feeSats } = args;
  const totalIn = inputs.reduce((s, u) => s + u.value, 0);
  const totalOut = outputs.reduce((s, o) => s + o.valueSats, 0);
  const changeSats = totalIn - totalOut - feeSats;
  if (changeSats < 0) throw new Error("Insufficient funds for outputs + fee");

  const psbt = new Psbt({ network: LTC_NETWORK });

  for (const u of inputs) {
    const base: Parameters<typeof psbt.addInput>[0] = { hash: u.txid, index: u.vout };
    if (kind === "bip84") {
      if (!u.witnessScriptHex) throw new Error("witnessScriptHex required for BIP84 input");
      base.witnessUtxo = { script: hexToBytes(u.witnessScriptHex), value: BigInt(u.value) };
    } else if (kind === "bip49") {
      if (!u.witnessScriptHex) throw new Error("witnessScriptHex required for BIP49 input");
      const node = root.derivePath(`${LTC_DERIVATION_PATHS[kind]}/${u.change}/${u.index}`);
      const inner = payments.p2wpkh({ pubkey: node.publicKey, network: LTC_NETWORK });
      base.witnessUtxo = { script: hexToBytes(u.witnessScriptHex), value: BigInt(u.value) };
      base.redeemScript = inner.output;
    } else {
      if (!u.nonWitnessUtxoHex) throw new Error("nonWitnessUtxoHex required for legacy input");
      base.nonWitnessUtxo = hexToBytes(u.nonWitnessUtxoHex);
    }
    psbt.addInput(base);
  }

  for (const o of outputs) psbt.addOutput({ address: o.address, value: BigInt(o.valueSats) });
  if (changeSats > 0) psbt.addOutput({ address: changeAddress, value: BigInt(changeSats) });

  inputs.forEach((u, i) => {
    const node = root.derivePath(`${LTC_DERIVATION_PATHS[kind]}/${u.change}/${u.index}`);
    if (!node.privateKey) throw new Error("Missing private key during signing");
    psbt.signInput(i, {
      publicKey: node.publicKey,
      sign: (hash) => ecc.sign(hash, node.privateKey!),
    });
  });

  psbt.finalizeAllInputs();
  const tx = psbt.extractTransaction();
  return { hex: tx.toHex(), txid: tx.getId(), feeSats, changeSats: Math.max(0, changeSats) };
}
