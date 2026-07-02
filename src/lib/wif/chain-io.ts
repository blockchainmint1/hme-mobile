/**
 * Thin adapter that routes WIF wallet queries to the correct chain's
 * Esplora-compatible mempool client.
 */
import type { WifChain } from "./decode";
import * as txc from "@/lib/txc/mempool";
import * as isk from "@/lib/isk/mempool";

export function api(chain: WifChain) {
  return chain === "txc" ? txc : isk;
}

export function explorerTxUrl(chain: WifChain, txid: string): string {
  return api(chain).explorerTxUrl(txid);
}

export function explorerAddressUrl(chain: WifChain, address: string): string {
  return api(chain).explorerAddressUrl(address);
}
