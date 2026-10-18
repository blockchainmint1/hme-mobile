import { describe, expect, it } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { rootFromSeed } from "@/lib/txc/wallet";
import { buildErc20Intent, buildNativeIntent, type EvmIntent } from "./evm-intent";
import { evmSourceAddress, intentTransaction, verifyVaultEvmSend, prepareVaultEvmSend } from "./evm-send";
import { USDC_BY_CHAIN } from "@/lib/chains/erc20";
import type { VaultPairing } from "./pairing";

const signer = privateKeyToAccount(`0x${"11".repeat(32)}`);
const pairing: VaultPairing = { v: 1, fp: "73c5da0a", chains: {}, pairedAt: 0, evm: { address: signer.address, path: "m/44'/60'/0'/0/0" } };
const common = { pairing, chainId: 1, to: `0x${"22".repeat(20)}`, nonce: 7, gas: 65000n, fees: { type: "eip1559" as const, maxFeePerGas: 30000000000n, maxPriorityFeePerGas: 1000000000n } };
const intent = JSON.parse(buildErc20Intent({ ...common, token: USDC_BY_CHAIN.eth.address, amountRaw: 100000000n })) as EvmIntent;
async function signed(i: EvmIntent, overrides = {}) {
  return signer.signTransaction({ ...intentTransaction(i), chainId: i.chainId, nonce: i.nonce, gas: BigInt(i.gas), type: "eip1559", maxFeePerGas: 30000000000n, maxPriorityFeePerGas: 1000000000n, ...overrides });
}
describe("Vault EVM sending", () => {
  it("uses the paired address, never the wrapping anchor", () => {
    const root = rootFromSeed(new Uint8Array(32).fill(5));
    expect(evmSourceAddress("vault", root, pairing)).toBe(signer.address);
    expect(evmSourceAddress("vault", root, null)).toBeNull();
    expect(evmSourceAddress("keyonly", root, null)).toBeNull();
    expect(evmSourceAddress(undefined, root, null)).not.toBe(signer.address);
  });
  it("accepts exactly 100 USDC signed offline", async () => {
    await expect(verifyVaultEvmSend(await signed(intent), intent)).resolves.toBeUndefined();
    expect(intentTransaction(intent).to).toBe(USDC_BY_CHAIN.eth.address);
  });
  it("accepts native transfer signed offline", async () => {
    const native = JSON.parse(buildNativeIntent({ ...common, valueWei: 1n })) as EvmIntent;
    await expect(verifyVaultEvmSend(await signed(native), native)).resolves.toBeUndefined();
  });
  it.each([{ chainId: 8453 }, { nonce: 8 }, { to: common.to }, { value: 1n }, { data: "0x" }, { gas: 65001n }, { maxFeePerGas: 40000000000n }, { maxPriorityFeePerGas: 2n }])("rejects altered signed fields %#", async (change) => {
    await expect(verifyVaultEvmSend(await signed(intent, change), intent)).rejects.toThrow();
  });
  it("rejects a different signer", async () => {
    await expect(verifyVaultEvmSend(await signed(intent), { ...intent, from: common.to })).rejects.toThrow();
  });
  it("rejects malformed signatures", async () => {
    await expect(verifyVaultEvmSend("0x1234", intent)).rejects.toThrow();
  });
  it("rejects token precision loss before requesting data", async () => {
    await expect(prepareVaultEvmSend(pairing, "eth", common.to as `0x${string}`, "1.0000001", USDC_BY_CHAIN.eth)).rejects.toThrow(/6 decimal/);
  });
});