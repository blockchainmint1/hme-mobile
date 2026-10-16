/**
 * Zero Chill (ZCU) watch-only adapter.
 *
 * ZCU is account-based (0x addresses), but the watch-only screens speak the
 * Esplora shape used by the UTXO chains. We translate: balance comes from the
 * ZCU node, history from our ZCU indexer, and amounts are expressed in
 * 1e-8 "sats" so the shared formatters work (18-decimal wei / 1e10).
 */
import { evmClient } from "@/lib/chains/evm";
import { getEvmHistory } from "@/lib/chains/history.functions";
import type { MempoolAddressStats, MempoolTx } from "@/lib/txc/mempool";

const toSats = (zcu: string | number) => Math.round(Number(zcu) * 1e8) || 0;

export async function getAddressStats(address: string): Promise<MempoolAddressStats> {
  const wei = await evmClient("zcu").getBalance({ address: address as `0x${string}` });
  const sats = Number(wei / 10_000_000_000n);
  const empty = { funded_txo_count: 0, funded_txo_sum: 0, spent_txo_count: 0, spent_txo_sum: 0, tx_count: 0 };
  return {
    address,
    chain_stats: { ...empty, funded_txo_sum: sats },
    mempool_stats: { ...empty },
  } as unknown as MempoolAddressStats;
}

export async function getAddressTxs(address: string): Promise<MempoolTx[]> {
  const res = await getEvmHistory({ data: { chain: "zcu", address } });
  if (res.unavailable) throw new Error("ZCU indexer unavailable");
  return res.transfers
    .filter((t) => !t.spam && !t.contractAddress)
    .map((t) => {
      const v = toSats(t.value);
      const ts = t.timestamp ? Math.floor(new Date(t.timestamp).getTime() / 1000) : undefined;
      return {
        txid: t.hash,
        vin: [{ txid: t.hash, vout: 0, prevout: { scriptpubkey: "", scriptpubkey_address: t.outgoing ? address : t.from, value: v } }],
        vout: [{ scriptpubkey: "", scriptpubkey_address: t.outgoing ? (t.to ?? "") : address, value: v }],
        status: { confirmed: t.blockNum > 0, block_height: t.blockNum, block_time: ts },
      } as unknown as MempoolTx;
    });
}
