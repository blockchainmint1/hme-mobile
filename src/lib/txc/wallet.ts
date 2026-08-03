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
import {
  entropyToMnemonic,
  mnemonicToEntropy,
  mnemonicToSeed,
  validateMnemonic as validateBip39Mnemonic,
} from "@scure/bip39";
import { wordlist as englishWordlist } from "@scure/bip39/wordlists/english.js";
import { BIP32Factory, type BIP32Interface } from "bip32";
import { payments, Psbt } from "bitcoinjs-lib";
import { extractEntropy, wipe } from "./entropy";
import { TXC_NETWORK, DERIVATION_PATHS, scriptKindOf, type DerivationKind } from "./network";


const bip32 = BIP32Factory(ecc);

function secureRandomBytes(length: number): Uint8Array {
  const crypto = globalThis.crypto;
  if (!crypto?.getRandomValues) {
    throw new Error("Secure random generator unavailable on this device.");
  }
  return crypto.getRandomValues(new Uint8Array(length));
}

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
  /**
   * Derivation kind this UTXO's key comes from. A TXC account spans several
   * paths (SLIP-0044 696969' plus the legacy 0' paths from the old mobile
   * app), so inputs in one transaction can come from different branches.
   * Defaults to the transaction's primary kind when absent.
   */
  kind?: AddressKind;
}

/**
 * Turn raw entropy into a mnemonic, verifying the result round-trips
 * (checksum valid + decodes back to the exact same entropy) before it is
 * ever shown to the user. Then wipe the entropy buffer.
 */
function entropyToVerifiedMnemonic(entropy: Uint8Array): string {
  const phrase = entropyToMnemonic(entropy, englishWordlist);
  if (!validateBip39Mnemonic(phrase, englishWordlist)) {
    wipe(entropy);
    throw new Error("Generated seed phrase failed its checksum. Please try again.");
  }
  const back = mnemonicToEntropy(phrase, englishWordlist);
  let same = back.length === entropy.length;
  for (let i = 0; i < entropy.length && same; i++) same = back[i] === entropy[i];
  wipe(entropy, back);
  if (!same) throw new Error("Generated seed phrase failed verification. Please try again.");
  return phrase;
}

export function generateMnemonic(strengthBits: 128 | 256 = 128): string {
  if (strengthBits !== 128 && strengthBits !== 256) throw new TypeError("Invalid entropy strength");
  return entropyToVerifiedMnemonic(extractEntropy(strengthBits === 256 ? 32 : 16));
}

/**
 * Generate a mnemonic from user-supplied entropy (e.g. screen scribbles)
 * folded into cryptographically secure randomness via an HMAC extractor.
 * If the user input is predictable, the result is still exactly as strong as
 * `generateMnemonic`. If it is unpredictable, the result is strictly stronger.
 */
export function generateMnemonicFromUserEntropy(
  userBytes: Uint8Array,
  strengthBits: 128 | 256 = 256,
): string {
  if (strengthBits !== 128 && strengthBits !== 256) throw new TypeError("Invalid entropy strength");
  return entropyToVerifiedMnemonic(
    extractEntropy(strengthBits === 256 ? 32 : 16, userBytes),
  );
}


function hexToBytes(hex: string): Uint8Array {
  const clean = hex.trim();
  if (clean.length % 2 !== 0) throw new Error("Invalid hex string");
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    const byte = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
    if (Number.isNaN(byte)) throw new Error("Invalid hex string");
    out[i] = byte;
  }
  return out;
}

export function validateMnemonic(phrase: string): boolean {
  return validateBip39Mnemonic(phrase.trim().toLowerCase().replace(/\s+/g, " "), englishWordlist);
}

export function normalizeMnemonic(phrase: string): string {
  return phrase.trim().toLowerCase().replace(/\s+/g, " ");
}

export async function seedFromMnemonic(phrase: string, passphrase = ""): Promise<Uint8Array> {
  return new Uint8Array(await mnemonicToSeed(normalizeMnemonic(phrase), passphrase));
}

export function rootFromSeed(seed: Uint8Array): BIP32Interface {
  return bip32.fromSeed(seed, TXC_NETWORK);
}

function pathFor(kind: AddressKind, change: 0 | 1, index: number): string {
  return `${DERIVATION_PATHS[kind]}/${change}/${index}`;
}

function deriveAddressFromNode(node: BIP32Interface, kind: AddressKind): string {
  const pubkey = node.publicKey;
  switch (scriptKindOf(kind)) {
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
  /**
   * Optional raw data bytes for an OP_RETURN output (payload only, without
   * the OP_RETURN opcode). Used for Omni Layer transfers. Placed FIRST so
   * Omni's reference-address rule ("first non-OP_RETURN output" = recipient)
   * still resolves to the user output. Value on the OP_RETURN is 0.
   */
  opReturnData?: Uint8Array;
}): { hex: string; txid: string; feeSats: number; changeSats: number } {
  const { root, kind, inputs, outputs, changeAddress, feeSats, opReturnData } = args;

  const totalIn = inputs.reduce((s, u) => s + u.value, 0);
  const totalOut = outputs.reduce((s, o) => s + o.valueSats, 0);
  const changeSats = totalIn - totalOut - feeSats;
  if (changeSats < 0) throw new Error("Insufficient funds for outputs + fee");

  const psbt = new Psbt({ network: TXC_NETWORK, maximumFeeRate: 10_000_000 });

  for (const u of inputs) {
    const uKind = u.kind ?? kind;
    const uScript = scriptKindOf(uKind);
    const base: Parameters<typeof psbt.addInput>[0] = { hash: u.txid, index: u.vout };
    if (uScript === "bip84") {
      if (!u.witnessScriptHex) throw new Error("witnessScriptHex required for BIP84 input");
      base.witnessUtxo = {
        script: hexToBytes(u.witnessScriptHex),
        value: BigInt(u.value),
      };
    } else if (uScript === "bip49") {
      if (!u.witnessScriptHex) throw new Error("witnessScriptHex required for BIP49 input");
      const node = root.derivePath(`${DERIVATION_PATHS[uKind]}/${u.change}/${u.index}`);
      const inner = payments.p2wpkh({ pubkey: node.publicKey, network: TXC_NETWORK });
      base.witnessUtxo = {
        script: hexToBytes(u.witnessScriptHex),
        value: BigInt(u.value),
      };
      base.redeemScript = inner.output;
    } else {
      if (!u.nonWitnessUtxoHex) throw new Error("nonWitnessUtxoHex required for legacy input");
      base.nonWitnessUtxo = hexToBytes(u.nonWitnessUtxoHex);
    }
    psbt.addInput(base);
  }

  if (opReturnData) {
    // bitcoinjs-lib accepts Uint8Array here; avoid Buffer to stay browser-safe (mobile WebViews).
    const embed = payments.embed({ data: [opReturnData as unknown as Buffer] });
    if (!embed.output) throw new Error("Failed to build OP_RETURN output");
    psbt.addOutput({ script: embed.output, value: 0n });
  }
  for (const o of outputs) psbt.addOutput({ address: o.address, value: BigInt(o.valueSats) });
  if (changeSats > 0) psbt.addOutput({ address: changeAddress, value: BigInt(changeSats) });


  // Sign every input with its derived key.
  inputs.forEach((u, i) => {
    const node = root.derivePath(`${DERIVATION_PATHS[u.kind ?? kind]}/${u.change}/${u.index}`);
    if (!node.privateKey) throw new Error("Missing private key during signing");
    psbt.signInput(i, {
      publicKey: node.publicKey,
      sign: (hash) => ecc.sign(hash, node.privateKey!),
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

