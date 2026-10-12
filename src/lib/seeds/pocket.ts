/**
 * The "Trading pocket": a separate hardened account (1106', then 1107', …
 * after each retirement) on every chain Seeds trades. Main-wallet funds
 * (account 0') are never derived, shown or shared from here.
 *
 * - Balances: receive + change addresses 0..POCKET_SCAN-1 on each UTXO chain,
 *   plus the single EVM address (native coin only).
 * - Sweep: moves everything back to the main wallet's first receive address.
 * - Retire: bumps the active account so an old shared key controls nothing.
 */
import * as ecc from "@bitcoinerlab/secp256k1";
import { BIP32Factory, type BIP32Interface } from "bip32";
import { payments, Psbt, Transaction, type Network } from "bitcoinjs-lib";
import { createWalletClient, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { TXC_NETWORK } from "@/lib/txc/network";
import { ISK_NETWORK } from "@/lib/isk/network";
import { BTC_NETWORK } from "@/lib/btc/network";
import { LTC_NETWORK } from "@/lib/ltc/network";
import { EVM_CHAINS, evmClient, type EvmChainId } from "@/lib/chains/evm";
import * as txcApi from "@/lib/txc/mempool";
import * as iskApi from "@/lib/isk/mempool";
import * as btcApi from "@/lib/btc/mempool";
import * as ltcApi from "@/lib/ltc/mempool";
import { scopedKey } from "@/lib/profiles";

const bip32 = BIP32Factory(ecc);

export const POCKET_BASE_ACCOUNT = 1106;
/** Hard ceiling: a site can never push us onto an arbitrary account. */
export const POCKET_MAX_ACCOUNT = POCKET_BASE_ACCOUNT + 999;
export const POCKET_SCAN = 10;

export type UtxoChain = "TXC" | "ISK" | "BTC" | "LTC";
export type PocketChain = UtxoChain | "EVM";
export const POCKET_CHAINS: PocketChain[] = ["TXC", "ISK", "BTC", "LTC", "EVM"];

interface UtxoMeta {
  purpose: 44 | 84;
  coin: number;
  net: Network;
  api: typeof txcApi | typeof iskApi | typeof btcApi | typeof ltcApi;
  minFeeRate: number;
  dust: number;
  ticker: string;
}

export const UTXO_META: Record<UtxoChain, UtxoMeta> = {
  TXC: { purpose: 44, coin: 696969, net: TXC_NETWORK, api: txcApi, minFeeRate: 10, dust: 10_000, ticker: "TXC" },
  ISK: { purpose: 44, coin: 969696, net: ISK_NETWORK, api: iskApi, minFeeRate: 10, dust: 10_000, ticker: "ISK" },
  BTC: { purpose: 84, coin: 0, net: BTC_NETWORK, api: btcApi, minFeeRate: 1, dust: 546, ticker: "BTC" },
  LTC: { purpose: 44, coin: 2, net: LTC_NETWORK, api: ltcApi, minFeeRate: 1, dust: 5_460, ticker: "LTC" },
};

export const EVM_COIN = 60;

export function accountPath(chain: PocketChain, account: number): string {
  if (chain === "EVM") return `m/44'/${EVM_COIN}'/${account}'`;
  const m = UTXO_META[chain];
  return `m/${m.purpose}'/${m.coin}'/${account}'`;
}

export function isPocketAccount(account: number): boolean {
  return Number.isInteger(account) && account >= POCKET_BASE_ACCOUNT && account <= POCKET_MAX_ACCOUNT;
}

/* ------------------------- active account store ------------------------- */

const ACCOUNT_KEY = "hme:trading-pocket-account";

export function activePocketAccount(): number {
  if (typeof window === "undefined") return POCKET_BASE_ACCOUNT;
  const n = Number(window.localStorage.getItem(scopedKey(ACCOUNT_KEY)));
  return isPocketAccount(n) ? n : POCKET_BASE_ACCOUNT;
}

/** Move to a fresh account so any key shared for the old one controls nothing new. */
export function retirePocketAccount(): number {
  const next = Math.min(activePocketAccount() + 1, POCKET_MAX_ACCOUNT);
  window.localStorage.setItem(scopedKey(ACCOUNT_KEY), String(next));
  return next;
}

/* ------------------------------ derivation ------------------------------ */

export function chainRoot(seed: Uint8Array, chain: PocketChain): BIP32Interface {
  return bip32.fromSeed(seed, chain === "EVM" ? undefined : UTXO_META[chain].net);
}

export function addressFor(chain: UtxoChain, pubkey: Uint8Array): string {
  const m = UTXO_META[chain];
  const p =
    m.purpose === 84
      ? payments.p2wpkh({ pubkey, network: m.net })
      : payments.p2pkh({ pubkey, network: m.net });
  if (!p.address) throw new Error("Could not derive address");
  return p.address;
}

export interface PocketAddress {
  address: string;
  path: string;
  node: BIP32Interface;
}

export function pocketAddresses(seed: Uint8Array, chain: UtxoChain, account: number): PocketAddress[] {
  const acct = chainRoot(seed, chain).derivePath(accountPath(chain, account));
  const out: PocketAddress[] = [];
  for (const change of [0, 1]) {
    for (let i = 0; i < POCKET_SCAN; i++) {
      const node = acct.derive(change).derive(i);
      out.push({ address: addressFor(chain, node.publicKey), path: `${accountPath(chain, account)}/${change}/${i}`, node });
    }
  }
  return out;
}

export function pocketReceiveAddress(seed: Uint8Array, chain: PocketChain, account: number): string {
  if (chain === "EVM") return evmPocketAccount(seed, account).address;
  return pocketAddresses(seed, chain, account)[0]!.address;
}

/** Main wallet's first receive address on the same script type (sweep target). */
export function mainReceiveAddress(seed: Uint8Array, chain: PocketChain): string {
  if (chain === "EVM") {
    const node = chainRoot(seed, "EVM").derivePath("m/44'/60'/0'/0/0");
    return privateKeyToAccount(toHex(node.privateKey!)).address;
  }
  const node = chainRoot(seed, chain).derivePath(`${accountPath(chain, 0)}/0/0`);
  return addressFor(chain, node.publicKey);
}

function toHex(b: Uint8Array): Hex {
  return `0x${Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("")}`;
}

export function evmPocketAccount(seed: Uint8Array, account: number) {
  const node = chainRoot(seed, "EVM").derivePath(`${accountPath("EVM", account)}/0/0`);
  return privateKeyToAccount(toHex(node.privateKey!));
}

/* ------------------------------- balances ------------------------------- */

export interface PocketBalance {
  chain: PocketChain;
  /** sats for UTXO chains, wei per EVM network otherwise */
  amount: bigint;
  evm?: Partial<Record<EvmChainId, bigint>>;
}

export async function utxoPocketBalance(seed: Uint8Array, chain: UtxoChain, account: number): Promise<bigint> {
  const api = UTXO_META[chain].api;
  const stats = await Promise.all(
    pocketAddresses(seed, chain, account).map((a) => api.getAddressStats(a.address).catch(() => null)),
  );
  let total = 0n;
  for (const s of stats) {
    if (!s) continue;
    total += BigInt(
      s.chain_stats.funded_txo_sum - s.chain_stats.spent_txo_sum +
        s.mempool_stats.funded_txo_sum - s.mempool_stats.spent_txo_sum,
    );
  }
  return total;
}

const EVM_SWEEP_CHAINS: EvmChainId[] = ["eth", "base", "bsc", "zcu"];

export async function evmPocketBalances(seed: Uint8Array, account: number): Promise<Partial<Record<EvmChainId, bigint>>> {
  const address = evmPocketAccount(seed, account).address;
  const out: Partial<Record<EvmChainId, bigint>> = {};
  await Promise.all(
    EVM_SWEEP_CHAINS.map(async (id) => {
      try {
        out[id] = await evmClient(id).getBalance({ address });
      } catch {
        /* chain unreachable — leave blank */
      }
    }),
  );
  return out;
}

/* -------------------------------- signing ------------------------------- */

/** Output script of the UTXO a PSBT input spends. */
export function inputScript(psbt: Psbt, i: number): Uint8Array | null {
  const d = psbt.data.inputs[i]!;
  if (d.witnessUtxo) return d.witnessUtxo.script;
  if (d.nonWitnessUtxo) {
    const tx = Transaction.fromBuffer(d.nonWitnessUtxo as never);
    return tx.outs[psbt.txInputs[i]!.index]?.script ?? null;
  }
  return null;
}

export function inputValue(psbt: Psbt, i: number): bigint | null {
  const d = psbt.data.inputs[i]!;
  if (d.witnessUtxo) return BigInt(d.witnessUtxo.value);
  if (d.nonWitnessUtxo) {
    const tx = Transaction.fromBuffer(d.nonWitnessUtxo as never);
    const v = tx.outs[psbt.txInputs[i]!.index]?.value;
    return v == null ? null : BigInt(v);
  }
  return null;
}

export function scriptHex(chain: UtxoChain, address: string): string {
  const m = UTXO_META[chain];
  const p = m.purpose === 84 ? payments.p2wpkh({ address, network: m.net }) : payments.p2pkh({ address, network: m.net });
  return Array.from(p.output!, (x) => x.toString(16).padStart(2, "0")).join("");
}

function hex(b: Uint8Array): string {
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

export function signPocketInput(psbt: Psbt, i: number, node: BIP32Interface) {
  psbt.signInput(i, { publicKey: node.publicKey, sign: (h) => ecc.sign(h, node.privateKey!) });
}

/** Map of output-script hex → derived key, for every pocket address. */
export function pocketScriptMap(seed: Uint8Array, chain: UtxoChain, account: number): Map<string, PocketAddress> {
  const map = new Map<string, PocketAddress>();
  for (const a of pocketAddresses(seed, chain, account)) map.set(scriptHex(chain, a.address), a);
  return map;
}

export { hex as bytesToHex };

/* -------------------------------- sweeping ------------------------------ */

export interface SweepResult {
  chain: string;
  txid?: string;
  skipped?: string;
}

async function sweepUtxo(seed: Uint8Array, chain: UtxoChain, account: number): Promise<SweepResult> {
  const m = UTXO_META[chain];
  const to = mainReceiveAddress(seed, chain);
  const addrs = pocketAddresses(seed, chain, account);
  const lists = await Promise.all(addrs.map((a) => m.api.getAddressUtxos(a.address).catch(() => [])));
  const inputs: { a: PocketAddress; txid: string; vout: number; value: number }[] = [];
  lists.forEach((list, idx) => list.forEach((u) => inputs.push({ a: addrs[idx]!, ...u })));
  if (inputs.length === 0) return { chain, skipped: "empty" };

  const psbt = new Psbt({ network: m.net, maximumFeeRate: 10_000_000 });
  for (const u of inputs) {
    if (m.purpose === 84) {
      psbt.addInput({
        hash: u.txid,
        index: u.vout,
        witnessUtxo: { script: payments.p2wpkh({ pubkey: u.a.node.publicKey, network: m.net }).output!, value: BigInt(u.value) },
      });
    } else {
      const rawHex = await m.api.getTxHex(u.txid);
      const raw = new Uint8Array(rawHex.match(/../g)!.map((h) => parseInt(h, 16)));
      psbt.addInput({ hash: u.txid, index: u.vout, nonWitnessUtxo: raw });
    }
  }
  const fees = await m.api.getFeeEstimates().catch(() => null);
  const rate = Math.max(m.minFeeRate, fees?.halfHourFee ?? m.minFeeRate);
  const vbytes = 11 + inputs.length * (m.purpose === 84 ? 68 : 148) + 34;
  const total = inputs.reduce((s, u) => s + u.value, 0);
  const send = total - vbytes * rate;
  if (send < m.dust) return { chain, skipped: "too small to cover the fee" };
  psbt.addOutput({ address: to, value: BigInt(send) });
  inputs.forEach((u, i) => signPocketInput(psbt, i, u.a.node));
  psbt.finalizeAllInputs();
  const txid = await m.api.broadcastTx(psbt.extractTransaction().toHex());
  return { chain, txid };
}

async function sweepEvm(seed: Uint8Array, account: number): Promise<SweepResult[]> {
  const acct = evmPocketAccount(seed, account);
  const to = mainReceiveAddress(seed, "EVM") as Hex;
  const results: SweepResult[] = [];
  for (const id of EVM_SWEEP_CHAINS) {
    try {
      const client = evmClient(id);
      const bal = await client.getBalance({ address: acct.address });
      if (bal === 0n) continue;
      const gasPrice = ((await client.getGasPrice()) * 12n) / 10n;
      const value = bal - gasPrice * 21_000n;
      if (value <= 0n) {
        results.push({ chain: EVM_CHAINS[id].name, skipped: "too small to cover the fee" });
        continue;
      }
      const wallet = createWalletClient({ account: acct, chain: EVM_CHAINS[id].viemChain, transport: http(`/api/evm/${id}`) });
      const txid = await wallet.sendTransaction({ to, value, gas: 21_000n, gasPrice, chain: EVM_CHAINS[id].viemChain });
      results.push({ chain: EVM_CHAINS[id].name, txid });
    } catch (e) {
      results.push({ chain: EVM_CHAINS[id].name, skipped: (e as Error).message.slice(0, 120) });
    }
  }
  return results;
}

/** Move every coin in the pocket back to the main wallet. Tokens (TSD, USDC) are not moved. */
export async function sweepPocket(seed: Uint8Array, account: number, chains: PocketChain[] = POCKET_CHAINS): Promise<SweepResult[]> {
  const out: SweepResult[] = [];
  for (const c of chains) {
    if (c === "EVM") out.push(...(await sweepEvm(seed, account)));
    else {
      try {
        out.push(await sweepUtxo(seed, c, account));
      } catch (e) {
        out.push({ chain: c, skipped: (e as Error).message.slice(0, 120) });
      }
    }
  }
  return out;
}
