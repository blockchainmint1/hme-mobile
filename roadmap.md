# Roadmap
- [ ] Filter counterfeit outgoing token events using contract identity without hiding genuine sends; verify Bobby's fake 110,000 USDC example and reveal controls.
- [x] Add default-on device-wide suspicious activity filtering with reveal controls and accurate tiny amounts; 15 tests pass, device toggle and persistence verified in an unlocked throwaway wallet, saved wallets/token preferences untouched.
- [x] Security: patched Android runtime, strict spending-site trust, SIWE-only EVM signing, JSON-only partner proxies, bounded relay schemas and wallet-preservation regression tests
- [x] Security: enforce tap-card PINs and actual TSD-based limits; applied database row-lock guards for PIN lockout/payment reservation; runtime card concurrency checks still need funded partner test
- [ ] Security: configure dedicated HME_SITE_API_KEY + HME_SITE_CODE with trusted-sites:read/activity:write permissions; restore registry/attribution (needs Honest Money credential). Coordinate directional NectarPay/card and TSD_NOTIFY_SIGNING_KEY credentials plus asymmetric signing (needs partner rollout)
- [x] Security containment: pause unverified LI.FI/Relay spending, restrict image destinations, remove unsafe keystore generator, pin CI actions and separate publish permissions
- [ ] Security: restore swaps/bridge after independently verified per-chain deployment/calldata specs; nonce-based CSP for server AND packaged shells (needs reviewed contracts and validated native shell signing-policy design)
- [ ] Security: privately test new APK/extension, PIN card concurrency and full Vault sends; biometric password storage disabled until OS-gated retrieval passes device tests (needs release builds/devices)
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
- [ ] Tap card: native NFC reading in the APK (needs NFC plugin + new APK build)
- [x] APK 0.1.202610181617 pinned and distributed with Vault + session + speed + tap-to-copy fixes
- [ ] Cut APK and extension builds including the Vault EVM token-send fix (needs new release builds)
- [ ] Real-device Vault end-to-end test on a throwaway seed: pair → tiny TXC send → sign by QR → broadcast (needs the new APK + the Vault device)

