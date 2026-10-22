import { describe, expect, it } from "vitest";
import { fetchMergedAddressTxs } from "./address-txs";

interface Tx {
  txid: string;
}

describe("fetchMergedAddressTxs", () => {
  it("throws when every address fetch fails, so cached history is kept", async () => {
    await expect(
      fetchMergedAddressTxs<Tx>(["a", "b"], () => Promise.reject(new Error("502"))),
    ).rejects.toThrow("history service unavailable");
  });

  it("returns the addresses that answered when the outage is partial", async () => {
    const out = await fetchMergedAddressTxs<Tx>(["a", "b"], (addr) =>
      addr === "a" ? Promise.resolve([{ txid: "t1" }]) : Promise.reject(new Error("502")),
    );
    expect(out).toEqual([{ txid: "t1" }]);
  });

  it("dedupes transactions shared between addresses", async () => {
    const out = await fetchMergedAddressTxs<Tx>(["a", "b"], () =>
      Promise.resolve([{ txid: "t1" }, { txid: "t2" }]),
    );
    expect(out.map((t) => t.txid)).toEqual(["t1", "t2"]);
  });

  it("returns an empty list for a wallet with no addresses", async () => {
    await expect(fetchMergedAddressTxs<Tx>([], () => Promise.resolve([]))).resolves.toEqual([]);
  });
});
