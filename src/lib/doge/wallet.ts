/**
 * Dogecoin address derivation + PSBT signing. Legacy-only (BIP44, D… P2PKH).
 * The BIP32 root is shared with TXC/ISK/LTC — network params only affect
 * address encoding.
 */
import * as ecc from "@bitcoinerlab/secp256k1";
import type { BIP32Interface } from "bip32";
import { payments, Psbt } from "bitcoinjs-lib";
import { DOGE_NETWORK, DOGE_DERIVATION_PATHS, type DogeDerivationKind } from "./network";

export type AddressKind = DogeDerivationKind;

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
  return `${DOGE_DERIVATION_PATHS[kind]}/${change}/${index}`;
}

export function deriveAddress(
  root: BIP32Interface,
  kind: AddressKind,
  change: 0 | 1,
  index: number,
): DerivedAddress {
  const path = pathFor(kind, change, index);
  const node = root.derivePath(path);
  const p = payments.p2pkh({ pubkey: node.publicKey, network: DOGE_NETWORK });
  if (!p.address) throw new Error("Failed to derive DOGE legacy address");
  return { index, change, path, address: p.address, pubkey: node.publicKey };
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

  const psbt = new Psbt({ network: DOGE_NETWORK });

  for (const u of inputs) {
    if (!u.nonWitnessUtxoHex) throw new Error("nonWitnessUtxoHex required for DOGE legacy input");
    psbt.addInput({ hash: u.txid, index: u.vout, nonWitnessUtxo: hexToBytes(u.nonWitnessUtxoHex) });
  }

  for (const o of outputs) psbt.addOutput({ address: o.address, value: BigInt(o.valueSats) });
  if (changeSats > 0) psbt.addOutput({ address: changeAddress, value: BigInt(changeSats) });

  inputs.forEach((u, i) => {
    const node = root.derivePath(`${DOGE_DERIVATION_PATHS[kind]}/${u.change}/${u.index}`);
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
