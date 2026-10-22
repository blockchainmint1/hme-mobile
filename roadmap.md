# Roadmap
- [ ] Diagnose FixedFloat HTTP 403 unreadable response on the live DOGE quote; verify provider access and distinguish access refusal from invalid quotes without changing wallet storage.
- [x] Fix the 500,000 DOGE quote rejection: after-fee liquidity tolerance replaces feeless tolerance, retaining 3% protection and streaming. Eight regression tests pass; real node returns a quote with Bobby's paired payout; unlocked phone UI with simulated DOGE funds shows THORChain and FixedFloat offers. No funds sent.
- [ ] Publish the after-fee quote fix so existing APKs/extensions use it (awaits publishing); phone quote retry controls require a packaged rebuild. Real Vault swap signing/broadcast still needs Bobby's device.
- [x] Fix Vault LTC/DOGE swap payout/balances/offline signing and refresh/isolate saved exchange status without altering wallet storage. 35 tests passed; unlocked phone test used paired payout, simulated 2 LTC funds, refreshed completed provider status, hid another profile's order and reached unsigned Vault QR. Build OK. No real provider order or funded broadcast performed.
- [ ] Deliver Vault swap fixes via website publish/new APK/extension and test a tiny real Vault swap (needs release approval/builds and Bobby's signing device); actual old FixedFloat completion remains unverified without device order references.
- [x] Fixed Seeds bare-HTTPS top-camera routing to ecosystem approval; 26 tests pass, unlocked 393px camera flow reaches both Seeds choices using a test manifest, wallet/profile storage unchanged. Real Seeds submission not performed; website publish and packaged rebuilds still needed for delivery.
- [ ] Bobby will upload the new APK for verification/pinning; extension packaging/distribution follows his pushed changes. NFC plugin explicitly deferred until current release/security work is locked down.
- [x] Prepared independent LI.FI/Relay review handoff for Bobby in Files; execution remains paused pending review.
- [x] Reduce EVM history lookups with durable service-only caching, atomic refresh leases, protected token streams and resumable pagination; device-wide token spam visibility retains genuine zero balances. 29 tests passed; live real/fake 110,000 USDC hashes verified, repeated/forced calls served cache, unlocked throwaway-wallet reveal/re-hide and setting persistence verified. Not published or packaged.
- [x] Remove the "Moving from the old TXC Wallet app?" blurb card from the homepage; verified the section is gone, the browser-extension section and footer still render, and the build is clean.
- [x] Filter contract-classified counterfeit outgoing token events without hiding genuine sends; 15 tests passed and unlocked throwaway-wallet UI verified with simulated fake 110,000 USDC and genuine 506 USDC history, including reveal/re-hide. Not published or packaged.
- [x] Add default-on device-wide suspicious activity filtering with reveal controls and accurate tiny amounts; 15 tests pass, device toggle and persistence verified in an unlocked throwaway wallet, saved wallets/token preferences untouched.
- [x] Security: patched Android runtime, strict spending-site trust, SIWE-only EVM signing, JSON-only partner proxies, bounded relay schemas and wallet-preservation regression tests
- [x] Security: enforce tap-card PINs and actual TSD-based limits; applied database row-lock guards for PIN lockout/payment reservation; runtime card concurrency checks still need funded partner test
- [x] Connected registry/Hub reads to current wallet-specific HME_ECOSYSTEM convention and site code wallet; app registry call returned 36 sites including Seeds, fresh signature verified, 20 safety tests passed. No wallet storage changes.
- [ ] Security: optional activity:write/SSO still need separate verification; directional NectarPay/card and TSD_NOTIFY_SIGNING_KEY plus asymmetric signing need partner rollout. Replaced HME_ECOSYSTEM means NectarPay's prior card signer must be coordinated before live taps.
- [x] Security containment: pause unverified LI.FI/Relay spending, restrict image destinations, remove unsafe keystore generator, pin CI actions and separate publish permissions
- [ ] Security: restore swaps/bridge after independently verified per-chain deployment/calldata specs; nonce-based CSP for server AND packaged shells (needs reviewed contracts and validated native shell signing-policy design)
- [ ] Security: privately test new APK/extension, PIN card concurrency and full Vault sends; test OS-gated fingerprint unlock on device (turn on, unlock, add new fingerprint → must ask for password) (needs release builds/devices)
- [x] Fix Vault EVM token-send balances and route USDC through verified offline QR signing; 27 tests passed, paired-address balances and QR preparation verified with simulated network data at desktop and 390px
- [ ] Verify a real-device USDC Vault send after installing the next APK (needs Bobby's Vault device; no funded transaction performed here)
- [x] Remove native iOS build/review restrictions and let the homepage footer scroll with its content; verified at 393px and desktop, iPhone web installation retained

- [x] Make Tap card setup comfortable on actual mobile screens — verified touch-enabled 320/390/430px layouts, 44px controls, PIN modes, Cancel, and no horizontal overflow

- [x] Verify uploaded APK `hme-wallet-0.1.202608300600-release-2.apk` — byte-identical to the already-pinned build (md5 `49523ba1…`), nothing new to pin
- [x] Show real app version in Settings, and show the available new version before installing (UpdateCheckCard)
- [x] Stamp versionName/versionCode into Android builds in CI (APKs currently all ship as 1.0/1, breaking native version checks)
- [x] Fix TXC migration so swept funds and later transaction change stay on the main derivation path; verified tx f23581e5b3fbd3ea91963c1f1d1d8930c121ee41ec5168b6818944922a5170c6 was accepted and has one full-balance output
- [x] Pin TXC Receive to the canonical m/44'/696969'/0' branch and persist it as primary so imported-wallet metadata can never issue another fresh old-path address
- [x] Normalize stale encrypted/session TXC primary-path metadata while loading a seed wallet so Settings always reports m/44'/696969'/0' before Receive is opened
- [x] Add Solana chain support with seed-derived address, balance, activity, send, receive, and chain settings

- [x] Tap card (NFC): server card service, owner settings, NectarPay pay endpoint, Telegram approvals, kill + sweep, NectarPay handoff
- [x] Tap card uses reserved HME branch 1107 (card N = m/44'/696969'/1107'/0/N); Trading pocket rotation must skip 1107
- [ ] Tap card: native NFC reading explicitly deferred by Bobby until current release/security work is locked down (no plugin work now)
- [x] APK 0.1.202610181617 pinned and distributed with Vault + session + speed + tap-to-copy fixes
- [ ] Cut APK and extension builds including the Vault EVM token-send fix (needs new release builds)
- [ ] Real-device Vault end-to-end test on a throwaway seed: pair → tiny TXC send → sign by QR → broadcast (needs the new APK + the Vault device)

