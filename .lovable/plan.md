Two features to land before the next release. Both are additive — nothing existing changes for users who don't opt in.

## 1. Encrypted Google Drive backup

Model after Bitcoin.com Wallet: user links Google, we push an encrypted blob of their seed/wallet metadata, they can list past backups and restore on a fresh install by signing back into Google.

**Flow**
- Settings → "Cloud backup" card
  - Not linked → "Connect Google Drive"
  - Linked → email shown, list of backups (timestamp + device name + size), "Back up now", "Disconnect"
- On new install, `/import` gets a third option "Restore from Google Drive" alongside "Enter seed" / "Scan QR"

**Encryption**
- We NEVER upload a raw seed. The blob is `AES-GCM(scrypt(password + email-salt), payload)` where `payload = { mnemonic, walletMeta, watchOnly, contacts, chainPrefs, featurePrefs, exportedAt, deviceName }`.
- Password is required at backup and at restore time (independent of biometric unlock). Users are told: "Google can't read this. If you forget this password AND lose your device, the backup is useless."
- Blob stored in the Drive **appDataFolder** (hidden, private per app, quota-free up to 10GB, revoked when user disconnects). Filename: `hme-wallet-<fingerprint>-<isoDate>.enc`.

**OAuth**
- Web/browser: Google Identity Services (GIS) token client with scope `https://www.googleapis.com/auth/drive.appdata`. Uses the existing HME publishable OAuth client id.
- Native (iOS/Android): `@capacitor-community/generic-oauth2` (in-app browser, PKCE). Same scope, iOS client id via `nectar://` redirect.
- We store only the refresh-capable access token in SecureStorage (native) / sessionStorage (web).

**Secrets/config needed from the user**
- `GOOGLE_OAUTH_WEB_CLIENT_ID` (public, ok in code)
- `GOOGLE_OAUTH_IOS_CLIENT_ID` (public, ok in code)
- I'll walk you through creating both in Google Cloud Console → OAuth consent screen + Credentials once we're ready.

**Files added**
- `src/lib/backup/drive.ts` — GIS token + Drive REST (list/upload/download in `appDataFolder`).
- `src/lib/backup/crypto.ts` — scrypt + AES-GCM encrypt/decrypt.
- `src/lib/backup/payload.ts` — canonical payload shape + migrator.
- `src/components/wallet/CloudBackupCard.tsx` — settings UI.
- `src/routes/wallet.restore-drive.tsx` — restore picker, invoked from `/import`.

## 2. Iskander Coin (ISK) support

ISK is a Bitcoin-style fork identical in structure to TXC — just different network bytes, HRP, SLIP-44, and mempool host. Ported straight from the ISK Web Wallet project.

**ISK network params** (from that project)
- P2PKH `0x2d` → addresses start with `K…`
- P2SH `0x2c`
- WIF `0xad`
- bech32 HRP `isk` → native segwit `isk1q…`
- SLIP-44 coin type `969696` → derivation `m/84'/969696'/0'/0/…`
- Explorer/REST: `https://mempool.iskandercoin.com`

**Architecture**
Refactor TXC's chain code to be reusable across UTXO chains, then instantiate for both TXC and ISK. Concretely:
- `src/lib/utxo/chain-registry.ts` — `UtxoChain` interface (id, network, coinType, derivation paths, mempool base, dust, fee, uri schemes, price feed).
- `src/lib/utxo/mempool.ts` — parameterized version of `src/lib/txc/mempool.ts`; takes a base URL.
- `src/lib/utxo/wallet.ts` — parameterized version of `src/lib/txc/wallet.ts`; takes a `UtxoChain`.
- Register two chains: `txc` (existing params) and `isk` (ISK params).
- The old `src/lib/txc/*` files stay as thin wrappers that call the parameterized versions with the TXC config — this avoids touching every existing import site.

**Wallet integration**
- Both chains share the ONE HD seed the user already has (no separate seed, no separate password).
- `chain-prefs.ts` — flip `isk` off `soon` and default it enabled=true after import.
- New routes: `wallet.isk.tsx` (dashboard tile), `wallet.isk.send.tsx`, `wallet.isk.receive.tsx`. Copies of the TXC route with chain id swapped.
- `wallet.index.tsx` tile carousel gets an ISK tile with its own balance / activity list.
- Price feed: add ISK to the CMC price server function if the ticker is listed, otherwise show balance in ISK only (no fiat) with a "price unavailable" note. Please confirm the CMC / CoinGecko id for ISK.
- QR + URI parser: extend `parseWalletUri` to recognize `iskandercoin:` and `isk:` schemes.
- Deep-rescan and watch-only screens gain a chain selector (TXC / ISK).

**Not in this scope**
- ZCU stays as `soon`. It's an EVM L2 — different plumbing.
- No Play Store / iOS binary rebuild in this PR; you'll run `bun run ios:reset` and Xcode archive after we ship.

## Order of implementation

1. Extract UTXO chain registry (no behavior change to TXC).
2. Wire in ISK chain, routes, tiles, price.
3. Backup crypto + payload.
4. Google OAuth (web first, then native).
5. Drive REST + settings card + restore route.
6. Polish + verify TXC still behaves identically.

## Confirmations needed before I start

- **CMC / CoinGecko id for ISK** so I can wire live price? Or leave ISK price as `—` for launch?
- Confirm the Google OAuth strategy (`drive.appdata` scope + AES-GCM + user password) is the shape you want. If you'd rather store the encrypted blob in your own Cloud storage instead of Google Drive, say the word — plumbing is different.
- Any objection to shipping ISK tile enabled-by-default for everyone on their next app open? (Current behavior for non-TXC chains is opt-in.)
