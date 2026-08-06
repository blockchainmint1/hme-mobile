# TSD cash-out API (wallet → TSD Swap)

The HME wallet offers "Cash out to USDC on Ethereum" on the TSD send screen.
The feature is **off until the user pastes their own TSD Swap API key** into
wallet Settings, so only people with a TSD Swap account can redeem from the
wallet.

Three public endpoints on **TSD Swap** (`https://tsd.honest.money`), all
authenticated with the *user's* key as `x-api-key`. The key identifies the
account, so TSD Swap decides the fee tier (1% / 0.5% / 0%) — the wallet has no
coupon field and quotes only what `settings` reports.

Wallet-side config (server-only): `TSD_SWAP_URL`, defaults to
`https://tsd.honest.money`. Requests always leave from the wallet's server, not
the device; the key is forwarded per request and never stored server-side.

## 1. `GET /api/public/v1/cashout/settings`

```json
{ "live": true, "minAmount": 5, "maxAmount": 25000, "redeemFeeBps": 50 }
```

`redeemFeeBps` must be the **fee for the account that owns the key**.

## 2. `POST /api/public/v1/cashout/orders`

Request:

```json
{
  "amount": 250,
  "payoutAddress": "0x…40 hex",
  "refundAddress": "T…",
  "source": "hme-wallet"
}
```

`refundAddress` is the user's own legacy TEXITcoin address. **Refunds go back
there** — wrong amount, expired order, or failed payout.

Response:

```json
{
  "id": "…",
  "status": "awaiting_deposit",
  "depositAddress": "T…",
  "amountExpected": 250,
  "feeBps": 50,
  "payoutAmount": 248.75,
  "payoutAddress": "0x…",
  "refundAddress": "T…",
  "expiresAt": "2026-08-06T03:00:00Z",
  "releaseTxHash": null,
  "refundTxid": null,
  "error": null
}
```

`depositAddress` **must be a legacy `T…` address** — the Omni layer cannot
read `txc1…` bech32, so a segwit inbox would strand the tokens.

## 3. `GET /api/public/v1/cashout/orders/:id`

Same order shape, scoped to the key that created it. The wallet polls this on
the receipt screen every ~10s until a terminal status.

Statuses the wallet understands:
`awaiting_deposit`, `detected`, `paying`, `released`, `refunded`, `expired`,
`failed`. Anything else renders as "In progress".

## Errors

Non-2xx with `{ "error": "human readable" }`. The wallet surfaces the string
verbatim, except: `401`/`403` becomes "Your TSD Swap API key was rejected.
Check it in Settings," and `404` becomes "service not available yet."
