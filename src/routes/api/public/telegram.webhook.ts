/**
 * Telegram bot webhook for tap-card approvers: "/start CODE" links a chat to a
 * card; the Approve/Decline buttons settle over-limit payments.
 */
import { createFileRoute } from "@tanstack/react-router";

interface Update {
  message?: { chat: { id: number }; text?: string };
  callback_query?: { id: string; data?: string; message?: { chat: { id: number }; message_id: number; text?: string } };
}

export const Route = createFileRoute("/api/public/telegram/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const s = await import("@/lib/card/card.server");
        if (!s.safeEq(request.headers.get("X-Telegram-Bot-Api-Secret-Token") ?? "", s.telegramWebhookSecret()))
          return new Response("Unauthorized", { status: 401 });
        const u = (await request.json()) as Update;
        const db = await s.admin();

        if (u.message?.text) {
          const chat = u.message.chat.id;
          const m = u.message.text.trim().match(/^(?:\/start\s+)?([A-Z0-9]{6,12})$/i);
          if (!m) return Response.json({ ok: true });
          const { data: card } = await db.from("nfc_cards").select("id, label, approver_chat_ids").eq("telegram_code", m[1]!.toUpperCase()).maybeSingle();
          if (!card) {
            await s.tg("sendMessage", { chat_id: chat, text: "That code isn't valid any more. Get a fresh one in the wallet under Settings → Tap card." }).catch(() => null);
            return Response.json({ ok: true });
          }
          const ids = Array.from(new Set([...(card.approver_chat_ids ?? []).map(Number), chat])).slice(-3);
          await db.from("nfc_cards").update({ approver_chat_ids: ids, telegram_code: null }).eq("id", card.id);
          await s.tg("sendMessage", { chat_id: chat, text: `✅ You'll approve over-limit taps for "${card.label}" here.` }).catch(() => null);
          return Response.json({ ok: true });
        }

        const cq = u.callback_query;
        const m = cq?.data?.match(/^cp:([ad]):([0-9a-f-]{36})$/);
        if (!cq || !m || !cq.message) return Response.json({ ok: true });
        const chat = cq.message.chat.id;
        const { data: p } = await db.from("nfc_card_payments").select("id, card_id, status, usd, merchant, created_at").eq("id", m[2]!).maybeSingle();
        const { data: card } = p ? await db.from("nfc_cards").select("approver_chat_ids, status").eq("id", p.card_id).single() : { data: null };
        const allowed = !!card && (card.approver_chat_ids ?? []).map(Number).includes(chat);
        let reply = "This request is no longer open.";
        if (p && allowed && p.status === "approval") {
          if (Date.now() - new Date(p.created_at).getTime() > s.CARD_APPROVAL_TTL_MS) {
            await db.from("nfc_card_payments").update({ status: "declined", reason: "Approval timed out" }).eq("id", p.id).eq("status", "approval");
            reply = "Too late — this request expired.";
          } else if (m[1] === "d") {
            await db.from("nfc_card_payments").update({ status: "declined", reason: "Declined on Telegram", decided_at: new Date().toISOString() }).eq("id", p.id).eq("status", "approval");
            reply = `❌ Declined ${s.fmtUsd(Number(p.usd))} at ${p.merchant}.`;
          } else if (card!.status !== "active") {
            reply = "The card is no longer active.";
          } else {
            const { data: claimed } = await db.from("nfc_card_payments").update({ status: "pending" }).eq("id", p.id).eq("status", "approval").select("id");
            if (claimed?.length) {
              const r = await s.executePayment(p.id);
              reply = r.status === "paid" ? `✅ Paid ${s.fmtUsd(Number(p.usd))} at ${p.merchant}.` : `⚠️ Approved, but sending failed: ${r.reason}`;
            }
          }
        }
        await s.tg("answerCallbackQuery", { callback_query_id: cq.id }).catch(() => null);
        await s.tg("editMessageText", { chat_id: chat, message_id: cq.message.message_id, text: reply }).catch(() => null);
        return Response.json({ ok: true });
      },
    },
  },
});
