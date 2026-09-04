# TSD Swap ⇄ wallet account link (v1)

The wallet **scans** a QR code shown on the TSD Swap profile page (or the user
pastes the same URL). TSD Swap is the issuer; the wallet is the responder.

## 1. QR payload

An absolute `https://` URL on a trusted host (`tsd.honest.money`,
`app.tsdswap.com`) that serves the link manifest as JSON:

```json
{
  "v": 1,
  "type": "tsd-link-xpub",
  "challenge_id": "c_abc123",
  "from": "tsd.honest.money",
  "manifest_url": "https://tsd.honest.money/api/public/v1/link/c_abc123",
  "callback_url": "https://tsd.honest.money/api/public/v1/link/c_abc123/claim",
  "exp": 1757000000,
  "account_id": "acct_123",
  "account_name": "Bobby's TSD account"
}
```

`manifest_url` must equal the scanned URL; manifest and callback must share an
origin. Expired links are rejected client-side.

## 2. Claim (POST `callback_url`)

```json
{
  "payload": {
    "v": 1,
    "type": "tsd-link-xpub",
    "challenge_id": "c_abc123",
    "callback_url": "https://tsd.honest.money/api/public/v1/link/c_abc123/claim",
    "xpub": "xpub…",
    "path": "m/44'/696969'/0'",
    "identity": "T…",
    "evm_address": "0x…",
    "exp": 1757000000,
    "issued_at": "2026-09-04T10:00:00.000Z"
  },
  "signature": "<base64 compact BIP-137>",
  "address": "T…"
}
```

Verification on the TSD Swap side:

1. Recompute canonical JSON of `payload` (sorted keys, no whitespace) and
   verify `signature` against `address` using the TEXITcoin message prefix
   (`\x1aTEXITcoin Signed Message:\n`).
2. `address` must equal `payload.identity`, and must derive from
   `payload.xpub` at `0/0` (legacy P2PKH).
3. `challenge_id` must be unopened and unexpired; single use.
4. Store the xpub watch-only. Derive both branches with a gap limit of 20 and
   sum Omni property 39 (TSD) daily for average-daily-balance rewards.

Respond `200` with `{ "account_id": "...", "account_name": "..." }`.

Only public key material is shared: no seed, no private keys, no spending
authority.
