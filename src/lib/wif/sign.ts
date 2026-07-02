/**
 * Build & sign transactions for single-key (WIF) wallets.
 * Works for both TXC and ISK — network is passed in.
 */
import * as ecc from "@bitcoinerlab/secp256k1";
import { Psbt, payments, type Network } from "bitcoinjs-lib";
import type { WifAddressKind } from "./decode";

export interface WifUtxoInput {
  txid: string;
  vout: number;
  value: number;
  /** raw tx hex — required for BIP44 (legacy) */
  nonWitnessUtxoHex?: string;
  /** scriptPubKey hex — required for BIP84 / BIP49 */
  witnessScriptHex?: string;
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

export function buildAndSignWifTx(args: {
  network: Network;
  kind: WifAddressKind;
  privateKey: Uint8Array;
  publicKey: Uint8Array;
  inputs: WifUtxoInput[];
  outputs: { address: string; valueSats: number }[];
  changeAddress: string;
  feeSats: number;
}): { hex: string; txid: string; feeSats: number; changeSats: number } {
  const { network, kind, privateKey, publicKey, inputs, outputs, changeAddress, feeSats } = args;
  const totalIn = inputs.reduce((s, u) => s + u.value, 0);
  const totalOut = outputs.reduce((s, o) => s + o.valueSats, 0);
  const changeSats = totalIn - totalOut - feeSats;
  if (changeSats < 0) throw new Error("Insufficient funds for outputs + fee");

  const psbt = new Psbt({ network });
  for (const u of inputs) {
    const base: Parameters<typeof psbt.addInput>[0] = { hash: u.txid, index: u.vout };
    if (kind === "bip84") {
      if (!u.witnessScriptHex) throw new Error("witnessScriptHex required for BIP84 input");
      base.witnessUtxo = { script: hexToBytes(u.witnessScriptHex), value: BigInt(u.value) };
    } else if (kind === "bip49") {
      if (!u.witnessScriptHex) throw new Error("witnessScriptHex required for BIP49 input");
      const inner = payments.p2wpkh({ pubkey: publicKey, network });
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

  inputs.forEach((_, i) => {
    psbt.signInput(i, {
      publicKey,
      sign: (hash) => ecc.sign(hash, privateKey),
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

// Rough vbytes per input/output by address type. Matches wallet.send.tsx.
const VBYTES = {
  bip84: { input: 68, output: 31, overhead: 11 },
  bip49: { input: 91, output: 32, overhead: 11 },
  bip44: { input: 148, output: 34, overhead: 10 },
} as const;

export function estimateWifVsize(kind: WifAddressKind, nIn: number, nOut: number): number {
  const v = VBYTES[kind];
  return v.overhead + v.input * nIn + v.output * nOut;
}
