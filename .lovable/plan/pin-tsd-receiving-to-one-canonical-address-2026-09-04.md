# Pin TSD receiving to one canonical address

## The answers first

**What happens today when TSD lands on a derived address?** Nothing breaks — the account scan walks every derivation branch, so the tokens are discovered, counted in the TSD balance, and spendable. The only wrinkle is Omni's rule that a token send must come from a single address: if TSD is scattered across several addresses, a large send fails with "consolidate first" and the user visits the Consolidate screen. We deliberately do **not** auto-sweep (it costs fees and moves funds without consent).

**Should TSD default to one address?** Yes. TXC keeps rotating addresses for privacy, but Omni tokens stick to whichever address received them — so funneling TSD to one canonical address (`m/44'/696969'/0'/0/0`, the legacy `T…` address at index 0) keeps the balance pooled and always spendable in one transaction.

## Changes

1. **Canonical TSD deposit address helper** (`src/lib/txc/tokens.ts` or `wallet.ts`): `getTsdDepositAddress(root)` → `deriveAddress(root, "bip44", 0, 0)`. One source of truth, reused everywhere.

2. **Receive screen gets an asset toggle** (`src/routes/wallet.receive.tsx`):
   - Default stays TXC (rotating addresses, unchanged).
   - New "TSD (token)" option shows the pinned index-0 address with QR, and a short explainer: "Omni tokens stay on the address they were sent to — using this one address keeps your TSD spendable in a single send. Old addresses still work; anything sent to them still counts."
   - Supports `?asset=tsd` search param so other screens can deep-link straight to it.

3. **"Receive TSD" from the token UI**: the TSD row in the home TXC-tokens section (and/or the Send TSD screen header) gets a Receive button linking to `/wallet/receive?asset=tsd`. This is the "preferred receive address" function on the TSD card.

4. **Consolidate screen target fix** (`src/routes/wallet.txc.consolidate.tsx`): sweep into the pinned index-0 address instead of the rotating `nextReceiveAddress`, so consolidation pools tokens at the same address the receive screen hands out.

## Out of scope

- No automatic sweeping of derived-address balances.
- No change to TXC address rotation or the migration sweep logic.

## Verification

- Type-check + build OK.
- Preview: receive screen toggle shows the same `T…` address every time for TSD; TXC still rotates; consolidate screen targets the pinned address.
