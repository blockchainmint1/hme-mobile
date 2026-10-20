/**
 * Link a wallet to an honest.money member profile (optional, Settings only).
 *
 * Step 1 `redeemHmeTicket`: the /sso page hands us honest.money's sign-in
 * ticket. We verify it (HMAC-SHA256 with the shared HME_ECOSYSTEM secret,
 * 120 s expiry) and return a short-lived *receipt* bound to the wallet's
 * random `state`. The raw ticket never leaves this page, so it can't be
 * replayed elsewhere even if a popup opener is hostile.
 *
 * Step 2 `linkHmeProfile`: the wallet sends the receipt back (plus, only if
 * the member opted in, its main TXC watch key and Ethereum address). We
 * verify the receipt and report a `wallet_download` Hub event to honest.money
 * so the member's installs/activity credit their referrer.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const enc = new TextEncoder();

async function hmacHex(secret: string, msg: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(msg)));
  return Array.from(sig, (b) => b.toString(16).padStart(2, "0")).join("");
}

function safeEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

function b64urlDecode(s: string): string {
  const pad = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  return new TextDecoder().decode(Uint8Array.from(atob(pad), (c) => c.charCodeAt(0)));
}

function secret(): string {
  const s = process.env["HME_ECOSYSTEM"];
  if (!s) throw new Error("Profile linking isn't configured yet.");
  return s;
}

export const redeemHmeTicket = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({ token: z.string().min(10).max(4000), state: z.string().regex(/^[a-f0-9]{32}$/) }).parse(d),
  )
  .handler(async ({ data }) => {
    const [body, sig] = data.token.split(".");
    if (!body || !sig) throw new Error("That sign-in link is not valid.");
    if (!safeEq(await hmacHex(secret(), body), sig.toLowerCase())) throw new Error("That sign-in link is not valid.");
    const t = JSON.parse(b64urlDecode(body)) as { minerId?: string; email?: string; exp?: number };
    if (!t.minerId || !t.exp || t.exp * 1000 < Date.now()) throw new Error("That sign-in link expired. Please try again.");
    const memberId = String(t.minerId).slice(0, 64);
    const email = String(t.email ?? "").slice(0, 200);
    const exp = Math.floor(Date.now() / 1000) + 600;
    const payload = `${memberId}|${email}|${data.state}|${exp}`;
    return { memberId, email, exp, state: data.state, receipt: await hmacHex(secret(), `hme-wallet-link:${payload}`) };
  });

export const linkHmeProfile = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        memberId: z.string().min(1).max(64),
        email: z.string().max(200),
        exp: z.number().int(),
        state: z.string().regex(/^[a-f0-9]{32}$/),
        receipt: z.string().regex(/^[a-f0-9]{64}$/),
        platform: z.enum(["web", "android", "ios", "extension"]),
        ref: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/).optional(),
        keys: z
          .object({
            txc_xpub: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{100,120}$/),
            evm_address: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
          })
          .optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    if (data.exp * 1000 < Date.now()) throw new Error("Link timed out. Please sign in again.");
    const payload = `${data.memberId}|${data.email}|${data.state}|${data.exp}`;
    const expected = await hmacHex(secret(), `hme-wallet-link:${payload}`);
    if (!safeEq(expected, data.receipt)) throw new Error("Link could not be verified.");

    const apiKey = process.env["HME_SITE_API_KEY"];
    const site = process.env["HME_SITE_CODE"];
    // Optional attribution must never transmit the cross-partner signing secret.
    if (!apiKey || !site) return { reported: false, memberFound: null };
    const res = await fetch("https://honest.money/api/public/hub/events", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "X-HME-Site": site, "Content-Type": "application/json" },
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
      body: JSON.stringify({
        service: site,
        event: "wallet_download",
        member_id: data.memberId,
        ...(data.ref ? { ref: data.ref } : {}),
        metadata: {
          platform: data.platform,
          ...(data.keys
            ? { txc_xpub: data.keys.txc_xpub, txc_path: "m/44'/696969'/0'", evm_address: data.keys.evm_address }
            : {}),
        },
      }),
    }).catch(() => null);
    const out = (await res?.json().catch(() => null)) as { ok?: boolean; member_found?: boolean } | null;
    return { reported: !!res?.ok, memberFound: out?.member_found ?? null };
  });
