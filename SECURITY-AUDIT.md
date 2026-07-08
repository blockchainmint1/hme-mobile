# HME Wallet security audit and hardening plan

Audience: the HME dev AI / engineers. This document is the execution plan. Part
1 is the findings. Part 2 lists what was already changed on the
`security-hardening` branch. Part 3 is the remaining work with exact steps. Part
4 is the second-pass review (did the fixes introduce new risk). Part 5 is
verification and a CI gate.

The wallet's cryptographic core is sound: the seed is encrypted at rest, keys
live only in memory, transactions are signed on device, all API keys are server
side, and the git history is clean of secrets. The exposure is structural, led
by the app loading its code from a remote URL at runtime. Fix H1, H2, and H3
first.

## Part 1: Findings

| ID | Severity | Issue |
|----|----------|-------|
| H1 | High | Native app loads all code from a remote URL (dynamic code, supply chain) |
| H2 | High | No Content Security Policy |
| H3 | High | Biometric unlock stores the password in the keychain without an OS biometric gate |
| M1 | Medium | PBKDF2 KDF is weak for offline brute force of the on-device seed |
| M2 | Medium | Password minimum was 8 chars, no strength check |
| M3 | Medium | Custom `nectar://` scheme is not exclusively owned (deep-link phishing) |
| M4 | Medium | Third-party error reporting (Lovable) runs inside a wallet |
| M5 | Medium | EVM RPC proxy caller check is spoofable and was the only gate |
| L1 | Low | Seed is hidden with CSS blur but is fully present in the DOM |
| L2 | Low | localStorage stores xpub-derived material (privacy, not spendable) |
| L3 | Low | Beta server framework on the money path; broad `allowNavigation` |

### H1. The binary runs remote code
`capacitor.config.ts` set `server.url = "https://mobile.honest.money"`, so the
store binary is a thin shell and 100% of wallet logic is downloaded at launch. A
server or CDN compromise, or one bad deploy, ships JavaScript that reads seed
phrases and passwords from every user. No Subresource Integrity, no signed
bundle. Also a poor fit for App Store 2.5.2 and Play policy. This is the single
largest risk.

### H2. No Content Security Policy
No CSP header or meta tag existed. For an app that keeps the encrypted seed in
localStorage and can see the plaintext seed and password in memory, the absence
of CSP means any injected script can exfiltrate. The workhorse directive is
`connect-src`: it stops a script from POSTing the seed to an attacker domain
even if the script runs.

### H3. Biometric unlock is gated only by app JavaScript
`src/lib/native/biometric.ts` calls `BiometricAuth.authenticate()` and then, as
a separate step, reads the password from `SecureStorage`. The keychain item is
not bound to biometrics with an OS access-control flag, so the OS does not
require Face ID or a fingerprint to release it. A jailbroken device, a keychain
dump, or coerced JavaScript (see H1) can read the password and decrypt the seed.

### M1..M5, L1..L3
See the inline notes in the code and Part 3. Summary: raise the KDF cost and
password policy, treat the deep-link scheme as untrusted and always confirm the
full recipient before sending, scrub third-party error payloads, and add real
quota controls to the RPC proxy.

## Part 2: Already done on the `security-hardening` branch

All changes below typecheck (`bunx tsc --noEmit`) and lint (`bunx eslint .`)
clean. They are backward compatible: existing wallets keep unlocking.

1. H1 config (`capacitor.config.ts`, `ios/App/App/capacitor.config.json`):
   removed `server.url` so release builds bundle their assets. A dev-only
   `HME_REMOTE_URL` env var re-enables remote loading for live reload. The
   WebView `hostname` is kept at `mobile.honest.money` so the bundled build
   serves under the SAME origin the remote build used (see the migration note in
   Part 4, item A). Requires a native rebuild and QA before shipping.

2. H2 CSP and headers (`src/lib/security/headers.ts`, wired in
   `src/routes/__root.tsx` as a production-only `<meta>` and in `src/start.ts`
   as production-only response headers). `connect-src` is limited to `'self'`
   plus the two client-side mempool hosts. `object-src`, `base-uri`,
   `form-action`, `frame-ancestors`, and friends are locked down. `script-src`
   still allows `'unsafe-inline'`; removing that needs nonce plumbing (Part 3).

3. M1 KDF (`src/lib/txc/storage.ts`): PBKDF2 raised from 600k to 1,000,000
   iterations for new wallets. The envelope now records its `kdf` and
   `iterations`, and decryption reads that count, so old 600k wallets still
   unlock. On the next unlock of a legacy wallet it silently re-encrypts at the
   new cost (best-effort; never blocks unlock).

4. M2 password policy (`src/lib/security/password-strength.ts`, wired into
   `src/routes/create.tsx` and `src/routes/import.tsx`): minimum 10 chars, a
   common-password blocklist, a repetition check, and a live strength meter on
   the create screen. Both wallet-creation paths use it.

5. M4 error scrubbing (`src/lib/lovable-error-reporting.ts`): error messages and
   stacks are scanned for mnemonic, WIF, xprv, and long-hex patterns and
   redacted, strings are length-capped, and only an allowlist of context keys is
   forwarded.

6. M5 RPC proxy (`src/routes/api/evm.$chain.ts`): the `*.lovable.app` wildcard
   origin is disabled in production, and a coarse, fail-open, per-IP rate limiter
   caps abuse of the metered Alchemy key.

7. Wallet checker (`src/components/wallet/SecurityCheckupCard.tsx`, shown in
   Settings): a client-side self-test that reports biometric state, auto-lock,
   install vs browser, a jailbreak/root hint, and a bundled vs remote-loaded
   integrity signal that maps to H1.

## Part 3: Remaining work (dev AI tasks)

### H1-followup. Rebuild native and QA the bundled app  [BLOCKER before release]
- `bun run build` then `bunx cap sync ios` and `bunx cap sync android`.
- Confirm the app runs from the bundle: in Xcode the console must NOT show a
  remote `Loading app at https://...`.
- Regression test the "native builds 2-4" bundling bug that originally motivated
  remote loading. If assets 404 or the shell is blank, fix the bundling (asset
  paths / `generate-capacitor-index.mjs`) rather than reverting to remote.
- Because the origin is preserved (hostname kept), existing users keep their
  wallet. Still test upgrade-in-place on a device that already has a wallet.

### H2-followup. Move to a nonce-based CSP and drop `'unsafe-inline'`
- Generate a per-request nonce, put it on every inline script (the two in
  `__root.tsx` plus framework hydration scripts), and set
  `script-src 'self' 'nonce-<value>'`. TanStack Start does not expose this out of
  the box; thread the nonce through the server entry and the `<Scripts>` render.
- Best delivery is a real `Content-Security-Policy` response header from the
  host that serves `mobile.honest.money`, in addition to the meta tag.
- Review `Strict-Transport-Security` before enabling `includeSubDomains` if any
  subdomain must serve non-TLS.

### H3. Bind biometric secrets to the OS
Preferred design (no stored password):
- On enable, generate a random 32-byte key K. Store K in a secure item created
  with `kSecAccessControlBiometryCurrentSet` (iOS) and
  `setUserAuthenticationRequired(true)` (Android Keystore), accessible
  `WhenUnlockedThisDeviceOnly`, non-syncable.
- Encrypt a second copy of the seed envelope under K. Biometric unlock reads K
  under OS enforcement and decrypts. No password is stored, and coerced
  JavaScript cannot read K without a live biometric.
- `@aparajita/capacitor-secure-storage` v8 does not expose this ACL; use a
  keychain/Keystore access-control capable plugin or a small native shim.

### M1-followup. Argon2id
- Add `argon2` via `hash-wasm` (pin the version). Add `kdf: "argon2id"` to the
  envelope and branch in `deriveKey`. Keep the PBKDF2 read path for migration.
- Do the migration in memory only (decrypt old, re-encrypt new); never write
  plaintext to disk. The `iterations`/`kdf` envelope fields already support
  versioned migration.

### M2-followup. Server-side leaked-password check
- Optionally check new passwords against HaveIBeenPwned's k-anonymity range API
  (send only a SHA-1 prefix) and reject known-breached passwords.

### M3. Treat the deep-link scheme as untrusted
- Prefer verified App Links / Universal Links (`autoVerify="true"`, host the
  AASA and `assetlinks.json`). Any `nectar://` open must land on a full
  confirmation screen showing merchant, amount, and the COMPLETE recipient
  address before any signature. Today `pay.$invoiceId.tsx` shows a truncated
  address (`shortAddr`); show the full address to defend against address
  poisoning. Reconcile the `pay.honest.money` vs `nectar-pay.com` naming in
  `ANDROID.md`.

### M4-followup. Keep telemetry off or self-hosted in production
- Point error reporting at your own endpoint or disable it in release. Apply the
  same scrubbing to the optional Sentry hook in `observability.ts` if enabled.

### L1/L2. Minor
- Render seed words only on explicit reveal; clear them from React state on
  unmount. Clear the persisted query cache and scan hints on wallet delete.

## Part 4: Second-pass review (did the fixes add risk?)

Two real risks were found in the fixes themselves and handled:

A. Origin change would have orphaned existing wallets (CRITICAL, fixed).
   Switching from remote (`https://mobile.honest.money`) to a default bundled
   origin (`capacitor://localhost`) changes the WebView origin. localStorage is
   keyed by origin, so every existing user's encrypted wallet would have become
   unreadable, forcing a re-import from seed and looking like data loss. Fix:
   keep `server.hostname = "mobile.honest.money"` with the https scheme so the
   bundled assets are served under the same origin. Do not change `hostname`
   without a migration plan.

B. Rate limiter could block real NATed users (availability, mitigated).
   Mobile carriers NAT many users behind one IP. A low per-IP cap would return
   429 and break balance loading. Fix: the limiter fails open on any error, the
   cap is set high (1200/min) to catch only egregious floods, and the origin
   check remains the primary gate. Recommendation: move to a shared,
   per-session store before lowering the cap.

Other fixes reviewed and cleared:
- CSP only restricts; the risk is over-blocking, mitigated by gating to
  production and allowlisting the exact client-side hosts (`'self'` plus the two
  mempool servers; all other calls are server-side). If you add a new
  client-side fetch host, add it to `connect-src` in `headers.ts`.
- KDF change is backward compatible (decrypt reads the stored iteration count).
  First unlock of a legacy wallet costs one extra derive for the silent upgrade
  and resets `createdAt`; both are acceptable. 1,000,000 PBKDF2 iterations is
  roughly 0.3 to 1s on a modern phone.
- Password policy now covers both create and import; there is no weaker path.
- Error scrubbing only reduces what is sent; regexes use bounded quantifiers to
  avoid ReDoS.
- The Security Checkup card is read-only and makes no network calls.

## Part 5: Verify and gate

Local verification for this branch:
```bash
bun install
bunx tsc --noEmit          # types
bunx eslint .              # lint
```

Recommended CI gate (add as a workflow) to prevent regressions:
- Fail if a release config has `server.url` set or `HME_REMOTE_URL` present.
- Fail if the built client bundle contains a secret pattern (API key, xprv).
- Fail if the CSP is missing from the shipped HTML.
- Run a dependency audit (`osv-scanner` or `bun audit`).
- Add a few Semgrep rules for wallet sinks (no `eval`, no seed in logs).

Verdict: the branch closes the two structural high-severity gaps in code (H1
config, H2 CSP) and hardens the KDF, password policy, error telemetry, and RPC
proxy, without breaking existing wallets. The remaining high-severity item, H3
(OS-gated biometrics), needs a native change and is the top follow-up, together
with the native rebuild and QA that H1 requires before release.
