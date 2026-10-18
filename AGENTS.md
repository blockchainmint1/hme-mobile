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

`/api/public/apk` resolves what to serve from the newest `app_releases` row
(`ipfs_cid` + version, or `?v=<version>` for an older build) and only falls back
to the build baked into the file when the lookup fails. Why: cutting a release
must never require a website redeploy — pin the file, insert the row with
`download_url` pointing at the endpoint, and installed apps get the prompt and
the correct bytes. Keep it that way: never move the pinned CID/filename back
into a hardcoded constant that the release row has to be kept in sync with.

## Chrome extension

The extension packages the full web app: `bun scripts/build-extension.mjs` runs `vite build`, renders the SPA shell into `extension/popup.html`/`index.html` with inline scripts externalised (MV3 CSP), and `server-fn-bridge` forwards `/_serverFn`+`/api` to mobile.honest.money when `isExtension()`. `src/extension/popup.tsx` is only the approval window (`approve.html`). Why: one app, every fix ships to web, APK and extension.

- Extension web provider: `src/extension/inpage.ts` (EIP-6963 + `window.honestMoney`, `window.ethereum` only if free) → `content.ts` → `background.ts`; keys stay in approval popup. Why: sites never touch keys and signatures need approval.
- Popup theme follows system by default with a light/dark override saved only in extension localStorage. Why: appearance should not change web/mobile settings or wallet data.

## Trusted ecosystem sites come from honest.money
Friendly site names/trust badges for sign-in and xpub links load from the HMAC-signed (`HME_ECOSYSTEM`) registry at honest.money (`src/lib/ecosystem-sites*`, spec `docs/ecosystem-trusted-sites.md`); the built-in list in `src/lib/web-login-hosts.ts` is only the offline fallback. Why: adding a partner site must never need a wallet release. The registry only labels — it never relaxes message/path rules.

## Trading links (hm-link-delegate)
- Spending access is only ever for the Trading pocket account (1106'+, rotated on revoke) and only for sites on the honest.money trusted list; look-only links stay xpub-only. Why: a shared spending key can't be taken back, so the blast radius must be one separate, retirable pocket.

## Tap card (NFC) service
- We are the card service: card pockets live on HME-reserved branch 1107' (card N = `m/44'/696969'/1107'/0/N`, owner signing key `/1/0`); only that pocket key is sent to the backend, AES-GCM encrypted with `CARD_KEY_ENC` (`src/lib/card/*`). Why: a tapped card must pay while the phone is offline, and the blast radius must stay one small pocket. Trading pocket rotation skips reserved branches.
- Partners pay via `/api/public/card/pay` signed with `HME_ECOSYSTEM`; over-limit taps go to Telegram approvers via `/api/public/telegram/webhook`. Owner actions are wallet-signed envelopes, never accounts. Why: no extra service and no email logins.

## Vault wallets (offline signing via HME Vault)
- EVM send routes resolve Vault balances only from the paired public address, never the random wrapping root; native and ERC-20 sends use restricted Vault intents and verify the complete signed transaction before broadcast. Why: displaying or signing for the wrapping anchor targets a different, empty wallet.
- Vault profiles are envelope `mode: "vault"` — random anchor like keyonly, no seed; watch-only account xpubs live in `src/lib/vault-link/pairing.ts` (scoped `hme.vault-link.v1`). Why: unlock/session/switch machinery stays byte-identical and no key material is ever stored.
- Vault profiles render the normal home screen (`wallet.index.tsx`): chain scans come from `vaultAccountSnapshot` (`src/lib/vault-link/snapshot.ts`) instead of the seed, and Send/Receive use `VaultBottomActions`, which builds unsigned PSBTs (`psbt-build.ts`) or `hm-evm-tx` intents (`evm-intent.ts`) shown as HMQR2 animated QRs (`qr-parts.ts` — must stay byte-compatible with HME Vault's `src/lib/signer/qr-parts.ts`); only signed hex comes back for verify + broadcast. `VaultHome` is only the unpaired fallback. Why: same experience up to signing, and the online wallet must never ask for an xprv.
- Wallet factory helpers (createVaultWallet etc.) only build the UnlockedWallet; saving is always saveWalletToNewProfile/saveWallet by the caller. Why: a factory that saves writes to the currently active profile slot and overwrites that wallet (this destroyed a seed envelope once).
