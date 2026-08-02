/**
 * Per-coin wiring for the shared THORChain swap screen. Keeps UtxoSwap.tsx
 * free of chain-specific imports and sizing rules.
 */
import type { BIP32Interface } from "bip32";
import { scanLtcAccount, type AccountSnapshot as LtcSnapshot } from "@/lib/ltc/scan";
import { scanDogeAccount, type AccountSnapshot as DogeSnapshot } from "@/lib/doge/scan";
import { buildAndSignTx as buildLtc } from "@/lib/ltc/wallet";
import { buildAndSignTx as buildDoge } from "@/lib/doge/wallet";
import * as ltcNode from "@/lib/ltc/mempool";
import * as dogeNode from "@/lib/doge/mempool";
import { formatLtc, ltcToSats, satsToLtc } from "@/lib/ltc/units";
import { formatDoge, dogeToSats, satsToDoge } from "@/lib/doge/units";
import { LTC_DEFAULT_KIND } from "@/lib/ltc/network";
import { DOGE_DEFAULT_KIND } from "@/lib/doge/network";
import type { UtxoSwapCoin } from "@/lib/thorchain/assets";

type Snapshot = LtcSnapshot | DogeSnapshot;

export interface BuildArgs {
  root: BIP32Interface;
  inputs: Snapshot["utxos"];
  outputs: { address: string; valueSats: number }[];
  changeAddress: string;
  changeIndex: number;
  feeSats: number;
  memo: string;
}

export interface UtxoSwapConfig {
  ticker: string;
  kind: string;
  step: string;
  accountQueryKey: string;
  txsQueryKey: string;
  fallbackFeeRate: number;
  scan: (root: BIP32Interface) => Promise<Snapshot>;
  getFeeEstimates: () => Promise<{ fastestFee: number; halfHourFee: number; hourFee: number; minimumFee: number }>;
  broadcast: (hex: string) => Promise<string>;
  explorerTxUrl: (txid: string) => string;
  toSats: (v: string) => number;
  fromSats: (sats: number) => string;
  format: (sats: number) => string;
  /** vsize estimate; `memo` adds an OP_RETURN output. */
  estimateVsize: (nIn: number, nOut: number, memo: boolean) => number;
  buildAndSign: (args: BuildArgs) => { hex: string; txid: string; feeSats: number; changeSats: number };
}

// LTC swaps spend native SegWit (bip84) inputs by default.
const LTC_V = { input: 68, output: 31, overhead: 11 };
// DOGE is legacy-only P2PKH.
const DOGE_V = { input: 148, output: 34, overhead: 10 };
// An OP_RETURN with a THORChain memo: 8 bytes of framing + up to 80 bytes.
const OP_RETURN_VBYTES = 90;

export const UTXO_SWAP_COINS: Record<UtxoSwapCoin, UtxoSwapConfig> = {
  ltc: {
    ticker: "LTC",
    kind: LTC_DEFAULT_KIND,
    step: "0.00000001",
    accountQueryKey: "ltc-account",
    txsQueryKey: "ltc-txs",
    fallbackFeeRate: 100,
    scan: (root) => scanLtcAccount(root, LTC_DEFAULT_KIND),
    getFeeEstimates: ltcNode.getFeeEstimates,
    broadcast: ltcNode.broadcastTx,
    explorerTxUrl: ltcNode.explorerTxUrl,
    toSats: ltcToSats,
    fromSats: (sats) => String(satsToLtc(sats)),
    format: (sats) => formatLtc(sats),
    estimateVsize: (nIn, nOut, memo) =>
      LTC_V.overhead + LTC_V.input * nIn + LTC_V.output * nOut + (memo ? OP_RETURN_VBYTES : 0),
    buildAndSign: (args) => buildSwapTx("ltc", args),
  },
  doge: {
    ticker: "DOGE",
    kind: DOGE_DEFAULT_KIND,
    step: "0.0001",
    accountQueryKey: "doge-account",
    txsQueryKey: "doge-txs",
    fallbackFeeRate: 1000,
    scan: (root) => scanDogeAccount(root, DOGE_DEFAULT_KIND),
    getFeeEstimates: dogeNode.getFeeEstimates,
    broadcast: dogeNode.broadcastTx,
    explorerTxUrl: dogeNode.explorerTxUrl,
    toSats: dogeToSats,
    fromSats: (sats) => String(satsToDoge(sats)),
    format: (sats) => formatDoge(sats),
    estimateVsize: (nIn, nOut, memo) =>
      DOGE_V.overhead + DOGE_V.input * nIn + DOGE_V.output * nOut + (memo ? OP_RETURN_VBYTES : 0),
    buildAndSign: (args) => buildSwapTx("doge", args),
  },
};

/** Sign the inbound swap transaction for either chain. */
export function buildSwapTx(coin: UtxoSwapCoin, args: BuildArgs) {
  if (coin === "ltc") {
    return buildLtc({
      root: args.root,
      kind: LTC_DEFAULT_KIND,
      inputs: args.inputs,
      outputs: args.outputs,
      changeAddress: args.changeAddress,
      changeIndex: args.changeIndex,
      feeSats: args.feeSats,
      memo: args.memo,
    });
  }
  return buildDoge({
    root: args.root,
    kind: DOGE_DEFAULT_KIND,
    inputs: args.inputs,
    outputs: args.outputs,
    changeAddress: args.changeAddress,
    changeIndex: args.changeIndex,
    feeSats: args.feeSats,
    memo: args.memo,
  });
}
