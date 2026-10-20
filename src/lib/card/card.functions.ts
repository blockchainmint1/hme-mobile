/**
 * Owner-side tap-card actions. Every call carries an envelope signed by the
 * wallet's card-owner key (m/44'/696969'/1107'/1/0) — no accounts or emails.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const envelope = z.object({
  owner: z.string().min(26).max(64),
  ts: z.number().int(),
  action: z.string(),
  body: z.unknown(),
  sig: z.string().min(80).max(120),
});

const rules = z.object({
  label: z.string().trim().min(1).max(40),
  pinRule: z.enum(["always", "above", "never"]),
  pin: z.string().regex(/^\d{4,8}$/).optional(),
  pinAboveUsd: z.number().min(0).max(100_000),
  perTapUsd: z.number().min(0).max(100_000),
  dailyUsd: z.number().min(0).max(1_000_000),
});

const linkBody = rules.extend({
  uid: z.string().min(4).max(64),
  pocketIndex: z.number().int().min(0).max(999),
  pocketAddress: z.string().min(26).max(40),
  pocketKeyHex: z.string().regex(/^[0-9a-f]{64}$/),
  returnAddress: z.string().min(26).max(40),
});

function code(): string {
  const b = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(b, (x) => x.toString(36).padStart(2, "0")).join("").slice(0, 10).toUpperCase();
}

export const linkCard = createServerFn({ method: "POST" })
  .inputValidator((raw: unknown) => envelope.parse(raw))
  .handler(async ({ data }) => {
    const s = await import("./card.server");
    const owner = s.verifyOwner(data, "link");
    const b = linkBody.parse(data.body);
    if (s.p2pkhFromPriv(Buffer.from(b.pocketKeyHex, "hex")) !== b.pocketAddress) throw new Error("Pocket key doesn't match its address");
    if (!b.pin) throw new Error("A PIN is required for every tap");
    const pin = b.pin ? await s.hashPin(b.pin) : null;
    const db = await s.admin();
    const telegram_code = code();
    const { data: card, error } = await db
      .from("nfc_cards")
      .insert({
        owner_address: owner,
        uid_hash: s.uidHash(b.uid),
        label: b.label,
        pocket_account: b.pocketIndex,
        pocket_address: b.pocketAddress,
        return_address: b.returnAddress,
        pin_hash: pin?.hash ?? null,
        pin_salt: pin?.salt ?? null,
        pin_rule: "always",
        pin_above_usd: b.pinAboveUsd,
        per_tap_usd: b.perTapUsd,
        daily_usd: b.dailyUsd,
        telegram_code,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.code === "23505" ? "That card is already linked" : "Couldn't link the card");
    const { error: kErr } = await db.from("nfc_card_keys").insert({ card_id: card.id, enc_key: await s.encryptKey(b.pocketKeyHex) });
    if (kErr) {
      await db.from("nfc_cards").delete().eq("id", card.id);
      throw new Error("Couldn't store the card key");
    }
    return { id: card.id };
  });

export const updateCard = createServerFn({ method: "POST" })
  .inputValidator((raw: unknown) => envelope.parse(raw))
  .handler(async ({ data }) => {
    const s = await import("./card.server");
    const owner = s.verifyOwner(data, "update");
    const b = rules
      .partial()
      .extend({ cardId: z.string().uuid(), unlock: z.boolean().optional(), newTelegramCode: z.boolean().optional(), clearApprovers: z.boolean().optional() })
      .parse(data.body);
    const db = await s.admin();
    const { data: card } = await db.from("nfc_cards").select("id, status, pin_hash").eq("id", b.cardId).eq("owner_address", owner).single();
    if (!card || card.status === "killed") throw new Error("Card not found");
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (b.label) patch["label"] = b.label;
    if (b.pinRule) patch["pin_rule"] = "always";
    if (b.pinAboveUsd != null) patch["pin_above_usd"] = b.pinAboveUsd;
    if (b.perTapUsd != null) patch["per_tap_usd"] = b.perTapUsd;
    if (b.dailyUsd != null) patch["daily_usd"] = b.dailyUsd;
    if (b.pin) {
      const h = await s.hashPin(b.pin);
      patch["pin_hash"] = h.hash;
      patch["pin_salt"] = h.salt;
    }
    if ((b.pinRule || b.unlock) && !b.pin && !card.pin_hash) throw new Error("Set a PIN before activating the card");
    if (b.unlock) {
      patch["status"] = "active";
      patch["wrong_pins"] = 0;
    }
    if (b.newTelegramCode) patch["telegram_code"] = code();
    if (b.clearApprovers) patch["approver_chat_ids"] = [];
    await db.from("nfc_cards").update(patch as never).eq("id", card.id);
    return { ok: true };
  });

/** Stop the card, move everything in its pocket back to the main wallet, delete the key. */
export const killCard = createServerFn({ method: "POST" })
  .inputValidator((raw: unknown) => envelope.parse(raw))
  .handler(async ({ data }) => {
    const s = await import("./card.server");
    const owner = s.verifyOwner(data, "kill");
    const b = z.object({ cardId: z.string().uuid() }).parse(data.body);
    const db = await s.admin();
    const { data: card } = await db.from("nfc_cards").select("*").eq("id", b.cardId).eq("owner_address", owner).single();
    if (!card) throw new Error("Card not found");
    await db.from("nfc_cards").update({ status: "killed", telegram_code: null, updated_at: new Date().toISOString() }).eq("id", card.id);
    const { data: k } = await db.from("nfc_card_keys").select("enc_key").eq("card_id", card.id).maybeSingle();
    let txid: string | null = null;
    let note = "";
    if (k) {
      try {
        const tsd = await s.tsdBalanceUnits(card.pocket_address);
        txid = await s.sendFromPocket(k.enc_key, card.return_address, tsd, true);
      } catch (e) {
        note = (e as Error).message;
      }
      await db.from("nfc_card_keys").delete().eq("card_id", card.id);
    }
    return { txid, note };
  });

export const listCards = createServerFn({ method: "POST" })
  .inputValidator((raw: unknown) => envelope.parse(raw))
  .handler(async ({ data }) => {
    const s = await import("./card.server");
    const owner = s.verifyOwner(data, "list");
    const db = await s.admin();
    const { data: cards } = await db
      .from("nfc_cards")
      .select("id, label, status, pocket_account, pocket_address, pin_rule, pin_above_usd, per_tap_usd, daily_usd, telegram_code, approver_chat_ids, created_at")
      .eq("owner_address", owner)
      .neq("status", "killed")
      .order("created_at");
    const out = [];
    for (const c of cards ?? []) {
      const { data: pays } = await db
        .from("nfc_card_payments")
        .select("id, merchant, usd, status, reason, txid, created_at")
        .eq("card_id", c.id)
        .order("created_at", { ascending: false })
        .limit(20);
      out.push({
        id: c.id,
        label: c.label,
        status: c.status,
        pocketIndex: c.pocket_account,
        pocketAddress: c.pocket_address,
        pinRule: c.pin_rule,
        pinAboveUsd: Number(c.pin_above_usd),
        perTapUsd: Number(c.per_tap_usd),
        dailyUsd: Number(c.daily_usd),
        telegramCode: c.telegram_code,
        approvers: (c.approver_chat_ids ?? []).length,
        tsd: (await s.tsdBalanceUnits(c.pocket_address)).toString(),
        payments: (pays ?? []).map((p) => ({ ...p, usd: Number(p.usd) })),
      });
    }
    return { cards: out, bot: process.env["CARD_TELEGRAM_BOT"] || "hme_notify_bot" };
  });
