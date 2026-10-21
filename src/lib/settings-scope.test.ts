/**
 * Guards the app-wide settings migration: chain and token preferences used to
 * be namespaced per wallet profile. The migration must ADOPT a profile's
 * scoped values into the shared key — copy-only, never deleting the original,
 * and never touching the wallet list or seed envelopes.
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

function useSecondProfile(map: Map<string, string>) {
  map.set(
    PROFILE_LIST_KEY,
    JSON.stringify([
      { id: "default", createdAt: 0 },
      { id: "pr_abc", createdAt: 1 },
    ]),
  );
  map.set(ACTIVE_KEY, "pr_abc");
}

describe("app-wide settings migration", () => {
  let map: Map<string, string>;
  beforeEach(() => {
    map = installStorage();
  });

  it("adopts a second wallet's chain prefs into the shared key, copy-only", async () => {
    useSecondProfile(map);
    const scoped = "p:pr_abc:hme.chains.enabled.v1";
    map.set(scoped, JSON.stringify({ txc: true, btc: true, doge: true }));

    const { getChainPrefs } = await import("@/lib/chain-prefs");
    const prefs = getChainPrefs();
    expect(prefs.btc).toBe(true);
    expect(prefs.doge).toBe(true);
    // Copied into the shared key…
    expect(map.get("hme.chains.enabled.v1")).toBe(map.get(scoped));
    // …and the original scoped copy is left untouched.
    expect(map.has(scoped)).toBe(true);
  });

  it("default wallet settings are already the shared ones — nothing moves", async () => {
    map.set("hme.chains.enabled.v1", JSON.stringify({ txc: true, ltc: true }));
    const { getChainPrefs } = await import("@/lib/chain-prefs");
    expect(getChainPrefs().ltc).toBe(true);
  });

  it("adopts a second wallet's custom EVM tokens, copy-only", async () => {
    useSecondProfile(map);
    const scoped = "p:pr_abc:hme:tokens:custom:v1";
    const custom = {
      eth: [{ symbol: "MYTOK", address: "0x" + "ab".repeat(20), decimals: 18 }],
    };
    map.set(scoped, JSON.stringify(custom));

    const { getKnownTokens } = await import("@/lib/token-prefs");
    const symbols = getKnownTokens("eth").map((t) => t.symbol);
    expect(symbols).toContain("MYTOK");
    expect(map.has(scoped)).toBe(true);
  });

  it("never touches the wallet list or envelopes during migration", async () => {
    useSecondProfile(map);
    map.set("p:pr_abc:hme.chains.enabled.v1", JSON.stringify({ txc: true, btc: true }));
    const before = map.get(PROFILE_LIST_KEY);

    const { getChainPrefs } = await import("@/lib/chain-prefs");
    getChainPrefs();

    expect(map.get(PROFILE_LIST_KEY)).toBe(before);
    expect(map.get(ACTIVE_KEY)).toBe("pr_abc");
  });

  it("token spam choice follows the device without rewriting either wallet", async () => {
    useSecondProfile(map);
    map.set("p:pr_abc:hme:features", JSON.stringify({ hideSpamTokens: false, sharedWallets: true }));
    map.set("p:pr_abc:txc.wallet.v1", "encrypted-second-wallet");
    map.set("txc.wallet.v1", "encrypted-main-wallet");
    const before = new Map(map);
    const { isFeatureEnabled, setFeatureEnabled } = await import("./feature-prefs");
    expect(isFeatureEnabled("hideSpamTokens")).toBe(false);
    setFeatureEnabled("hideSpamTokens", true);
    map.set(ACTIVE_KEY, "default");
    expect(isFeatureEnabled("hideSpamTokens")).toBe(true);
    expect(map.get("p:pr_abc:hme:features")).toBe(before.get("p:pr_abc:hme:features"));
    expect(map.get(PROFILE_LIST_KEY)).toBe(before.get(PROFILE_LIST_KEY));
    expect(map.get("p:pr_abc:txc.wallet.v1")).toBe("encrypted-second-wallet");
    expect(map.get("txc.wallet.v1")).toBe("encrypted-main-wallet");
  });
});
