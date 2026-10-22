<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

## Shared platform capabilities and layout
- Keep the capability compatibility helpers unrestricted across supported builds; why: existing callers share one feature set without store-specific switches.
- Render the public footer inside the frame's content scroller; why: legal links must not pin over or reduce the readable homepage content.
- Keep wallet Send/Receive outside the home content scroller and apply bottom safe-area spacing only once; hidden public footers must occupy no space. Why: phone actions must stay at the bottom without an extra gap.

## Release delivery is database-driven

`/api/public/apk` serves the newest `app_releases` row's CID/version (or `?v=`), falling back to baked-in bytes only if lookup fails. Pin then record its endpoint download URL; never hardcode the live CID. Why: releases need no website redeploy.

## Chrome extension

The extension packages the full web app: `bun scripts/build-extension.mjs` runs `vite build`, renders the SPA shell into `extension/popup.html`/`index.html` with inline scripts externalised (MV3 CSP), and `server-fn-bridge` forwards `/_serverFn`+`/api` to mobile.honest.money when `isExtension()`. `src/extension/popup.tsx` is only the approval window (`approve.html`). Why: one app, every fix ships to web, APK and extension.

- Extension web provider: `src/extension/inpage.ts` (EIP-6963 + `window.honestMoney`, `window.ethereum` only if free) → `content.ts` → `background.ts`; keys stay in approval popup. Why: sites never touch keys and signatures need approval.
- Popup theme follows system by default with a light/dark override saved only in extension localStorage. Why: appearance should not change web/mobile settings or wallet data.

## Trusted ecosystem sites come from honest.money
Registry/Hub use ecosystem-credential.server (current per-site HME convention); do not migrate partner signing implicitly. Spending requires fresh exact registry membership. Why: site recognition cannot authenticate payments.

## Trading links (hm-link-delegate)
- Spending access is only ever for the Trading pocket account (1106'+, rotated on revoke) and only for sites on the honest.money trusted list; look-only links stay xpub-only. Why: a shared spending key can't be taken back, so the blast radius must be one separate, retirable pocket.
- The top camera routes safe bare HTTPS ecosystem manifests through the same link approval page as Settings, after payment and sign-in recognition; recognition never grants trust or shares keys. Why: Seeds uses bare manifest URLs and must not require a different scanner.

## Tap card (NFC) service
- We are the card service: card pockets live on HME-reserved branch 1107' (card N = `m/44'/696969'/1107'/0/N`, owner signing key `/1/0`); only that pocket key is sent to the backend, AES-GCM encrypted with `CARD_KEY_ENC` (`src/lib/card/*`). Why: a tapped card must pay while the phone is offline, and the blast radius must stay one small pocket. Trading pocket rotation skips reserved branches.
- Partners pay via `/api/public/card/pay` signed with `HME_ECOSYSTEM`; over-limit taps go to Telegram approvers via `/api/public/telegram/webhook`. Owner actions are wallet-signed envelopes, never accounts. Why: no extra service and no email logins.

## Vault wallets (offline signing via HME Vault)
- Rules live in `src/lib/vault-link/AGENTS.md` — read it before changing files there. Why: subdirectories carry their own scoped rules.
- Swap history keeps its original key; new rows carry profile IDs, legacy rows match payout addresses, and opening refreshes provider status. Why: preserve records without cross-wallet display or invented completion.

## Security boundaries
- FixedFloat non-JSON 403 responses are access refusals, not invalid quotes; never retry order creation against alternate hosts or expose gateway bodies. Why: live-service access can differ from sandbox access and duplicate orders must be avoided.
- THORChain quotes and order refreshes use liquidity_tolerance_bps against expected after-fee output, never feeless tolerance_bps; why: liquidity fees must not consume price protection or reject valid streaming quotes.
- Read src/lib/security/AGENTS.md before changing security controls; why: shared guardrails cover web, Android and extension.
- Card PIN verification and payment reservation run atomically in the database; why: concurrent taps cannot race limits or lockout.

## Settings scope (app-wide vs per-wallet)
- Chains, EVM token catalog and token-spam visibility are device-wide; migrate copy-only, never touching profiles/envelopes. Why: choices follow wallets safely.
- Key-tied features, address prefs, watch-only, WIF, delegate/Seeds, card, Vault and labels remain profile-scoped. Why: key-bound settings cannot leak across wallets.
- Settings page is grouped "This device" (app-wide) vs "This wallet — <label>" (per-wallet). Why: users must see which scope they're editing.
- Activity filtering is independent, device-wide and recoverable; counterfeit contracts override claimed direction; pending tracking uses raw history. Why: logs cannot prove signatures.

## EVM history
- Shared web/APK/extension history rules live in src/lib/chains/AGENTS.md; read before edits. Why: durable caching and pagination protect costs and real payments.
