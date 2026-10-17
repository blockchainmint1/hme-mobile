# Vault-type wallet: offline signing via HME Vault + QR

## What I found in HME Vault

Good news: Vault already has a complete, documented offline-signing protocol
(`docs/offline-signing-handoff.md`). We don't need to invent anything — we
implement the "online wallet" half of their spec:

- **Pairing (watch-only export):** Vault shows a QR with JSON `{"hmvault":1, "fp":…, "txc":{44/49/84 xpubs}, "isk":…, "btc":…, "ltc":…, "doge":…, "evm":{address,path}}`. Account xpubs use standard xpub version bytes on all coins; no xprv is ever exported.
- **Signing requests:** Bitcoin-family (TXC, ISK, BTC, LTC, DOGE) uses BIP-174 PSBT (base64/hex QR). EVM uses a strict JSON intent (`format:"hm-evm-tx", v:1`) — native and ERC-20 transfers only, no arbitrary calldata.
- **PSBT requirements:** every input needs `bip32Derivation` (master fingerprint, path, pubkey) plus the previous output (full nonWitnessUtxo for legacy; witnessUtxo allowed for segwit). SIGHASH_ALL only, no multisig/taproot. Change outputs should carry bip32Derivation or they display as payments.
- **QR transport:** single QR if it fits; long payloads use animated `HMQR2:<tag>:<n>/<total>:<chunk>` frames (600 chars each). Vault returns the signed raw transaction hex by QR; we broadcast.
- User picks the network on the Vault side before scanning (PSBT has no chain ID), so our send screen must tell the user which network to select.

## What we build here (wallet side)

**1. New wallet type "Vault" in the profile/wallet system**
- Add a `vault` mode alongside seed/keyonly profiles. A Vault wallet stores: fingerprint, per-chain account xpubs, EVM address+path — watch-only data only. No seed, no private keys, nothing spendable is ever stored.
- Creation flow: "Add wallet → Vault (offline signing)" → scan the Vault pairing QR (camera or paste) → we validate the JSON, derive and show the first address per chain for the user to confirm against Vault's screen → save as a new profile labeled e.g. "Vault".
- Switching to it works like any profile, but tiles show a "Vault · signs by QR" badge and Send behaves differently (below).

**2. QR signing transport (shared module)**
- Copy Vault's `HMQR2` framing logic (chunking + animated display + PartCollector for scanning) into `src/lib/vault-link/qr-parts.ts` so both apps speak identical framing.
- Animated QR display component for showing PSBT/EVM intents; scanner flow for reading the signed result back (reusing our existing QrScanButton scanner).

**3. PSBT construction for TXC/ISK/BTC/LTC/DOGE**
- New `src/lib/vault-link/psbt-build.ts`: builds an unsigned PSBT from our existing send-form inputs (recipient, amount, fee, UTXOs from our current chain scans) with correct `bip32Derivation` and nonWitnessUtxo/witnessUtxo per Vault's rules, including change-output derivation.
- TXC Omni Simple Send (TSD) outputs included so Vault displays TSD amounts.

**4. EVM intent construction**
- New `src/lib/vault-link/evm-intent.ts`: builds the `hm-evm-tx` JSON (native + ERC-20 transfer) with nonce/gas from our existing EVM code, chainId, fingerprint and path.

**5. Vault send flow (replaces normal Send for vault profiles)**
- Send form stays the same. At "Review & send", instead of signing locally we show the animated QR + instruction ("On your Vault device: choose TXC, then Scan").
- Then a scanner opens to read the signed transaction back; we verify it (txid, outputs match what we built) and broadcast through the existing chain code.
- Receive, history, balances, watch-only behavior all reuse the existing watch-only/xpub plumbing.

**6. Settings**
- Vault wallet detail sheet: show fingerprint, paired chains, "Re-pair / update keys" (rescan pairing QR), and remove.

## What we deliberately do NOT touch

- Existing seed/keyonly profiles, storage format, encryption, unlock flow — untouched. Vault is an additional profile type.
- No changes to normal send paths for seed wallets.
- No seeds or private keys ever leave Vault; we never ask for an xprv.

## Out of scope for v1 (Vault rejects these anyway)

Multisig, Taproot, message signing, EVM contract interactions/approvals, ZCU native (EVM-path chains work if Vault adds them), Send-To-Many.

## Verification

- Unit tests: pairing JSON parse/validate, HMQR2 round-trip, PSBT build matches Vault's acceptance rules (fingerprint/path/prevout checks), EVM intent schema.
- End-to-end with the real Vault app on a throwaway seed: pair → derive matching addresses → sign a small TXC and TSD send → broadcast.
