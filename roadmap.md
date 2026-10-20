# Roadmap
- [ ] Security: patched Android runtime, strict ecosystem trust, safe signing, JSON-only proxies, and wallet-preservation regression tests
- [ ] Security: enforce tap-card PINs, actual TSD-based limits, atomic PIN lockout and payment reservation
- [ ] Security: coordinate purpose-specific integration secrets and signed registry with Honest Money/NectarPay/TSD (needs partner rollout)
- [ ] Security: harden swap/bridge approvals, CSP/relay, CI and extension update delivery
- [ ] Security: verify native security changes on installed APK and replace JS-only biometric password retention (needs native device check)
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

