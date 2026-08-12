# TSD Swap / HME Wallet integration handoff

> For: TSD Swap team  
> From: HME Wallet team  
> Date: 2026-08-06  
> Context: HME Wallet in-app TSD → USDC (Ethereum) cash-out

## What we shipped on our side

We added an in-app off-ramp to the HME Wallet’s TSD send flow:

- The feature is **gated behind a user-provided TSD Swap API key**. Users paste their key into wallet Settings; until they do, the feature is completely hidden.
- When enabled, the user can expand a **“Cash out to USDC on Ethereum”** panel on the TSD send screen.
- The wallet calls our server functions, which proxy to your public API at `https://tsd.honest.money` using the user’s key as `x-api-key`.
- We never store the key server-side; it is forwarded per request from the device.
- Once an order is created, the wallet sends the exact TSD amount to the order’s `depositAddress` using the same broadcast path as any other TSD payment.

Implemented endpoints we are using:

1. `GET /api/public/v1/cashout/settings`
2. `POST /api/public/v1/cashout/orders`
3. `GET /api/public/v1/cashout/orders/:id`

## Two things we need your help with

### 1. Confirm the shape of `redeemFeeBps`

We saw the wallet display a 1% fee even though the user expected 0%. We hardened our parser to coerce the field to a number, but we want to confirm the actual type you send:

```json
{
  "live": true,
  "minAmount": 5,
  "maxAmount": 25000,
  "redeemFeeBps": 0
}
```

**Please confirm:**
- Is `redeemFeeBps` returned as an integer number (e.g. `0`, `50`, `100`) or as a string (e.g. `"0"`) in production?
- Are the other numeric order fields (`amountExpected`, `payoutAmount`, `feeBps`) also guaranteed to be numbers, or should we keep coercing them defensively?

If any of these are strings, that is fine — we just need to know so the wallet shows the right fee.

### 2. A reusable “my TSD Swap deposit address” endpoint

Right now the wallet can only get a deposit address by creating an order first. For a cleaner receive flow, we would like to show users a single, persistent deposit address owned by their TSD Swap account.

**Requested endpoint:**

```
GET /api/public/v1/cashout/deposit-address
```

**Auth:** same as today — `x-api-key` header with the user’s key.

**Expected response:**

```json
{
  "address": "T..."
}
```

Requirements:
- Address must be a **legacy `T...` address** (not `txc1...` bech32), because the Omni layer cannot read bech32.
- Address should be stable for the account (same key always returns the same address).
- If the account has no deposit address yet, creating one on demand is fine.

With this endpoint we can add a “Deposit TSD for cash-out” QR code to the receive screen and Settings, so users can prefund their swap account without first creating an order.

## Nice-to-have (not blocking)

- A webhook or SSE stream for order status changes would let us stop polling every ~10 s on the receipt screen. Not required for launch.

## Reference

Our API contract doc: `docs/tsd-cashout-api.md` in this repo.

Let us know if you want a quick call or a shared test key to validate against.
