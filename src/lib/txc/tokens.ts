/**
 * TEXITcoin Omni Layer token support.
 *
 * - Built-in registry (POP #37, wUSDC #38) + user customs via localStorage.
 * - Simple Send payload construction (client-side; deterministic byte layout).
 * - Token display prefs (show/hide) mirroring the EVM token-prefs module.
 *
 * The Omni Simple Send payload (20-byte OP_RETURN including "omni" magic):
 *   magic  "omni"        4 bytes ASCII
 *   version              2 bytes  = 0x0000
 *   type                 2 bytes  = 0x0000 (Simple Send)
 *   property id          4 bytes  BE uint32
 *   amount               8 bytes  BE int64 (willets for divisible; count for indivisible)
 *
 * Amount encoding: divisible tokens are always 10^8 (Omni convention),
 * regardless of what a "wrapped" underlying asset's decimals look like.
 */
import { useEffect, useState } from "react";

export interface TxcTokenMeta {
  /** Omni property id. */
  id: number;
  symbol: string;
  /** Omni divisible flag. True → amount stored as fixed-point 10^8 willets. */
  divisible: boolean;
  /** Display name shown in pickers. */
  name?: string;
}

export const OMNI_DIVISIBLE_DECIMALS = 8;

export const BUILTIN_TXC_TOKENS: TxcTokenMeta[] = [
  { id: 38, symbol: "wUSDC", name: "Wrapped USDC", divisible: true },
  { id: 37, symbol: "POP", name: "CryptoPOP", divisible: false },
];

const CUSTOM_KEY = "hme:txc-tokens:custom:v1";
const HIDDEN_KEY = "hme:txc-tokens:hidden:v1";
const EVT = "hme:txc-tokens-changed";

function readCustom(): TxcTokenMeta[] {
  try {
    const raw = localStorage.getItem(CUSTOM_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isTokenMeta) : [];
  } catch {
    return [];
  }
}
function writeCustom(v: TxcTokenMeta[]) {
  localStorage.setItem(CUSTOM_KEY, JSON.stringify(v));
}
function readHidden(): Set<number> {
  try {
    const raw = localStorage.getItem(HIDDEN_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as number[];
    return new Set(Array.isArray(arr) ? arr.filter((n) => Number.isInteger(n)) : []);
  } catch {
    return new Set();
  }
}
function writeHidden(s: Set<number>) {
  localStorage.setItem(HIDDEN_KEY, JSON.stringify([...s]));
}
function isTokenMeta(v: unknown): v is TxcTokenMeta {
  return (
    !!v &&
    typeof v === "object" &&
    Number.isInteger((v as TxcTokenMeta).id) &&
    typeof (v as TxcTokenMeta).symbol === "string" &&
    typeof (v as TxcTokenMeta).divisible === "boolean"
  );
}
function emit() {
  window.dispatchEvent(new Event(EVT));
}

export function getKnownTxcTokens(): TxcTokenMeta[] {
  // De-dupe by id; user customs win.
  const customs = readCustom();
  const seen = new Set(customs.map((t) => t.id));
  return [...customs, ...BUILTIN_TXC_TOKENS.filter((t) => !seen.has(t.id))];
}

export function getEnabledTxcTokens(): TxcTokenMeta[] {
  const hidden = readHidden();
  return getKnownTxcTokens().filter((t) => !hidden.has(t.id));
}

export function setTxcTokenEnabled(id: number, enabled: boolean) {
  const s = readHidden();
  if (enabled) s.delete(id);
  else s.add(id);
  writeHidden(s);
  emit();
}

export function isTxcTokenEnabled(id: number): boolean {
  return !readHidden().has(id);
}

export function isBuiltinTxcToken(id: number): boolean {
  return BUILTIN_TXC_TOKENS.some((t) => t.id === id);
}

export function addCustomTxcToken(
  token: TxcTokenMeta,
): { ok: true } | { ok: false; error: string } {
  if (!Number.isInteger(token.id) || token.id <= 0) {
    return { ok: false, error: "Property id must be a positive integer." };
  }
  if (!token.symbol.trim()) return { ok: false, error: "Symbol is required." };
  if (getKnownTxcTokens().some((t) => t.id === token.id)) {
    return { ok: false, error: "That property id is already in the list." };
  }
  const normalized: TxcTokenMeta = {
    id: token.id,
    symbol: token.symbol.trim().toUpperCase(),
    divisible: !!token.divisible,
    name: token.name?.trim() || undefined,
  };
  writeCustom([...readCustom(), normalized]);
  emit();
  return { ok: true };
}

export function removeCustomTxcToken(id: number) {
  writeCustom(readCustom().filter((t) => t.id !== id));
  const hidden = readHidden();
  hidden.delete(id);
  writeHidden(hidden);
  emit();
}

export function useEnabledTxcTokens(): TxcTokenMeta[] {
  const [list, setList] = useState<TxcTokenMeta[]>(() => getEnabledTxcTokens());
  useEffect(() => {
    const h = () => setList(getEnabledTxcTokens());
    window.addEventListener(EVT, h);
    return () => window.removeEventListener(EVT, h);
  }, []);
  return list;
}

export function useAllTxcTokens(): {
  tokens: TxcTokenMeta[];
  enabled: (t: TxcTokenMeta) => boolean;
  isCustom: (t: TxcTokenMeta) => boolean;
} {
  const [snapshot, setSnapshot] = useState(() => ({
    tokens: getKnownTxcTokens(),
    hidden: readHidden(),
  }));
  useEffect(() => {
    const h = () => setSnapshot({ tokens: getKnownTxcTokens(), hidden: readHidden() });
    window.addEventListener(EVT, h);
    return () => window.removeEventListener(EVT, h);
  }, []);
  return {
    tokens: snapshot.tokens,
    enabled: (t) => !snapshot.hidden.has(t.id),
    isCustom: (t) => !isBuiltinTxcToken(t.id),
  };
}

// ---------- Amount parsing / formatting ----------

/**
 * Parse a user-entered token amount to the Omni-encoded integer.
 *   divisible   → willets (amount × 10^8), rounded down
 *   indivisible → integer count
 * Throws if the amount is malformed or negative.
 */
export function parseTokenAmount(amountStr: string, divisible: boolean): bigint {
  const clean = amountStr.trim();
  if (!clean) throw new Error("Amount is required.");
  if (!/^\d+(\.\d+)?$/.test(clean)) throw new Error("Invalid amount.");
  if (!divisible) {
    if (clean.includes(".")) throw new Error("Amount must be a whole number.");
    const n = BigInt(clean);
    if (n <= 0n) throw new Error("Amount must be greater than zero.");
    return n;
  }
  const [whole, frac = ""] = clean.split(".");
  if (frac.length > OMNI_DIVISIBLE_DECIMALS) {
    throw new Error(`Max ${OMNI_DIVISIBLE_DECIMALS} decimals.`);
  }
  const padded = (frac + "0".repeat(OMNI_DIVISIBLE_DECIMALS)).slice(0, OMNI_DIVISIBLE_DECIMALS);
  const n = BigInt(whole) * 10n ** BigInt(OMNI_DIVISIBLE_DECIMALS) + BigInt(padded);
  if (n <= 0n) throw new Error("Amount must be greater than zero.");
  return n;
}

export function formatTokenAmount(units: bigint | number | string, divisible: boolean): string {
  const n = typeof units === "bigint" ? units : BigInt(units);
  if (!divisible) return n.toString();
  const base = 10n ** BigInt(OMNI_DIVISIBLE_DECIMALS);
  const whole = n / base;
  const frac = n % base;
  const fracStr = frac.toString().padStart(OMNI_DIVISIBLE_DECIMALS, "0").replace(/0+$/, "");
  return fracStr ? `${whole}.${fracStr}` : whole.toString();
}

// ---------- Omni Simple Send payload ----------

/**
 * Build the raw OP_RETURN bytes for a Simple Send (excluding the OP_RETURN
 * opcode / length prefix — pass this to `payments.embed({ data: [bytes] })`).
 *
 * Layout (20 bytes):
 *   "omni" | 00 00 | 00 00 | propId(4 BE) | amount(8 BE)
 */
export function buildSimpleSendPayload(propertyId: number, amountUnits: bigint): Uint8Array {
  if (!Number.isInteger(propertyId) || propertyId <= 0 || propertyId > 0xffffffff) {
    throw new Error("Invalid property id.");
  }
  if (amountUnits <= 0n || amountUnits > 0x7fffffffffffffffn) {
    throw new Error("Invalid amount.");
  }
  const out = new Uint8Array(20);
  // Magic "omni"
  out[0] = 0x6f;
  out[1] = 0x6d;
  out[2] = 0x6e;
  out[3] = 0x69;
  // Version + Type = 0
  // out[4..7] = 0 (already)
  // Property id BE uint32
  out[8] = (propertyId >>> 24) & 0xff;
  out[9] = (propertyId >>> 16) & 0xff;
  out[10] = (propertyId >>> 8) & 0xff;
  out[11] = propertyId & 0xff;
  // Amount BE int64
  const mask = 0xffn;
  for (let i = 0; i < 8; i++) {
    out[19 - i] = Number((amountUnits >> BigInt(i * 8)) & mask);
  }
  return out;
}
