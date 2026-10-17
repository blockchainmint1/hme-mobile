/**
 * Build UNSIGNED PSBTs for Vault to sign (BIP-174).
 *
 * Follows Vault's acceptance rules (docs/offline-signing-handoff.md):
 *  - every input carries bip32Derivation { masterFingerprint, path, pubkey }
 *  - legacy (44) inputs carry the full nonWitnessUtxo; segwit (49/84) carry
 *    witnessUtxo, and 49 adds its redeemScript
 *  - change output carries bip32Derivation so Vault doesn't show it as a payment
 *  - SIGHASH_ALL only, no multisig / taproot
 *
 * We never sign here — the PSBT goes to the Vault device by QR and comes back
 * as signed raw transaction hex.
 */
import { payments, Psbt, Transaction } from "bitcoinjs-lib";
import { deriveVaultAddress, VAULT_CHAIN_META } from "./derive";
import type { VaultPairing, VaultUtxoChain } from "./pairing";
import type { VaultUtxo } from "./scan";

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

function fpBytes(fp: string): Uint8Array {
  return hexToBytes(fp);
}

export interface VaultPsbtRequest {
  pairing: VaultPairing;
  chain: VaultUtxoChain;
  /** Selected UTXOs (must cover outputs + fee). */
  inputs: VaultUtxo[];
  /** Full previous-tx hex for every legacy (purpose 44) input, keyed `${txid}:${vout}`. */
  prevTxHex: Record<string, string>;
  outputs: { address: string; valueSats: number }[];
  feeSats: number;
  /** Change goes to the next unused change address of the primary purpose. */
  changePurpose: 44 | 49 | 84;
  changeIndex: number;
  /** TXC dust rule is 10,000 sat; other chains use the Bitcoin-standard 546. */
  dustSats?: number;
  /** Optional OP_RETURN payload (Omni token sends on TXC/ISK). Placed first. */
  opReturnData?: Uint8Array;
}

export interface BuiltVaultPsbt {
  psbtBase64: string;
  feeSats: number;
  changeSats: number;
  changeAddress?: string;
}

export function buildVaultPsbt(req: VaultPsbtRequest): BuiltVaultPsbt {
  const meta = VAULT_CHAIN_META[req.chain];
  const dust = req.dustSats ?? (req.chain === "txc" || req.chain === "isk" ? 10_000 : 546);
  const fp = fpBytes(req.pairing.fp);

  const totalIn = req.inputs.reduce((s, u) => s + u.value, 0);
  const totalOut = req.outputs.reduce((s, o) => s + o.valueSats, 0);
  let feeSats = req.feeSats;
  let changeSats = totalIn - totalOut - feeSats;
  if (changeSats < 0) throw new Error("Not enough funds in the selected coins for amount + fee.");
  if (changeSats > 0 && changeSats < dust) {
    feeSats += changeSats;
    changeSats = 0;
  }
  for (const o of req.outputs) {
    if (o.valueSats < dust) throw new Error(`Output of ${o.valueSats} sat is below the dust threshold (${dust}).`);
  }

  const psbt = new Psbt({ network: meta.network, maximumFeeRate: 10_000_000 });

  for (const u of req.inputs) {
    const input: Parameters<typeof psbt.addInput>[0] = {
      hash: u.txid,
      index: u.vout,
      bip32Derivation: [
        {
          masterFingerprint: fp as unknown as Buffer,
          path: u.path,
          pubkey: u.pubkey as unknown as Buffer,
        },
      ],
    };
    if (u.purpose === 84) {
      const derived = deriveVaultAddress(req.pairing, req.chain, 84, u.change, u.index);
      const p = payments.p2wpkh({ pubkey: derived.pubkey, network: meta.network });
      if (!p.output) throw new Error("Failed to build witness script");
      input.witnessUtxo = { script: p.output, value: BigInt(u.value) };
    } else if (u.purpose === 49) {
      const derived = deriveVaultAddress(req.pairing, req.chain, 49, u.change, u.index);
      const inner = payments.p2wpkh({ pubkey: derived.pubkey, network: meta.network });
      const outer = payments.p2sh({ redeem: inner, network: meta.network });
      if (!inner.output || !outer.output) throw new Error("Failed to build wrapped-segwit script");
      input.witnessUtxo = { script: outer.output, value: BigInt(u.value) };
      input.redeemScript = inner.output;
    } else {
      const hex = req.prevTxHex[`${u.txid}:${u.vout}`];
      if (!hex) throw new Error("Missing previous transaction for a legacy input.");
      input.nonWitnessUtxo = hexToBytes(hex);
    }
    psbt.addInput(input);
  }

  if (req.opReturnData) {
    const embed = payments.embed({ data: [req.opReturnData as unknown as Buffer] });
    if (!embed.output) throw new Error("Failed to build OP_RETURN output");
    psbt.addOutput({ script: embed.output, value: 0n });
  }
  for (const o of req.outputs) psbt.addOutput({ address: o.address, value: BigInt(o.valueSats) });

  let changeAddress: string | undefined;
  if (changeSats > 0) {
    const change = deriveVaultAddress(req.pairing, req.chain, req.changePurpose, 1, req.changeIndex);
    changeAddress = change.address;
    psbt.addOutput({
      address: change.address,
      value: BigInt(changeSats),
      bip32Derivation: [
        {
          masterFingerprint: fp as unknown as Buffer,
          path: change.path,
          pubkey: change.pubkey as unknown as Buffer,
        },
      ],
    });
  }

  return { psbtBase64: psbt.toBase64(), feeSats, changeSats, changeAddress };
}

/**
 * Verify a signed transaction hex returned by Vault: it must parse, and its
 * outputs must include every payment we asked for (address + value). We can't
 * re-derive the txid trustlessly without a full parser, but bitcoinjs gives
 * us one.
 */
export function verifySignedTx(
  hex: string,
  chain: VaultUtxoChain,
  expectedOutputs: { address: string; valueSats: number }[],
): { txid: string } {
  const clean = hex.trim().toLowerCase();
  if (!/^[0-9a-f]+$/.test(clean) || clean.length < 20) {
    throw new Error("That QR code didn't contain a signed transaction.");
  }
  const { Transaction } = require("bitcoinjs-lib") as typeof import("bitcoinjs-lib");
  const tx = Transaction.fromHex(clean);
  const meta = VAULT_CHAIN_META[chain];
  const seen = tx.outs.map((o) => ({
    address: (() => {
      try {
        return payments.p2pkh({ output: o.script, network: meta.network }).address;
      } catch {
        try {
          return payments.p2sh({ output: o.script, network: meta.network }).address;
        } catch {
          try {
            return payments.p2wpkh({ output: o.script, network: meta.network }).address;
          } catch {
            return undefined;
          }
        }
      }
    })(),
    value: Number(o.value),
  }));
  for (const want of expectedOutputs) {
    const hit = seen.find((s) => s.address === want.address && s.value === want.valueSats);
    if (!hit) {
      throw new Error("The signed transaction doesn't match what you asked for. Nothing was broadcast.");
    }
  }
  return { txid: tx.getId() };
}
