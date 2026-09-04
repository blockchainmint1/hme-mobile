# TSD rewards xpub link (wallet → TSD Swap)

Rewards are based on how much TSD a user holds. TSD is an Omni Layer token, so
its balance is pinned to whichever address received it — a wallet's TSD can sit
across several derived addresses. The wallet deliberately does **not** sweep
those balances into one address: that costs TXC fees and moves user funds for
our accounting convenience, and it can't happen while the app is closed.

Instead the user links the **watch-only** account key for the TEXITcoin legacy
branch. TSD Swap derives the same addresses and sums the balance on its own
schedule, so average daily holdings are accurate across every address.

Public key material only. No seed, no private key, no spending authority.

Auth is the same as cash-out (see `docs/tsd-cashout-api.md`): the user's own
TSD Swap API key, forwarded server-side as `x-api-key`. Wallet-side config:
`TSD_SWAP_URL`, defaults to `https://tsd.honest.money`.

## `POST /api/public/v1/rewards/xpub`

Request:

```json
{
  "payload": {
    "v": 1,
    "type": "tsd-rewards-xpub",
    "xpub": "…",
    "path": "m/44'/696969'/0'",
    "identity": "T…",
    "issued_at": "2026-09-04T08:00:00.000Z"
  },
  "signature": "base64 compact signature (65 bytes)",
  "address": "T…"
}
```

Response:

```json
{ "ok": true, "linkedAt": "2026-09-04T08:00:01.000Z" }
```

### Verification on the TSD Swap side

1. `address` must equal `payload.identity`.
2. The signature is BIP-137 over the **canonical JSON** of `payload` (keys
   sorted, no whitespace — the same encoding used by the Nectar Pay link), with
   the TEXITcoin message prefix `\x1aTEXITcoin Signed Message:\n`.
3. Recover the public key and confirm it rebuilds `address` as a legacy P2PKH
   TEXITcoin address.
4. Confirm `address` is `payload.xpub` derived at `0/0` — this proves the
   signer owns the account key, not just some address.
5. Reject `issued_at` older than a few minutes to prevent replay.

### Balance scanning

Derive `payload.xpub` over both branches (`0/*` receive and `1/*` change) with
a standard gap limit (20 is enough; the wallet also scans the legacy `0'`
paths, so a wider gap is safer), then sum the Omni property 39 (TSD) balance
across all of them. Record the daily snapshot for the average-balance reward
calculation.

## `DELETE /api/public/v1/rewards/xpub`

Authenticated with `x-api-key`. Removes the stored key for that account. The
wallet also clears its local record; unlinking must always succeed on the
device even if the call fails.
