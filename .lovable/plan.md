## Goal

Build a TEXITcoin web wallet on Lovable (TanStack Start) that reproduces the core of the existing BlueWallet-fork app, runs as a responsive PWA, and is friendly to wrap with Capacitor later for a same-bundle-ID native re-release. Existing users keep their funds by manually importing their BIP39 seed phrase from the old app — nothing on the new install touches the old app's storage, so a parallel install can never overwrite or corrupt the existing wallet.

## What the existing app is (key findings)

- React Native fork of BlueWallet rebranded for TEXITcoin. Bundle IDs `com.texitcoin.wallet` (iOS) and `com.txc.wallet` (Android), v1.3.0 build 17.
- Carries the full BlueWallet surface: HD segwit/legacy/P2SH wallets, multisig, SLIP39, taproot, Lightning custodial, watch-only, BIP47, PSBT signing, Electrum, push via "groundcontrol". Out of scope for v1 per your answer.
- TEXITcoin network params (extracted from `patches/*.patch`):
  - `messagePrefix: '\x18Bitcoin Signed Message:\n'`
  - `bech32: 'txc'`
  - `bip32: xpub/xprv` (Bitcoin-style)
  - `pubKeyHash: 0x42`, `scriptHash: 0x41`, `wif: 0xc1`
- Backends in use:
  - Electrum: `electrum1.texitcoin.org`, `electrum2…`, `electrum3…` on SSL/443
  - Push (not in v1): `groundcontrol.texitcoin.org`
  - Per your input: `mempool.texitcoin.org` for explorer/tx data, CoinMarketCap for TXC→fiat.
- Unit code: `TXC`. URI scheme: `texitcoin:` / `TEXITCOIN:`.

## What the existing app does wrong / that we'll fix

- Heavy: ships dozens of wallet types most users don't use — confusing UI and large attack surface.
- Stores wallet secrets via React Native AsyncStorage encrypted with a user PIN that is also stored as a `Keychain` item — fine on iOS, weaker on Android without StrongBox. We replace with browser/PWA storage encrypted with a user-supplied password (PBKDF2 → AES-GCM via WebCrypto) plus a clearly labeled "this is browser storage, write down your seed" warning on every create/import flow.
- Mixes Bitcoin/BlueWallet branding strings throughout (e.g. `BlueComponents`, BIP39 word list checks, copy referring to BTC) — confusing for TXC users. We use TEXITcoin naming end-to-end.
- Electrum-only fee estimation with no fallback — we add `mempool.texitcoin.org` REST fallback.
- No CSP / SRI / lockfile pinning concerns for the native app, but we'll start the new web app with a strict CSP, no third-party fonts/CDNs at runtime, all crypto libs pinned, no analytics, no error reporting that ships seed/address data.
- No clean seed-export flow — the new app puts a single, obvious "Backup seed phrase" path on the wallet home and re-prompts at first send.

## UX/UI direction (close to current, modernized)

Keep the BlueWallet feel users recognize:
- Card-style "wallet" tile on home with balance in TXC + fiat, gradient header (TEXITcoin brand colors), big Send / Receive / Scan buttons.
- Tabs: Wallets · Transactions · Settings, plus floating QR-scan FAB.
- Improvements: dark mode default, larger tap targets, real empty/error/loading states (the current app shows blank screens on Electrum hiccup), responsive layout that works on desktop, a11y on every control, a one-screen "Import existing wallet" flow that auto-detects seed vs WIF vs xpub.
- Honest.money ecosystem footer on all marketing/public pages: link to honest.money, Terms, Privacy, Manifesto (drafted if not provided).

## Migration / non-destructive install

Because this is a brand-new install at a new origin (and, when you wrap it later, will be a brand-new bundle ID unless you replace the existing native binary with same signing), there is **zero shared storage with the old app**. The only path for existing holders is BIP39 seed import:

1. First-run screen offers "Create new wallet" or "I already have a wallet".
2. "I already have a wallet" → paste 12/24-word BIP39 seed (validates checksum), optional BIP39 passphrase, choose derivation: native segwit (`m/84'/0'/0'`, bech32 `txc1…`) / legacy (`m/44'/0'/0'`, `T…` addresses) / wrapped segwit (`m/49'/0'/0'`). Default tries all three and picks the one with on-chain history via Electrum/mempool lookups.
3. Re-derives addresses locally using the TEXITcoin network params above; never sends seed off-device.

Result: installing the new app on a phone or desktop literally cannot touch the old app's keychain. We document this clearly in onboarding and in release notes.

## Scope for v1

In:
- Create / import HD wallet (BIP39, BIP84 default; BIP44 + BIP49 import-only).
- Address derivation, balance, tx history via Electrum (primary) and mempool.texitcoin.org (fallback/explorer links).
- Receive (address + QR + amount-request URI).
- Send (PSBT-style construct + sign locally with bitcoinjs-lib + tiny-secp256k1-wasm, broadcast via Electrum, fallback mempool REST).
- Fiat rate via CoinMarketCap (key stored as a Lovable secret, called via a TanStack server function; client never sees the key).
- Password-locked local storage (WebCrypto AES-GCM, PBKDF2 ≥ 600k iters), auto-lock timer, seed backup + verify flow, "delete wallet" with double confirmation.
- PWA install + offline shell, dark mode, full a11y, honest.money footer.

Out (deferred):
- Lightning, multisig, SLIP39, taproot, BIP47, watch-only, hardware wallets, push notifications, biometric unlock (browser support is uneven — Capacitor wrapper will add this later).

## Tech approach (developer-facing)

- TanStack Start app (template default). Routes:
  - `/` landing + create/import
  - `/wallet` balance/tx list
  - `/wallet/receive`, `/wallet/send`, `/wallet/backup`, `/wallet/settings`
  - `/legal/terms`, `/legal/privacy`, `/manifesto`
- Crypto in browser: `bitcoinjs-lib`, `bip32`, `bip39`, `ecpair`, `@bitcoinerlab/secp256k1` (WASM, browser-safe — no native modules). TEXITcoin `Network` object defined once in `src/lib/txc/network.ts` and passed to every call (no patching upstream packages).
- Electrum: a small WebSocket client to the `electrum*.texitcoin.org:443` SSL endpoints if they expose WSS; otherwise proxy through a TanStack server route (`/api/electrum/*`) that opens a TLS socket — confirm with you which the servers support before we wire it.
- mempool.texitcoin.org used via REST for tx history and fee estimates.
- CoinMarketCap price via `createServerFn` keyed by `CMC_API_KEY` secret.
- No Lovable Cloud / DB needed — wallet is fully client-side.
- Strict CSP, no third-party script, lockfile committed.

## Open items I'll confirm before/early in build

1. Do the `electrum*.texitcoin.org` servers expose plain Electrum-over-SSL only, or WSS? Determines whether we need the server-route proxy.
2. TEXITcoin SLIP-44 coin type — current code uses Bitcoin's `0'`. If TEXITcoin has a registered coin type we should default new wallets to `m/84'/<txc>'/0'`; import flow will still try both.
3. Whether to ship draft Terms / Privacy / Manifesto I write, or whether you'll provide copy.

## Deliverables

- Working web wallet at the Lovable preview URL, deployable as a PWA.
- Code structured so a Capacitor wrap is a straightforward follow-up (no DOM-only assumptions in crypto/storage layer).
- Clear in-app and README guidance for existing users on seed-phrase migration, plus the honest.money ecosystem footer site-wide.
