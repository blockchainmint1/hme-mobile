/**
 * Removing a wallet must never take another wallet with it.
 *
 * The wallet drop-down offers two destructive actions: "Remove" for a wallet
 * you're not using, and "Delete … and all data" for the one you're using. Both
 * run against profile-scoped storage, so every wallet you didn't pick has to
 * come out byte-identical — its encrypted envelope, its side stores, and its
 * place in the list.
 */
import { beforeEach, describe, expect, it } from "vitest";

function installStorage() {
  const map = new Map<string, string>();
  const ls = {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => void map.set(k, String(v)),
    removeItem: (k: string) => void map.delete(k),
    key: (i: number) => [...map.keys()][i] ?? null,
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
  };
  (globalThis as Record<string, unknown>).localStorage = ls;
  (globalThis as Record<string, unknown>).window = {
    localStorage: ls,
    dispatchEvent: () => true,
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  return map;
}

const PROFILE_LIST_KEY = "hme.profiles.v1";
const ACTIVE_KEY = "hme.profile.active.v1";
const DEFAULT_KEY = "txc.wallet.v1";
const SECOND_KEY = "p:pr_a:txc.wallet.v1";

const envelope = (label: string) =>
  JSON.stringify({
    label,
    createdAt: 0,
    mode: "seed",
    salt: "c2FsdA",
    iv: "aXZpeA",
    ciphertext: "Y3Q",
    iterations: 600000,
  });

function twoWallets(activeId: string) {
  map.set(PROFILE_LIST_KEY, JSON.stringify([{ id: "default", createdAt: 0 }, { id: "pr_a", createdAt: 1 }]));
  map.set(DEFAULT_KEY, envelope("Main wallet"));
  map.set(SECOND_KEY, envelope("Wallet 2"));
  map.set("p:pr_a:hme.labels.v1", '{"addr":1}');
  map.set(ACTIVE_KEY, activeId);
}

let map: Map<string, string>;

beforeEach(() => {
  map = installStorage();
});

describe("wallet removal", () => {
  it("removes only the wallet you picked, leaving the other byte-identical", async () => {
    twoWallets("default");

    const { deleteProfileWallet, listWalletProfiles } = await import("@/lib/txc/storage");
    deleteProfileWallet("pr_a");

    expect(localStorage.getItem(SECOND_KEY)).toBeNull();
    expect(localStorage.getItem("p:pr_a:hme.labels.v1")).toBeNull();
    // The wallet you kept is untouched, envelope and active pointer alike.
    expect(localStorage.getItem(DEFAULT_KEY)).toBe(envelope("Main wallet"));
    expect(localStorage.getItem(ACTIVE_KEY)).toBe("default");
    const left = listWalletProfiles();
    expect(left.map((p) => p.label)).toEqual(["Main wallet"]);
    expect(left[0].isActive).toBe(true);
  });

  it("keeps the surviving wallet when the one you were using is deleted", async () => {
    twoWallets("pr_a");

    const { deleteProfileWallet, listWalletProfiles } = await import("@/lib/txc/storage");
    deleteProfileWallet("pr_a");

    expect(localStorage.getItem(SECOND_KEY)).toBeNull();
    expect(localStorage.getItem(DEFAULT_KEY)).toBe(envelope("Main wallet"));
    const left = listWalletProfiles();
    expect(left.map((p) => p.label)).toEqual(["Main wallet"]);
    expect(left[0].isActive).toBe(true);
  });
});
