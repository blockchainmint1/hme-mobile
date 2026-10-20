import { afterEach, describe, expect, it, vi } from "vitest";
import { saveWallet, verifyWalletPassword } from "@/lib/txc/storage";
describe("security reauthentication preserves wallets", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("does not rewrite any wallet envelope, profile list or active wallet", async () => {
    const data = new Map<string, string>();
    const storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => data.set(key, value), removeItem: (key: string) => data.delete(key) };
    vi.stubGlobal("localStorage", storage);
    vi.stubGlobal("window", { localStorage: storage, dispatchEvent: () => true });
    vi.stubGlobal("CustomEvent", class { constructor(public type: string) {} });
    await saveWallet({ mnemonic: "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about", passphrase: "", kind: "bip44", label: "Main", mode: "seed" }, "Safety words 8294!");
    data.set("p:other:txc.wallet.v1", JSON.stringify({ ciphertext: "untouched" }));
    const before = [...data.entries()];
    expect(await verifyWalletPassword("Safety words 8294!", "default")).toBe(true);
    expect(await verifyWalletPassword("wrong password", "default")).toBe(false);
    expect([...data.entries()]).toEqual(before);
  });
});