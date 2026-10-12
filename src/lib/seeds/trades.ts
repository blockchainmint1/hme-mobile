/**
 * "Approve every trade" mode. The site proposes each trade as an unsigned
 * PSBT spending from the Trading pocket; the wallet decodes it, shows what
 * leaves and what arrives, and signs ONLY inputs owned by the pocket. Main
 * wallet keys are never loaded here.
 *
 * Endpoints on the linked site's origin (spec: Seeds reply note):
 *   GET  /api/public/hme-link/trades?link_id=…&identity=…  → { trades: TradeProposal[] }
 *   POST /api/public/hme-link/trades/respond { link_id, trade_id, decision, signed_psbt?, identity_address, signature, message }
 */
import { Psbt, payments } from "bitcoinjs-lib";
import { sha256 } from "@noble/hashes/sha2.js";
import { base64 } from "@scure/base";
import { seedFromMnemonic } from "@/lib/txc/wallet";
import { signMessageWithSeed } from "@/lib/txc/message-sign";
import { decodeOmniSend, type OmniSend } from "@/lib/txc/omni-decode";
import { BUILTIN_TXC_TOKENS } from "@/lib/txc/tokens";
import type { MempoolTx } from "@/lib/txc/mempool";
import type { DelegateLinkRecord } from "@/lib/xpub-link/delegate";
import {
  inputScript,
  inputValue,
  pocketScriptMap,
  signPocketInput,
  bytesToHex,
  UTXO_META,
  type UtxoChain,
} from "./pocket";
const PROXY = "/api/nectar/link";

export interface TradeProposal {
  id: string;
  chain: string;
  psbt?: string;
  summary?: string;
  expires_at?: string;
}

export interface TradeView {
  proposal: TradeProposal;
  chain: UtxoChain | null;
  /** Why the wallet refuses to sign this, if it does. */
  refused?: string;
  /** Sats leaving the pocket (our inputs minus outputs back to us). */
  youPay: bigint;
  youGet: bigint;
  fee: bigint | null;
  outputs: { address: string; value: bigint; mine: boolean }[];
  ourInputs: number;
}

export async function fetchTrades(link: DelegateLinkRecord): Promise<TradeProposal[]> {
  const url = `${link.origin}/api/public/hme-link/trades?link_id=${encodeURIComponent(link.linkId)}&identity=${encodeURIComponent(link.identity)}`;
  const res = await fetch(`${PROXY}?url=${encodeURIComponent(url)}`, { headers: { Accept: "application/json" } });
  if (!res.ok) return [];
  const body = (await res.json().catch(() => null)) as { trades?: TradeProposal[] } | null;
  return Array.isArray(body?.trades) ? body!.trades!.slice(0, 20) : [];
}

function chainOf(s: string): UtxoChain | null {
  const c = s.toUpperCase();
  return c === "TXC" || c === "ISK" || c === "BTC" || c === "LTC" ? c : null;
}

export async function inspectTrade(args: {
  link: DelegateLinkRecord;
  proposal: TradeProposal;
  mnemonic: string;
  passphrase?: string;
}): Promise<TradeView> {
  const { link, proposal } = args;
  const empty: TradeView = { proposal, chain: null, youPay: 0n, youGet: 0n, fee: null, outputs: [], ourInputs: 0 };
  const chain = chainOf(proposal.chain);
  if (!chain) return { ...empty, refused: `${proposal.chain} trades can't be approved in the wallet yet.` };
  if (!link.chains.includes(chain)) return { ...empty, chain, refused: "This chain isn't part of the link." };
  if (proposal.expires_at && Date.parse(proposal.expires_at) <= Date.now())
    return { ...empty, chain, refused: "This trade has expired." };
  if (!proposal.psbt) return { ...empty, chain, refused: "Trade has no transaction attached." };
  let psbt: Psbt;
  try {
    psbt = Psbt.fromBase64(proposal.psbt, { network: UTXO_META[chain].net });
  } catch {
    return { ...empty, chain, refused: "Trade transaction is unreadable." };
  }
  const seed = await seedFromMnemonic(args.mnemonic, args.passphrase ?? "");
  const mine = pocketScriptMap(seed, chain, link.account);
  seed.fill(0);

  let ourIn = 0n;
  let allIn = 0n;
  let known = true;
  let ourInputs = 0;
  for (let i = 0; i < psbt.inputCount; i++) {
    const s = inputScript(psbt, i);
    const v = inputValue(psbt, i);
    if (v == null || !s) {
      known = false;
      continue;
    }
    allIn += v;
    if (mine.has(bytesToHex(s))) {
      ourIn += v;
      ourInputs++;
    }
  }
  const m = UTXO_META[chain];
  const outputs = psbt.txOutputs.map((o) => {
    const h = bytesToHex(o.script);
    let address = o.address ?? "";
    if (!address) {
      try {
        address = payments.embed({ output: o.script }).output ? "(data)" : "(script)";
      } catch {
        address = "(script)";
      }
    }
    return { address, value: BigInt(o.value), mine: mine.has(h) };
  });
  const youGet = outputs.filter((o) => o.mine).reduce((s, o) => s + o.value, 0n);
  const allOut = outputs.reduce((s, o) => s + o.value, 0n);
  const view: TradeView = {
    proposal,
    chain,
    youPay: ourIn > youGet ? ourIn - youGet : 0n,
    youGet: youGet > ourIn ? youGet - ourIn : 0n,
    fee: known ? allIn - allOut : null,
    outputs,
    ourInputs,
  };
  void m;
  if (ourInputs === 0) view.refused = "Nothing in this trade is spent from your Trading pocket.";
  return view;
}

async function respond(args: {
  link: DelegateLinkRecord;
  tradeId: string;
  decision: "approve" | "decline";
  signedPsbt?: string;
  mnemonic: string;
  passphrase?: string;
}) {
  const { link, tradeId, decision, signedPsbt, mnemonic, passphrase = "" } = args;
  const digest = signedPsbt ? bytesToHex(sha256(base64.decode(signedPsbt))) : "none";
  const message = [
    `Honest Money - ${decision === "approve" ? "Approve" : "Decline"} trade`,
    "",
    `Domain: ${link.host}`,
    `Link: ${link.linkId}`,
    `Trade: ${tradeId}`,
    `PSBT-SHA256: ${digest}`,
  ].join("\n");
  const signed = await signMessageWithSeed({ mnemonic, passphrase, kind: "bip44", change: 0, index: 0, message });
  const url = `${link.origin}/api/public/hme-link/trades/respond`;
  const res = await fetch(`${PROXY}?url=${encodeURIComponent(url)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      link_id: link.linkId,
      trade_id: tradeId,
      decision,
      ...(signedPsbt ? { signed_psbt: signedPsbt } : {}),
      identity_address: signed.address,
      signature: signed.signature,
      message,
    }),
  });
  if (!res.ok) {
    const b = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    throw new Error((b?.["error"] as string) ?? `Seeds didn't accept that (${res.status})`);
  }
}

/** Sign only the pocket-owned inputs and hand the PSBT back to the site. */
export async function approveTrade(args: {
  link: DelegateLinkRecord;
  view: TradeView;
  mnemonic: string;
  passphrase?: string;
}) {
  const { link, view } = args;
  if (view.refused || !view.chain || !view.proposal.psbt) throw new Error(view.refused ?? "Can't sign this trade.");
  const psbt = Psbt.fromBase64(view.proposal.psbt, { network: UTXO_META[view.chain].net });
  const seed = await seedFromMnemonic(args.mnemonic, args.passphrase ?? "");
  const mine = pocketScriptMap(seed, view.chain, link.account);
  seed.fill(0);
  for (let i = 0; i < psbt.inputCount; i++) {
    const s = inputScript(psbt, i);
    const key = s && mine.get(bytesToHex(s));
    if (key) signPocketInput(psbt, i, key.node);
  }
  await respond({ link, tradeId: view.proposal.id, decision: "approve", signedPsbt: psbt.toBase64(), mnemonic: args.mnemonic, passphrase: args.passphrase });
}

export function declineTrade(args: { link: DelegateLinkRecord; tradeId: string; mnemonic: string; passphrase?: string }) {
  return respond({ ...args, decision: "decline" });
}
