# TSD cash-out API (wallet → TSD Swap)

The HME wallet offers "Cash out to USDC on Ethereum" on the TSD send screen.
It needs four public endpoints on **TSD Swap** (`https://tsd.honest.money`).
These are thin, key-authenticated wrappers around the existing redeem flow
(`createRedeemOrder`, `previewCouponCode`, `getPublicBridgeSettings`,
`getBridgeOrder`).

Wallet-side config (server-only env vars):

- `TSD_SWAP_URL` — base URL, defaults to `https://tsd.honest.money`
- `TSD_CASHOUT_API_KEY` — sent as `x-api-key` when present

All requests come from the wallet's server, never from the device.

## 1. `GET /api/public/v1/cashout/settings`

```json
{ "live": true, "minAmount": 5, "maxAmount": 25000, "redeemFeeBps": 100 }
```

## 2. `POST /api/public/v1/cashout/coupon`

Request: `{ "code": "TEXIT100" }`

```json
{ "valid": true, "code": "TEXIT100", "redeemFeeBps": 0, "reason": null }
```

Must not consume a use — preview only. Per-account permanent discount codes
should validate here too (unlimited uses, bound to the account).

## 3. `POST /api/public/v1/cashout/orders`

Request:

```json
{
  "amount": 250,
  "payoutAddress": "0x…40 hex",
  "refundAddress": "T…",
  "couponCode": "TEXIT100",
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
  "feeBps": 100,
  "payoutAmount": 247.5,
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

## 4. `GET /api/public/v1/cashout/orders/:id`

Same order shape. The wallet polls this on the receipt screen every ~10s until
a terminal status.

Statuses the wallet understands:
`awaiting_deposit`, `detected`, `paying`, `released`, `refunded`, `expired`,
`failed`. Anything else renders as "In progress".

## Errors

Non-2xx with `{ "error": "human readable" }`. The wallet surfaces the string
verbatim. A `404` is treated as "service not deployed yet" and the panel shows
an unavailable message instead of a hard failure.
