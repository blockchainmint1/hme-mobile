# Security boundaries
- Never change wallet storage keys, active profiles, Android app ID or WebView hostname for security migrations; reauthentication is read-only because existing wallets must survive updates.
- Spending sites require exact membership in a fresh server-verified registry; offline labels and hosting-provider patterns are not authorization.
- External EIP-712 signing stays disabled pending semantic review; EVM personal_sign accepts only domain/chain/account/time-bound SIWE because an opaque signature can spend tokens.
- Generic sign-message refuses authorization templates; dedicated protocol flows provide domain/intent validation.
- Partner proxies reject redirects/HTML and bound streamed body sizes; arbitrary relay bodies are not supported because the wallet origin must not execute remote documents.
- LI.FI execution stays paused until the acceptance steps in the swap review pass; quote APIs are not spending authorities. The Relay Tron bridge was removed on 2026-10-21; do not reintroduce a bridge without a calldata validator and hostile-quote tests.
- Biometric unlock may only release the password through an Android Keystore key bound to a strong biometric (native HmeBiometricVault plugin via scripts/android); never store a reusable password behind a JS-only prompt. Why: the OS, not app code, must gate the secret.
- Honest Money's newly issued per-site HME_ECOSYSTEM authenticates registry/Hub calls; it is not the retired shared key. Partner payment/notification credentials still need coordinated directional rollout; asymmetric registry remains outstanding.
# Known and accepted (deliberate, not oversights; reviewers: do not re-flag as new findings)
- Android signing certificate is not rotated after the July keystore workflow; rotation breaks install-over and wipes wallets, and no exposure was found.
- Old shared partner secrets are retired via coordinated per-partner rollout, never a blind swap; why: NectarPay card taps and TSD notify would break mid-payment.
- Tap-card pocket keys live encrypted on our backend by design (Option B); blast radius is one small, limited, PIN- and Telegram-gated pocket on branch 1107.
- Exchange audit records keep IP/User-Agent/language 13 months for SideShift/FixedFloat compliance only; ordinary wallet activity is never logged.
- LI.FI swaps stay paused and the Relay Tron bridge stays removed until the review acceptance steps pass; this is intentional, not broken.
- EIP-712 signing stays off and nonce-based CSP is deferred for the packaged APK/extension shells until a signed-shell design is reviewed.
- Native NFC card reading and native iOS are intentionally out of scope; typed card codes and iPhone web install remain.
