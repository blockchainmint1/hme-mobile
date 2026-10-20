/**
 * Tap-card service (server side). We are the card service: the backend holds
 * ONLY the card pocket's key (its own branch, m/44'/696969'/1201'+), encrypted
 * with CARD_KEY_ENC. It pays NectarPay invoices in TSD, nothing else, and only
 * after the limit / PIN / daily-cap / Telegram checks pass.
 */
import * as ecc from "@bitcoinerlab/secp256k1";
import { createHash, createHmac, timingSafeEqual } from "crypto";
import { payments, Psbt } from "bitcoinjs-lib";
import { TXC_NETWORK, MEMPOOL_API } from "@/lib/txc/network";
import { buildSimpleSendPayload } from "@/lib/txc/tokens";
import { verifyMessage } from "@/lib/txc/message-sign";
import { TSD_PROPERTY_ID } from "@/lib/cashout/tsd";
import { validateCardAmount } from "./payment-policy";

export const CARD_MAX_WRONG_PINS = 5;
export const CARD_APPROVAL_TTL_MS = 15 * 60 * 1000;
const DUST = 10_000;
const MIN_FEE_RATE = 10;

/* ------------------------------- secrets -------------------------------- */

function encSecret(): string {
  const s = process.env["CARD_KEY_ENC"];
  if (!s) throw new Error("card service not configured");
  return s;
}

export async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

export function normalizeUid(uid: string): string {
  return uid.replace(/[^0-9a-z]/gi, "").toUpperCase();
}

export function uidHash(uid: string): string {
  return createHmac("sha256", encSecret()).update(`card-uid:${normalizeUid(uid)}`).digest("hex");
}

async function aesKey(): Promise<CryptoKey> {
  const raw = createHash("sha256").update(`card-key:${encSecret()}`).digest();
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function encryptKey(hex: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await aesKey(), Buffer.from(hex, "hex")));
  return Buffer.concat([Buffer.from(iv), Buffer.from(ct)]).toString("base64");
}

async function decryptKey(b64: string): Promise<Uint8Array> {
  const buf = Buffer.from(b64, "base64");
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: buf.subarray(0, 12) }, await aesKey(), buf.subarray(12));
  return new Uint8Array(pt);
}

export async function hashPin(pin: string, saltB64?: string): Promise<{ hash: string; salt: string }> {
  const salt = saltB64 ? Buffer.from(saltB64, "base64") : Buffer.from(crypto.getRandomValues(new Uint8Array(16)));
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(pin), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: 100_000 }, base, 256);
  return { hash: Buffer.from(bits).toString("hex"), salt: salt.toString("base64") };
}

export function safeEq(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Partner (NectarPay) request signature: hex HMAC-SHA256(HME_ECOSYSTEM, `${ts}.${body}`). */
export function verifyPartner(ts: string, sig: string, body: string): boolean {
  const secret = process.env["HME_ECOSYSTEM"];
  if (!secret || !/^\d{10,13}$/.test(ts) || !/^[0-9a-f]{64}$/i.test(sig)) return false;
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false;
  const expected = createHmac("sha256", secret).update(`${ts}.${body}`).digest("hex");
  return safeEq(sig.toLowerCase(), expected);
}

/* --------------------------- owner envelopes ---------------------------- */

export interface OwnerEnvelope {
  owner: string;
  ts: number;
  action: string;
  body?: unknown;
  sig: string;
}

export function envelopeMessage(action: string, ts: number, body: unknown): string {
  return `hm-card|${action}|${ts}|${JSON.stringify(body)}`;
}

export function verifyOwner(env: OwnerEnvelope, action: string): string {
  if (env.action !== action) throw new Error("Wrong action");
  if (Math.abs(Date.now() / 1000 - env.ts) > 300) throw new Error("Request expired — check your phone's clock");
  if (!verifyMessage(env.owner, envelopeMessage(action, env.ts, env.body), env.sig)) throw new Error("Bad wallet signature");
  return env.owner;
}

/* ------------------------------ chain I/O ------------------------------- */

export function p2pkhFromPriv(priv: Uint8Array): string {
  const pubkey = ecc.pointFromScalar(priv, true);
  if (!pubkey) throw new Error("bad key");
  const address = payments.p2pkh({ pubkey, network: TXC_NETWORK }).address;
  if (!address) throw new Error("bad address");
  return address;
}

interface Utxo {
  txid: string;
  vout: number;
  value: number;
}

async function utxos(address: string): Promise<Utxo[]> {
  const r = await fetch(`${MEMPOOL_API}/address/${address}/utxo`);
  if (!r.ok) throw new Error(`utxo lookup ${r.status}`);
  return (await r.json()) as Utxo[];
}

async function txHex(txid: string): Promise<string> {
  const r = await fetch(`${MEMPOOL_API}/tx/${txid}/hex`);
  if (!r.ok) throw new Error(`tx lookup ${r.status}`);
  return (await r.text()).trim();
}

async function feeRate(): Promise<number> {
  try {
    const r = await fetch(`${MEMPOOL_API}/v1/fees/recommended`);
    const j = (await r.json()) as { halfHourFee?: number };
    return Math.max(MIN_FEE_RATE, j.halfHourFee ?? MIN_FEE_RATE);
  } catch {
    return MIN_FEE_RATE;
  }
}

async function broadcast(hex: string): Promise<string> {
  const r = await fetch(`${MEMPOOL_API}/tx`, { method: "POST", headers: { "content-type": "text/plain" }, body: hex });
  const t = await r.text();
  if (!r.ok) throw new Error(`broadcast failed: ${t.slice(0, 160)}`);
  return t.trim();
}

async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  const url = process.env["TXC_RPC_URL"] ?? process.env["TXC_RPC_ADDRESS"];
  const user = process.env["TXC_RPC_USER"];
  const pass = process.env["TXC_RPC_PASS"] ?? process.env["TXC_RPC_PASSWORD"];
  if (!url || !user || !pass) throw new Error("TXC node not configured");
  const res = await fetch(url.startsWith("http") ? url : `https://${url}`, {
    method: "POST",
    headers: { "content-type": "text/plain", authorization: "Basic " + Buffer.from(`${user}:${pass}`).toString("base64") },
    body: JSON.stringify({ jsonrpc: "1.0", id: "card", method, params }),
  });
  const j = (await res.json()) as { result: T; error: { message: string } | null };
  if (j.error) throw new Error(j.error.message);
  return j.result;
}

export function decimalToUnits(s: string | number): bigint {
  const str = String(s).trim();
  if (!/^\d+(\.\d+)?$/.test(str)) throw new Error("bad amount");
  const [w, f = ""] = str.split(".");
  if (f.length > 8 && /[1-9]/.test(f.slice(8))) throw new Error("amount has too many decimals");
  return BigInt(w ?? "0") * 100_000_000n + BigInt((f + "00000000").slice(0, 8));
}

export async function tsdBalanceUnits(address: string): Promise<bigint> {
  try {
    const r = await rpc<{ balance: string }>("omni_getbalance", [address, TSD_PROPERTY_ID]);
    return decimalToUnits(r.balance);
  } catch {
    return 0n;
  }
}

/**
 * Pay `units` TSD from the pocket to `to`. TXC change returns to the pocket.
 * With `sweepTo`, ALL TXC also goes to `to` (one output) — used when killing a card.
 */
export async function sendFromPocket(encKey: string, to: string, units: bigint, sweepAll = false): Promise<string> {
  if (/^txc1/i.test(to)) throw new Error("Token payments need a T… address");
  const priv = await decryptKey(encKey);
  try {
    const from = p2pkhFromPriv(priv);
    const list = await utxos(from);
    if (list.length === 0) throw new Error("Card pocket has no TXC for the network fee");
    const psbt = new Psbt({ network: TXC_NETWORK, maximumFeeRate: 10_000_000 });
    for (const u of list) {
      psbt.addInput({ hash: u.txid, index: u.vout, nonWitnessUtxo: Buffer.from(await txHex(u.txid), "hex") });
    }
    const total = list.reduce((s, u) => s + u.value, 0);
    const withToken = units > 0n;
    const outs = sweepAll ? 1 : 2;
    const vbytes = 11 + list.length * 148 + outs * 34 + (withToken ? 32 : 0);
    const fee = vbytes * (await feeRate());
    if (sweepAll) {
      const value = total - fee;
      if (value < DUST) throw new Error("Not enough TXC to cover the fee");
      psbt.addOutput({ address: to, value: BigInt(value) });
    } else {
      const change = total - DUST - fee;
      if (change < 0) throw new Error("Card pocket needs a little more TXC for the network fee");
      psbt.addOutput({ address: to, value: BigInt(DUST) });
      if (change >= DUST) psbt.addOutput({ address: from, value: BigInt(change) });
    }
    if (withToken) {
      const script = payments.embed({ data: [buildSimpleSendPayload(TSD_PROPERTY_ID, units)] }).output;
      if (!script) throw new Error("bad token payload");
      psbt.addOutput({ script, value: 0n });
    }
    const pubkey = ecc.pointFromScalar(priv, true);
    if (!pubkey) throw new Error("bad key");
    for (let i = 0; i < list.length; i++) {
      psbt.signInput(i, { publicKey: pubkey, sign: (h: Uint8Array) => ecc.sign(h, priv) } as never);
    }
    psbt.finalizeAllInputs();
    return await broadcast(psbt.extractTransaction().toHex());
  } finally {
    priv.fill(0);
  }
}

/* ------------------------------- NectarPay ------------------------------ */

const NECTAR = "https://nectar-pay.com/api/public/v1/pay";

export interface ResolvedInvoice {
  merchant: string;
  usd: number;
  address: string;
  units: bigint;
}

export async function resolveTsdInvoice(invoiceId: string, nonce: string): Promise<ResolvedInvoice> {
  const url = `${NECTAR}/${encodeURIComponent(invoiceId)}?t=${encodeURIComponent(nonce)}`;
  const r = await fetch(url, { headers: { accept: "application/json" }, redirect: "error", signal: AbortSignal.timeout(10_000) });
  if (!r.ok) throw new Error("Invoice not found");
  const inv = (await r.json()) as {
    status: string;
    currency: string;
    fiat_amount: number;
    merchant?: { name?: string };
    options?: { chain: string; tokenSymbol: string | null; key: string }[];
  };
  if (inv.status !== "pending") throw new Error(`Invoice is ${inv.status}`);
  if (String(inv.currency).toUpperCase() !== "USD") throw new Error("Card pays USD invoices only");
  const opt = (inv.options ?? []).find((o) => /^txc/i.test(o.chain) && (o.tokenSymbol ?? "").toUpperCase() === "TSD");
  if (!opt) throw new Error("This merchant doesn't accept TSD");
  const s = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ option: opt.key }),
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  });
  if (!s.ok) throw new Error("Couldn't select TSD on the invoice");
  const sel = (await s.json()) as { address: string; crypto_amount: string | number; fiat_amount: number };
  const units = decimalToUnits(sel.crypto_amount);
  if (units <= 0n) throw new Error("Bad invoice amount");
  const usd = validateCardAmount(units, Number(sel.fiat_amount ?? inv.fiat_amount));
  // Also compare the selected crypto amount to the original invoice total.
  validateCardAmount(units, Number(inv.fiat_amount));
  return { merchant: inv.merchant?.name ?? "a merchant", usd, address: sel.address, units };
}

/* ------------------------------- Telegram ------------------------------- */

export async function tg(method: string, body: unknown): Promise<unknown> {
  const lk = process.env["LOVABLE_API_KEY"];
  const tk = process.env["TELEGRAM_API_KEY"];
  if (!lk || !tk) throw new Error("Telegram not configured");
  const r = await fetch(`https://connector-gateway.lovable.dev/telegram/${method}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${lk}`, "X-Connection-Api-Key": tk, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const t = await r.text();
  if (!r.ok) {
    console.error(`telegram ${method} [${r.status}]: ${t}`);
    throw new Error(`Telegram ${method} failed [${r.status}]`);
  }
  return JSON.parse(t);
}

export function telegramWebhookSecret(): string {
  return createHash("sha256").update(`telegram-webhook:${process.env["TELEGRAM_API_KEY"] ?? ""}`).digest("base64url");
}

export const fmtUsd = (n: number) => `$${n.toFixed(2)}`;

/* ------------------------------- payments ------------------------------- */

/** Send a payment row that is already claimed as 'pending'. Never throws. */
export async function executePayment(paymentId: string): Promise<{ status: string; txid?: string; reason?: string }> {
  const db = await admin();
  const { data: p } = await db.from("nfc_card_payments").select("*").eq("id", paymentId).single();
  if (!p) return { status: "failed", reason: "payment missing" };
  if (p.status !== "pending") return { status: "declined", reason: "payment not authorized" };
  const { data: card } = await db.from("nfc_cards").select("status").eq("id", p.card_id).single();
  if (card?.status !== "active") return { status: "declined", reason: "card not active" };
  const { data: k } = await db.from("nfc_card_keys").select("enc_key").eq("card_id", p.card_id).single();
  if (!k) {
    await db.from("nfc_card_payments").update({ status: "declined", reason: "card not active", decided_at: new Date().toISOString() }).eq("id", p.id);
    return { status: "declined", reason: "card not active" };
  }
  try {
    const txid = await sendFromPocket(k.enc_key, p.pay_to, BigInt(p.amount_units));
    await db.from("nfc_card_payments").update({ status: "paid", txid, decided_at: new Date().toISOString() }).eq("id", p.id);
    return { status: "paid", txid };
  } catch (e) {
    const reason = (e as Error).message.slice(0, 200);
    await db.from("nfc_card_payments").update({ status: "failed", reason, decided_at: new Date().toISOString() }).eq("id", p.id);
    return { status: "failed", reason };
  }
}

export async function spentLast24h(cardId: string): Promise<number> {
  const db = await admin();
  const since = new Date(Date.now() - 86_400_000).toISOString();
  const { data } = await db.from("nfc_card_payments").select("amount_units").eq("card_id", cardId).in("status", ["paid", "pending"]).gte("created_at", since);
  return (data ?? []).reduce((s, r) => s + Number(r.amount_units) / 100_000_000, 0);
}
