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

## iOS App Store compliance — features that must NOT appear on iOS

The iOS App Store build is produced with `VITE_DISABLE_EXCHANGE=true`
(`bun run build:ios`). Any feature that could be classified as crypto
exchange, swap, bridge, trading, or off-ramp must be hidden on iOS.

Before adding one, gate it in `src/lib/native/capabilities.ts` and its UI, keep
it out of iOS navigation/screenshots, and verify with `bun run build:ios`.

Current gates:

- `exchangeFeaturesAllowed()` / `useExchangeFeaturesAllowed()` — swap and
  bridge features (LI.FI EVM swaps, THORChain LTC/DOGE swaps, Tron bridge).

Default to excluding new exchange features from iOS unless explicitly requested.

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
