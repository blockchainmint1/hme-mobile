# Seeds trading link — two modes, user picks

When a user scans a Seeds link code, the wallet asks:

> **How should Seeds trade for you?**
> - **Give Seeds access** — instant trades. Seeds can spend anything in your Trading pocket until you revoke.
> - **Approve every trade** — Seeds holds no key. Each trade pops up in your wallet and you tap to approve.

Both modes use the same separate **Trading (Seeds)** pocket (account 1106) on TXC/TSD, ISK, BTC, LTC and EVM. Your main wallet is never touched or shared.

## What the user sees

1. **Trading pocket on the wallet home.** Its own balance per coin, a Receive address, and "Move to Trading" / "Move back to main wallet" buttons.
2. **Choice screen** (above) after scanning a Seeds code. Red line on the access option: "Seeds can spend anything you put here."
3. **Linked apps** in Settings → Ecosystem links: one list of every linked site (Bonfire, NectarPay, File Fingerprint, TSD, Seeds) with a Revoke button and the mode shown.
4. **Revoking access-mode** sweeps the Trading pocket back to the main wallet and retires that pocket, so the next link uses a brand-new one and an old key controls nothing.
5. **Trade approvals** (approve-every-trade mode): a "Seeds wants to trade" card with what goes out, what comes in, and fee; Approve / Decline. Checked when the wallet is open, plus a notification badge.

## Safety rules (hard-coded)

- Only account 1106 (or its retired successors 1107, 1108…), only the listed coin types; never account 0.
- Spending links work only for sites on the honest.money trusted list; untrusted sites are refused outright, not just warned.
- Keys are encrypted on the device to Seeds' public key before leaving; the signed identity message (Seeds' template) is rebuilt locally.
- In approve mode, the wallet only signs transactions that spend from the Trading pocket and whose outputs match what the card shows.
- Hidden on iPhone (exchange gate), like other trading features.

## Rollout

Phone app + website first; extension after. Requires Publish + new APK.

## What Seeds must add (reply note in Files)

- For approve mode: a "pending trades" feed the wallet polls and a submit endpoint for the signed transaction. Spec drafted in the note.
- Accept a `mode` field and a pocket number (1106, 1107…) in the link submission.
- Revoke endpoint per their doc.

## Technical details

- New `src/lib/xpub-link/delegate.ts`: validate `hm-link-delegate` manifest, derive account xprv/xpub per chain, seal with X25519 (`@noble/curves` + `@noble/ciphers`, AES-256-GCM), build the signed message with Payload-SHA256.
- Trading-pocket derivation + scan reuses each chain's existing scan code with the account index swapped; active pocket index stored per vault.
- Linked-apps store unifies existing Nectar/requested/TSD link records plus delegate links.
- Approve mode: `src/lib/seeds/trades.ts` polls Seeds via a same-origin proxy route (`/api/seeds/*`, host-locked to seeds.honest.money), builds/verifies PSBT or EVM tx locally.
- Gate everything behind `exchangeFeaturesAllowed()`.
