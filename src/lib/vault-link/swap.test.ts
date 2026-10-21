import { describe, expect, it, vi } from "vitest";
import { Psbt, Transaction, payments } from "bitcoinjs-lib";
import { rootFromSeed } from "@/lib/txc/wallet";
import { deriveVaultAddress, VAULT_CHAIN_META } from "./derive";
import type { VaultPairing } from "./pairing";
import type { VaultChainScan } from "./scan";
import { vaultSwapAccount, vaultSwapVsize, prepareVaultSwap, verifySignedVaultSwap } from "./swap";
import { evmSourceAddress } from "./evm-send";

const root = rootFromSeed(new Uint8Array(32).fill(7));
const pairing: VaultPairing = { v: 1, fp: "73c5da0a", chains: { ltc: { "84": root.derivePath("m/84'/2'/0'").neutered().toBase58() } }, pairedAt: 0,
  evm: { address: "0x14de43dc534c6911c46ca5ca44323e785f07e9ef", path: "m/44'/60'/0'/0/0" } };
const address = deriveVaultAddress(pairing, "ltc", 84, 0, 0);
const scan: VaultChainScan = { chain: "ltc", purpose: 84, balanceSats: 200_000_000, nextReceive: address.address, nextReceiveIndex: 0,
  utxos: [{ ...address, txid: "11".repeat(32), vout: 0, value: 200_000_000 }], used: [], scanned: 40 };

describe("Vault deposit-address swaps", () => {
  it("uses Bobby's paired payout address, not the random anchor", () => {
    expect(evmSourceAddress("vault", root, pairing)).toBe("0x14de43dc534c6911c46ca5ca44323e785f07e9ef");
    expect(evmSourceAddress("vault", root, null)).toBeNull();
  });
  it("reads spendable funds and refund address from paired scans", () => {
    const account = vaultSwapAccount([scan, scan]);
    expect(account.utxos.length).toBe(1);
    expect(account.utxos[0].value).toBe(200_000_000);
    expect(account.nextReceiveAddress).toBe(address.address);
    expect(vaultSwapVsize(scan.utxos, true)).toBe(237);
  });
  it("builds an unsigned 1 LTC swap with memo, change and Vault paths", async () => {
    const destination = deriveVaultAddress(pairing, "ltc", 84, 0, 1).address;
    const built = await prepareVaultSwap({ pairing, coin: "ltc", scans: [scan], inputs: scan.utxos,
      depositAddress: destination, amountSats: 100_000_000, feeSats: 1000, memo: "SWAP:ETH.USDC:0x14de43dc534c6911c46ca5ca44323e785f07e9ef" });
    const psbt = Psbt.fromBase64(built.psbtBase64);
    expect(psbt.data.inputs[0].bip32Derivation?.[0].path).toBe("m/84'/2'/0'/0/0");
    expect(psbt.data.inputs[0].partialSig).toBeUndefined();
    expect(psbt.txOutputs.length).toBe(3);
    expect(psbt.txOutputs[1].value).toBe(100_000_000n);
    expect(built.changeSats).toBe(99_999_000);
    const tx = new Transaction();
    tx.version = psbt.version;
    tx.locktime = psbt.locktime;
    for (const input of psbt.txInputs) tx.addInput(input.hash, input.index, input.sequence);
    for (const output of psbt.txOutputs) tx.addOutput(output.script, output.value);
    tx.setWitness(0, [new Uint8Array([1]), address.pubkey]);
    expect(verifySignedVaultSwap(tx.toHex(), built.psbtBase64)).toBe(tx.getId());
    const original = tx.toHex();
    tx.outs[2].value -= 1n;
    expect(() => verifySignedVaultSwap(tx.toHex(), built.psbtBase64)).toThrow(/does not match/);
    const extra = Transaction.fromHex(original);
    const script = payments.p2wpkh({ pubkey: address.pubkey, network: VAULT_CHAIN_META.ltc.network }).output;
    if (!script) throw new Error("Missing test script");
    extra.addOutput(script, 1n);
    expect(() => verifySignedVaultSwap(extra.toHex(), built.psbtBase64)).toThrow(/does not match/);
    const changedInput = Transaction.fromHex(original);
    changedInput.ins[0].index = 1;
    expect(() => verifySignedVaultSwap(changedInput.toHex(), built.psbtBase64)).toThrow(/does not match/);
    const changedMemo = Transaction.fromHex(original);
    changedMemo.outs[0].script = new Uint8Array([106]);
    expect(() => verifySignedVaultSwap(changedMemo.toHex(), built.psbtBase64)).toThrow(/does not match/);
  });
});