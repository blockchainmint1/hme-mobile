/**
 * NectarPay → tap-card payment. Signed with HME_ECOSYSTEM:
 *   x-hme-timestamp: unix seconds, x-hme-signature: hex HMAC-SHA256(`${ts}.${rawBody}`)
 * POST { card_uid, invoice_id, nonce, pin? } → { status: paid|pin_required|approval_required|declined|failed, ... }
 * GET ?id=<payment_id> (signature over `${ts}.${id}`) → current status.
 */
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const body = z.object({
  card_uid: z.string().min(4).max(64),
  invoice_id: z.string().min(1).max(100),
  nonce: z.string().min(1).max(200),
  pin: z.string().regex(/^\d{4,8}$/).optional(),
});

const json = (b: unknown, status = 200) => Response.json(b, { status, headers: { "Cache-Control": "no-store" } });

export const Route = createFileRoute("/api/public/card/pay")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const s = await import("@/lib/card/card.server");
        const id = new URL(request.url).searchParams.get("id") ?? "";
        if (!s.verifyPartner(request.headers.get("x-hme-timestamp") ?? "", request.headers.get("x-hme-signature") ?? "", id))
          return json({ error: "bad signature" }, 401);
        if (!z.string().uuid().safeParse(id).success) return json({ error: "bad id" }, 400);
        const db = await s.admin();
        const { data: p } = await db.from("nfc_card_payments").select("status, txid, reason, created_at").eq("id", id).maybeSingle();
        if (!p) return json({ error: "not found" }, 404);
        let status = p.status === "approval" ? "approval_required" : p.status === "pending" ? "sending" : p.status;
        if (p.status === "approval" && Date.now() - new Date(p.created_at).getTime() > s.CARD_APPROVAL_TTL_MS) status = "declined";
        return json({ status, txid: p.txid, reason: p.reason });
      },
      POST: async ({ request }) => {
        const s = await import("@/lib/card/card.server");
        const raw = await request.text();
        if (!s.verifyPartner(request.headers.get("x-hme-timestamp") ?? "", request.headers.get("x-hme-signature") ?? "", raw))
          return json({ error: "bad signature" }, 401);
        let b: z.infer<typeof body>;
        try {
          b = body.parse(JSON.parse(raw));
        } catch {
          return json({ error: "bad request" }, 400);
        }
        const db = await s.admin();
        const { data: card } = await db.from("nfc_cards").select("*").eq("uid_hash", s.uidHash(b.card_uid)).maybeSingle();
        if (!card || card.status === "killed") return json({ status: "declined", reason: "Card not recognised" });
        if (card.status === "locked") return json({ status: "declined", reason: "Card locked — owner must unlock it in the wallet" });

        let inv;
        try {
          inv = await s.resolveTsdInvoice(b.invoice_id, b.nonce);
        } catch (e) {
          return json({ status: "declined", reason: (e as Error).message });
        }

        const needsPin = card.pin_rule === "always" || (card.pin_rule === "above" && inv.usd > Number(card.pin_above_usd));
        if (needsPin) {
          if (!b.pin) return json({ status: "pin_required", usd: inv.usd });
          const h = await s.hashPin(b.pin, card.pin_salt ?? undefined);
          if (!card.pin_hash || !s.safeEq(h.hash, card.pin_hash)) {
            const wrong = card.wrong_pins + 1;
            await db.from("nfc_cards").update({ wrong_pins: wrong, status: wrong >= s.CARD_MAX_WRONG_PINS ? "locked" : card.status }).eq("id", card.id);
            return json({ status: "declined", reason: wrong >= s.CARD_MAX_WRONG_PINS ? "Too many wrong PINs — card locked" : "Wrong PIN" });
          }
          if (card.wrong_pins) await db.from("nfc_cards").update({ wrong_pins: 0 }).eq("id", card.id);
        }

        const spent = await s.spentLast24h(card.id);
        const over = inv.usd > Number(card.per_tap_usd) || spent + inv.usd > Number(card.daily_usd);
        const { data: pay, error } = await db
          .from("nfc_card_payments")
          .insert({
            card_id: card.id,
            invoice_id: b.invoice_id,
            merchant: inv.merchant,
            pay_to: inv.address,
            amount_units: Number(inv.units),
            usd: inv.usd,
            status: over ? "approval" : "pending",
          })
          .select("id")
          .single();
        if (error || !pay) return json({ status: "declined", reason: "This invoice is already being paid" });

        if (over) {
          const chats: number[] = (card.approver_chat_ids ?? []).map(Number);
          if (chats.length === 0) {
            await db.from("nfc_card_payments").update({ status: "declined", reason: "Over limit and no Telegram approver linked" }).eq("id", pay.id);
            return json({ status: "declined", reason: "Over the card's limit" });
          }
          const text = `💳 <b>${card.label}</b>: approve <b>${s.fmtUsd(inv.usd)}</b> at <b>${inv.merchant}</b>?\nSpent today: ${s.fmtUsd(spent)} of ${s.fmtUsd(Number(card.daily_usd))}.`;
          await Promise.all(
            chats.map((chat_id) =>
              s.tg("sendMessage", {
                chat_id,
                text,
                parse_mode: "HTML",
                reply_markup: { inline_keyboard: [[{ text: "✅ Approve", callback_data: `cp:a:${pay.id}` }, { text: "❌ Decline", callback_data: `cp:d:${pay.id}` }]] },
              }).catch(() => null),
            ),
          );
          return json({ status: "approval_required", payment_id: pay.id, usd: inv.usd });
        }

        const r = await s.executePayment(pay.id);
        if (r.status === "paid") {
          for (const chat_id of (card.approver_chat_ids ?? []).map(Number))
            void s.tg("sendMessage", { chat_id, text: `💳 ${card.label}: paid ${s.fmtUsd(inv.usd)} at ${inv.merchant}.` }).catch(() => null);
        }
        return json({ ...r, payment_id: pay.id, usd: inv.usd });
      },
    },
  },
});
