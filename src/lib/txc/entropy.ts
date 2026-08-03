/**
 * Hardened entropy source for seed generation.
 *
 * Everything here is defence-in-depth around `crypto.getRandomValues`, which
 * is already a CSPRNG on every platform we ship to (browser, iOS WKWebView,
 * Android WebView). The extra layers exist because a wallet seed is a
 * one-shot, irreversible secret: if the platform RNG is ever broken, stuck,
 * or backdoored we want the failure to be loud rather than silent.
 *
 * Layers:
 *  1. Availability check — throw (never fall back to Math.random).
 *  2. Health tests on every raw draw (NIST SP 800-90B style): all-zero /
 *     all-ones rejection, repetition-count test, byte-diversity test, and a
 *     duplicate-draw detector across the process lifetime.
 *  3. Multi-draw extraction — two independent RNG draws plus local jitter are
 *     folded through HMAC-SHA256 (a randomness extractor). The output is at
 *     least as strong as the strongest input; a biased or partially
 *     predictable draw cannot weaken it.
 *  4. Optional user entropy (screen scribbles) mixed in as additional keying
 *     material, never as a replacement.
 *  5. Sensitive intermediates are zeroed after use.
 */
import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";

/** Zero a buffer in place (best-effort; JS gives no guarantees). */
export function wipe(...buffers: (Uint8Array | null | undefined)[]) {
  for (const b of buffers) if (b) b.fill(0);
}

function getCrypto(): Crypto {
  const c = globalThis.crypto;
  if (!c || typeof c.getRandomValues !== "function") {
    throw new Error(
      "This device has no secure random number generator, so a wallet cannot be created safely here.",
    );
  }
  return c;
}

/** Hex of the last raw draw, used to catch a stuck/duplicating RNG. */
let lastRawDraw: string | null = null;

function toHex(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += b.toString(16).padStart(2, "0");
  return s;
}

/**
 * NIST SP 800-90B-inspired continuous health tests. These are deliberately
 * conservative: a healthy RNG fails them with probability far below 2^-80 for
 * a 32-byte draw, so any failure means something is genuinely wrong.
 */
export function healthCheckRandom(bytes: Uint8Array): string | null {
  if (bytes.length < 16) return null; // too short to test meaningfully

  let allZero = true;
  let allOnes = true;
  for (const b of bytes) {
    if (b !== 0x00) allZero = false;
    if (b !== 0xff) allOnes = false;
  }
  if (allZero) return "random generator returned all zero bytes";
  if (allOnes) return "random generator returned all 0xFF bytes";

  // Repetition count test: no run of 6+ identical bytes.
  let run = 1;
  for (let i = 1; i < bytes.length; i++) {
    run = bytes[i] === bytes[i - 1] ? run + 1 : 1;
    if (run >= 6) return "random generator produced a long repeated run";
  }

  // Byte-diversity test. For 32 random bytes the expected number of distinct
  // values is ~30.8; seeing fewer than 12 is effectively impossible.
  const seen = new Set<number>();
  for (const b of bytes) seen.add(b);
  const minDistinct = Math.max(6, Math.floor(bytes.length * 0.375));
  if (seen.size < minDistinct) return "random generator output lacks diversity";

  return null;
}

/** One raw, health-checked draw from the platform CSPRNG. */
function rawDraw(length: number): Uint8Array {
  const c = getCrypto();
  const out = c.getRandomValues(new Uint8Array(length));
  const problem = healthCheckRandom(out);
  if (problem) {
    wipe(out);
    throw new Error(`Insecure randomness detected (${problem}). Wallet creation aborted.`);
  }
  const hex = toHex(out);
  if (lastRawDraw && hex === lastRawDraw) {
    wipe(out);
    throw new Error("Insecure randomness detected (repeated output). Wallet creation aborted.");
  }
  lastRawDraw = hex;
  return out;
}

/** Non-secret local jitter: adds nothing if the RNG is fine, helps if it isn't. */
function jitterBytes(): Uint8Array {
  const parts: number[] = [];
  const now = Date.now();
  const perf = typeof performance !== "undefined" ? performance.now() : 0;
  const push = (n: number) => {
    const v = Math.floor(Math.abs(n)) >>> 0;
    parts.push(v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff);
  };
  push(now);
  push(now / 4294967296);
  push(perf * 1000);
  // A few timing samples — cheap and unpredictable at sub-microsecond scale.
  for (let i = 0; i < 4; i++) {
    const t0 = typeof performance !== "undefined" ? performance.now() : 0;
    let acc = 0;
    for (let j = 0; j < 997; j++) acc += j ^ i;
    const t1 = typeof performance !== "undefined" ? performance.now() : acc;
    push((t1 - t0) * 1e6 + acc);
  }
  return Uint8Array.from(parts);
}

function concat(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

/**
 * Produce `length` bytes (max 32) of extracted entropy.
 *
 * extract = HMAC-SHA256(key = draw1, msg = "HME-wallet-entropy/v1" || draw2 || jitter || user)
 *
 * HMAC is a computational randomness extractor: the output is
 * indistinguishable from random as long as *any one* input has enough
 * min-entropy. Adding user scribbles can only help.
 */
export function extractEntropy(length: 16 | 32, userBytes?: Uint8Array | null): Uint8Array {
  const draw1 = rawDraw(32);
  const draw2 = rawDraw(32);
  const jitter = jitterBytes();
  const domain = new TextEncoder().encode("HME-wallet-entropy/v1");
  const user = userBytes && userBytes.length ? sha256(userBytes) : new Uint8Array(0);

  const msg = concat([domain, draw2, jitter, user]);
  const okm = hmac(sha256, draw1, msg);

  // Final XOR with a fresh raw draw so the result is never *worse* than a
  // plain getRandomValues call, even under a pathological hash failure.
  const belt = rawDraw(32);
  const out = new Uint8Array(length);
  for (let i = 0; i < length; i++) out[i] = okm[i] ^ belt[i];

  const problem = healthCheckRandom(out);
  if (problem) {
    wipe(draw1, draw2, jitter, user, msg, okm, belt, out);
    throw new Error(`Insecure randomness detected (${problem}). Wallet creation aborted.`);
  }

  wipe(draw1, draw2, jitter, user, msg, okm, belt);
  return out;
}
