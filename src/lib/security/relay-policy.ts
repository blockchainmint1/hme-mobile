import { z } from "zod";
import { checkLoginMessageShape } from "@/lib/hm-login-template";
const address = z.string().regex(/^[A-Za-z0-9]{26,64}$/);
const signature = z.string().regex(/^[A-Za-z0-9+/=]{80,120}$/);
const id = z.string().min(1).max(200);
const xpub = z.string().regex(/^(?:xpub|ypub|zpub|tpub|upub|vpub|Ltub|Mtub)[1-9A-HJ-NP-Za-km-z]{80,120}$/);
const chain = z.enum(["TXC", "BTC", "EVM", "ZCU", "LTC", "DOGE", "BCH", "DASH", "ISK", "TRX", "SOL"]);
const keys = z.record(chain, z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,120}$/));
const path = z.string().regex(/^m\/(?:44|84)'\/\d+'\/\d+'$/);
const body = z.union([
  z.object({ id, address, signature, message: z.string().max(2000) }).strict(),
  z.object({ payload: z.object({ v: z.literal(1), type: z.literal("hm-link-xpubs"), challenge_id: id, from: z.string().max(253), callback_url: z.string().url().max(2048), chains: z.array(chain).max(11), xpubs: keys, exp: z.number(), issued_at: z.string().max(40) }).strict(), address, signature }).strict(),
  z.object({ token: id, identity_address: address, xpub, path, signature, app_name: z.literal("honest.money wallet") }).strict(),
  z.object({ token: id, mode: z.enum(["access", "approve"]), account: z.number().int().min(1106).max(2147483647), paths: z.array(path).min(1).max(5), identity_address: address, signature, message: z.string().max(2000), payload: z.string().regex(/^[A-Za-z0-9_-]+={0,2}$/).max(8000).optional(), xpubs: keys, app_name: z.literal("honest.money wallet"), app: z.object({ name: z.literal("honest.money wallet") }).strict() }).strict(),
  z.object({ link_id: id, identity_address: address, signature, message: z.string().max(2000) }).strict(),
  z.object({ link_id: id, trade_id: id, decision: z.enum(["approve", "decline"]), signed_psbt: z.string().regex(/^cHNidP[A-Za-z0-9+/=]+$/).max(28000).optional(), identity_address: address, signature, message: z.string().max(2000) }).strict(),
]);

/** Reject arbitrary bodies; signed protocol messages must name the destination. */
export function validateRelayPost(raw: unknown, target: URL): ReturnType<typeof body.parse> {
  const value = body.parse(raw);
  if ("message" in value) {
    if ("id" in value) {
      if (!checkLoginMessageShape(value.message, target.hostname).ok) throw new Error("Invalid sign-in message");
    } else {
      const lines = value.message.split("\n");
      if (lines[2] !== `Domain: ${target.hostname}` || !/^Honest Money - (?:Link wallet \(delegate\)|Revoke link|Approve trade|Decline trade)$/.test(lines[0] ?? "")) throw new Error("Invalid authorization message");
      if ("trade_id" in value && target.pathname !== "/api/public/hme-link/trades/respond") throw new Error("Invalid trade destination");
    }
  }
  if ("payload" in value && typeof value.payload === "object" && new URL(value.payload.callback_url).href !== target.href) throw new Error("Wrong link destination");
  return value;
}