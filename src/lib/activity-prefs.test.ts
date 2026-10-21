import { beforeEach, expect, it } from "vitest";
import { ACTIVITY_PREF_KEY, getHideSuspiciousActivity, setHideSuspiciousActivity } from "./activity-prefs";

let storage: Map<string, string>;
beforeEach(() => {
  storage = new Map();
  Object.assign(globalThis, { window: {
    localStorage: { getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value) },
    dispatchEvent: () => true,
  } });
});

it("enables suspicious activity filtering by default", () => {
  expect(getHideSuspiciousActivity()).toBe(true);
});
it("shares the choice across profiles", () => {
  storage.set("hme.profile.active.v1", "first");
  setHideSuspiciousActivity(false);
  storage.set("hme.profile.active.v1", "second");
  expect(getHideSuspiciousActivity()).toBe(false);
  expect(storage.get(ACTIVITY_PREF_KEY)).toBe("false");
});
it("writes only its preference and preserves wallet records and legacy token choices", () => {
  const records = {
    "hme.profiles.v1": '[{"id":"default"},{"id":"second"}]',
    "hme.profile.active.v1": "second",
    "hme.wallet.v1": "encrypted-default-wallet",
    "p:second:hme.wallet.v1": "encrypted-second-wallet",
    "p:second:hme:features": '{"hideSpamTokens":false}',
  };
  for (const [key, value] of Object.entries(records)) storage.set(key, value);
  setHideSuspiciousActivity(false);
  setHideSuspiciousActivity(true);
  for (const [key, value] of Object.entries(records)) expect(storage.get(key)).toBe(value);
  expect(storage.size).toBe(Object.keys(records).length + 1);
});