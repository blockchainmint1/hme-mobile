# Full wallet inside the Chrome extension

## Problem
The extension popup is a small separate screen (TXC only: create/import, balance, receive, send). The phone app has everything else — settings, all chains, swaps, history, profiles, watch-only, WIF, sign-in, updates.

## Approach
Stop maintaining a separate mini-wallet. Package the **same wallet app the phone uses** into the extension, just as the APK does. Every screen and every future fix then shows up in the extension automatically.

- The extension opens the full wallet in a phone-sized popup (about 380x600). An "Open in tab" button gives a bigger view.
- All chains, settings, profiles, history, send/receive, token lists, watch-only, WIF, and sign-in work the same as on the phone.
- The wallet stays in the extension's own storage, so each browser profile keeps its own wallet, separate from the website version.
- Website connection requests (Connect Wallet, sign-in) still open the approval window. That window is rebuilt on the full app, so it uses the same unlock and profiles.
- Phone-only features (APK update card, camera QR scanning, biometrics) are hidden or replaced in the extension. Password unlock stays. Pasting a QR/link replaces the camera.
- Swaps: the browser extension counts as a web version, so swaps stay on, just like the website.

## Technical details
- Add an `extension` build target next to `build:android`: `vite build` with `VITE_TARGET=extension`, then reuse `scripts/generate-capacitor-index.mjs`-style SPA shell generation into `extension/app/`.
- MV3 CSP forbids inline scripts: the shell generator moves any inline bootstrap/hydration script into an external `.js` file. Use hash-based routing or a single `index.html` entry with client-side routing so every path resolves inside `chrome-extension://`.
- Network calls: all chain calls already go to absolute hosts or `/api/*`. In the extension build, `/api/*` is rewritten to `https://mobile.honest.money/api/*`. Add `host_permissions` for every chain host the app uses. Server-side CORS allows `chrome-extension://` (already done for the EVM proxy; extend it to the other `/api` routes the wallet calls).
- Add `src/lib/native/capabilities.ts` flag `isExtension()` to gate camera, biometrics, APK update, and deep links.
- `popup.html` points at the full app. `src/extension/popup.tsx` is reduced to the approval screen and mounted as an app route (`/extension/approve?req=`). background/content/inpage stay as they are.
- Remove the popup's own theme picker. The app's existing theme setting takes over (it defaults to following the system).
- `scripts/build-extension.mjs` runs the new target and zips to `public/hme-wallet-extension.zip`. Update AGENTS.md extension rule.
- Verify with Playwright by loading the unpacked extension: unlock, switch chains, open settings, check that a connect request opens the approval window.

## After approval
Rebuild the zip. Then you publish once so the site allows extension requests. To update, you replace the files in the extension folder and hit Reload, as the /chrome page already explains.
