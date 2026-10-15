# Tap-to-pay NFC card (we are the card service)

## What the user sees
1. **Settings → Tap card → Link a card.** On the phone app they tap the card on the phone. On the web or extension they type the number printed on the card.
2. **Set rules:** a PIN rule (every tap, above an amount, or never), a per-tap limit (default $100), a daily cap (default $500), and Telegram approvers (themselves, plus an optional backup such as a parent).
3. **Fund the card pocket** with TSD. It's a separate branch, shown on the home screen like the Trading pocket.
4. **Tap at a NectarPay checkout.**
   - Under the limit: paid instantly.
   - Over the limit: Telegram asks "Approve $140 at Joe's Coffee?" with Yes/No buttons.
5. **Kill card** (also a "Lost card" button): stops the card, moves the coins back to the main wallet, and retires the branch.

## Safety rules
- The backend only ever holds the key for the card pocket (its own branch, starting at 1201'). It never holds main-wallet keys.
- The key is stored encrypted. It's only unlocked inside the payment step and is never sent back out.
- A card ID by itself pays nothing. Every payment needs a request signed by NectarPay, a real NectarPay invoice, and the limit, PIN and daily-cap checks to pass.
- Only TSD can be paid from the card, and only to the address on the invoice.
- 5 wrong PINs lock the card until the owner unlocks it in the wallet.
- Every tap is logged and shown in the wallet: amount, merchant, approved or declined.
- Hidden on iPhone at first, through the existing gate.

## What NectarPay needs to do (handoff doc)
- Read the card ID when a card is tapped and ask for a PIN if our backend says one is needed.
- Call our pay endpoint, signed with the shared HME_ECOSYSTEM secret, then show "paid", "waiting for approval" or "declined".

## Technical details
- Tables: `nfc_cards` (owner wallet id, card UID hash, PIN hash, limits, approver chat IDs, status, branch), `nfc_card_keys` (encrypted pocket key; service-role access only), `nfc_card_payments` (log, approval state, txid).
- Owner identity: a wallet-signed message, the same way ecosystem sign-in works. No email accounts.
- Endpoints: `/api/public/card/pay` (NectarPay, HMAC-verified), `/api/public/telegram/webhook` (approval buttons). Server functions handle link, rules, kill and history.
- Signing: Omni TSD send from the pocket on the server (workerd-safe libraries), broadcast through the existing TXC path.
- Telegram through the connector. Users link Telegram with a one-time code sent to the bot.
- Encryption key comes from a generated secret `CARD_KEY_ENC`.
- Applies to web, APK and extension. Native NFC reading is APK only; the other versions enter the card number.

## Not included yet
- Smart cards that hold their own key (Option A).
- Paying with coins other than TSD.
