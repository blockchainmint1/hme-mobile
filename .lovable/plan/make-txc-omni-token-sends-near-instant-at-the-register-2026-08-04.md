# Make TXC / Omni token sends near-instant at the register

Today a TSD send at a merchant terminal can take 10-30+ seconds. None of that is
the TEXITcoin network — it's work the wallet does before and between broadcasts.
Every one of those safeguards was added to fix a real bug, so the plan keeps the
protection but pays for it in the background instead of at the point of sale.

## Where the time actually goes

```text
tap Send
  |-- biometric confirm                      ~1s
  |-- FULL account re-scan (6 paths)         5-20s   <-- worst offender
  |     address stats, one HTTP call at a time
  |     UTXO fetch, one address at a time
  |     prev-tx hex for every legacy input, one at a time
  |-- broadcast funding tx (holder has no TXC)  1-3s <-- second offender
  |-- build + sign + broadcast Omni tx          1-3s
```

## Fix 1 — replace the pre-broadcast full re-scan with a spent-check

The re-scan exists to catch `inputs-missingorspent` / `txn-mempool-conflict`
from coins spent elsewhere. It answers that question by rebuilding the whole
account when all it needs to know is "are these 1-3 specific coins still
unspent?"

Replace it with a parallel `GET /tx/{txid}/outspend/{vout}` for exactly the
inputs being spent. Same guarantee, 1-3 concurrent calls instead of 40+, and
it stays a hard block: if any input is spent, we bounce back to the form with
the existing message.

## Fix 2 — never need a funding transaction at checkout

Omni takes the sender from the first input, so a token-holding address with no
TXC forces us to broadcast a funding tx and chain onto it. Instead of removing
that (it's correct), make it never fire in the shop:

- After every token send we already return TXC change to the holder address.
  Extend that: keep a target reserve on any address holding an enabled token.
- Add a background "top-up" check on wallet load and after each refresh: if a
  token-holding address is below the reserve, fund it quietly then, while the
  user isn't waiting on a cashier.
- Keep the existing at-send funding path as the fallback for the first-ever
  send from a freshly received holder address.

## Fix 3 — make the scan itself fast (helps every screen)

- Parallelize the address walks. `scanChainFast` and `collect` currently
  `await` one address at a time; batch them (concurrency ~8).
- Cache `getTxHex` prev-tx hex. It is immutable per txid, so cache it in
  IndexedDB/localStorage and never re-fetch. Legacy (T…) wallets pay this cost
  on every single refresh today.
- Cache derived scripts per address instead of recomputing.

## Fix 4 — warm the send screen

When the send form is open with a valid address and amount, pre-fetch the fee
estimate and pre-validate the selected coins so the tap on "Send" only has to
sign and broadcast.

## Fix 5 — make the wait legible

Replace the single "Broadcasting…" label with the real step: "Checking coins…"
→ "Funding address…" → "Sending TSD…" → done. Even when it is fast, the
cashier and customer can see it moving.

## Expected result

Typical in-person TSD payment drops to roughly: biometric + ~1 concurrent
spent-check round trip + one broadcast — about 1-2 seconds, with the funding tx
gone from the critical path entirely.

## Technical notes

- `src/lib/txc/mempool.ts`: add `getOutspend(txid, vout)` and a cached
  `getTxHexCached`.
- `src/routes/wallet.send.tsx`: swap `account.refetch()` in `send()` for the
  targeted outspend check; add staged progress labels.
- `src/lib/txc/scan.ts`: bounded-concurrency batching in `scanChainFast`,
  `scanChain`, and `collect`; use the cached prev-tx hex.
- New `src/lib/txc/topup.ts`: reserve policy + background top-up for
  token-holding addresses, invoked from the wallet dashboard refresh.
- No change to fee flooring (10 sat/vB), dust rules, or the bech32 block for
  Omni destinations.
