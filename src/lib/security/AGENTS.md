# Security boundaries
- Never change wallet storage keys, active profiles, Android app ID or WebView hostname for security migrations; reauthentication is read-only because existing wallets must survive updates.
- Spending sites require exact membership in a fresh server-verified registry; offline labels and hosting-provider patterns are not authorization.
- External EIP-712 signing stays disabled pending semantic review; EVM personal_sign accepts only domain/chain/account/time-bound SIWE because an opaque signature can spend tokens.
- Generic sign-message refuses authorization templates; dedicated protocol flows provide domain/intent validation.
- Partner proxies reject redirects/HTML and bound streamed body sizes; arbitrary relay bodies are not supported because the wallet origin must not execute remote documents.
- LI.FI execution stays paused until the acceptance steps in the swap review pass; quote APIs are not spending authorities. The Relay Tron bridge was removed on 2026-10-21; do not reintroduce a bridge without a calldata validator and hostile-quote tests.
- Biometric unlock may only release the password through an Android Keystore key bound to a strong biometric (native HmeBiometricVault plugin via scripts/android); never store a reusable password behind a JS-only prompt. Why: the OS, not app code, must gate the secret.
- Honest Money's newly issued per-site HME_ECOSYSTEM authenticates registry/Hub calls; it is not the retired shared key. Partner payment/notification credentials still need coordinated directional rollout; asymmetric registry remains outstanding.