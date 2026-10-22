# HME Wallet / HME Vault: failed DOGE swap review

Reviewed 2026-10-22. HME Vault read-only snapshot: `1ecccc19`.
Inputs: Bobby's screenshot and accompanying Vault report; both applications' source; current official THORChain documentation.
No order was created, no transaction signed, and no funds broadcast during this review. The screenshot shows a failed signed-transaction extraction; it cannot establish whether another attempt was broadcast.

## Confirmed problems

1. **Wallet constructs THORChain Vault outputs in the wrong order.**
   `src/lib/vault-link/psbt-build.ts` puts OP_RETURN before payment. THORChain requires the Asgard deposit at VOUT0, change to the first input's address in a subsequent output, and memo afterward. `swap.test.ts` currently asserts payment at output 1, so passing tests do not establish correctness.
2. **Wallet uses fresh HD change instead of VIN0.**
   `src/lib/vault-link/swap.ts` derives a new branch-1 change address. THORChain identifies the refund owner through VIN0 and explicitly warns against forwarding change to a new HD address. The shared `refundAddress` field is not passed to THORChain, so it does not override that behavior. Local seed-wallet swap construction already puts the deposit first but also supplies fresh HD change and needs the same protocol-specific correction.
3. **Vault is not swap-aware.**
   Vault's `src/lib/signer/psbt.ts` recognizes Omni Simple Send on TXC/ISK, but other data outputs only produce a warning. Approval can sign DOGE without verifying the memo's USDC destination, network, minimum amount or streaming/affiliate parameters. Comparing returned bytes with our unsigned template protects template integrity, not semantic correctness of the original template.
4. **Vault inherits Bitcoin's extraction fee ceiling.**
   Parsing sets the network but not a per-chain maximumFeeRate; final extraction uses bitcoinjs-lib's default 5,000 base units/vbyte guard. The screenshot's 5,179 DOGE base units/byte crosses it. Displayed fee is approximately 0.01585 DOGE, not BTC. The exact failing PSBT was not supplied, so its final size/fee calculation was not independently reproduced. A tiny fraction of a large payment alone does not prove a fee rate is reasonable.
5. **Wallet's last-moment checks are incomplete.**
   Orders are freshly quoted and expiry is checked before preparation and after scan-back, but there is no fresh inbound-address/halt check immediately before broadcast. Expiry checks are conditional on a truthy supplied value. Fee selection uses half-hour estimates rather than checked THORChain next-block recommendations.
6. **Refund can look like successful payout.**
   `thornode.server.ts` treats any nonzero outbound transaction as payout, ignoring the available refund flag. Provider normalization drops outbound chain. The UI can label a DOGE refund as complete USDC delivery and link it to the wrong explorer. Outbound broadcast is not proof of confirmed receipt.

## Required coordinated changes

### Wallet responsibilities

- Use an explicit THORChain policy, not a global PSBT behavior change: deposit first, owned change back to the exact first input address with matching output derivation, then memo. Freeze ordered inputs through review, signing and broadcast.
- Keep Omni's existing intended ordering separate. Do not impose THORChain rules on FixedFloat/SideShift deposits.
- Validate provider response fields and bind destination asset/network/address, amount, refund owner, minimum output, streaming and affiliate parameters to the actual memo and outputs.
- Keep memos over 80 bytes blocked until both apps implement and review the complete chain-specific encoding; never truncate or silently add unreviewed carrier outputs.
- Retain exact ordered input/output/sequence/version/locktime comparison of signed results.
- Immediately before broadcast, fail closed on stale/missing expiry, unavailable freshness checks, changed inbound address, relevant network halt, invalid dust or insufficient checked fee recommendation. A changed transaction requires rebuilding and fresh approval, never editing signed bytes.
- Retain recoverable pending transaction context before attempting broadcast, and distinguish broadcast uncertainty from an unsent transaction.
- Track payout and refund independently, preserving chain, transaction IDs, recipient, asset, amount and reason. Verify actual delivery before claiming completion.

### Vault responsibilities / requested agreement

- Add strict readable THORChain review bound to the real PSBT: DOGE/LTC sent, deposit, owned refund address, exact destination network/token/address, minimum output, streaming/affiliate parameters and network fee.
- Reject unsupported/malformed swap instructions instead of routing them through a generic unreadable-data warning.
- Distinguish verified transaction facts from online claims: offline Vault cannot establish live Asgard address, pool availability, quote freshness or destination delivery merely by reading QR data.
- Define a jointly versioned swap request/capability contract so old Vault versions cannot accidentally sign an unsupported swap as a generic PSBT. Metadata alone is not authentication or proof of protocol validity.
- Replace inherited Bitcoin-only fee assumptions with independently reviewed chain-specific absolute/rate limits and clear units; do not disable all extraction checks or globally raise ceilings to bypass this error.

## Acceptance before real funds

- Shared fixtures: DOGE legacy with full verified previous transaction, LTC supported input forms, output ordering, actual VIN0 change derivation, zero-change behavior, memo length limits and decoded minimum/recipient/network.
- Hostile fixtures: mutated deposit, payout, token, refund owner, limit, memo, inputs, change, fee and expiry; stale/rotated inbound address; failed availability checks; malformed or unsupported instructions; old signer capability.
- Fee-boundary tests around reviewed per-chain limits and Bobby's observed 5,179 base units/byte case.
- Refund fixture must never display USDC completion; use the source-chain explorer and continue tracking refund delivery.
- Device QR round-trip with disposable test keys; then a separately approved small funded swap above the live minimum, including delivery read-back. Do not use 100,000 DOGE as the first acceptance test.

## Verification performed

`bunx vitest run src/lib/vault-link/swap.test.ts src/lib/vault-link/vault-link.test.ts src/lib/thorchain/thornode.server.test.ts`: 18 tests passed. This establishes existing behavior only; the swap test currently preserves the wrong output order.

HME Vault was inspected via read-only cross-project checkout, not changed or messaged through a remote application interface. No HME Vault MCP interface was advertised when queried.

## Sources

- https://dev.thorchain.org/concepts/sending-transactions.html
- https://dev.thorchain.org/swap-guide/quickstart-guide.html
- https://dev.thorchain.org/concepts/memos.html
- Vault `docs/offline-signing-handoff.md` and `src/lib/signer/psbt.ts`
- Wallet `src/lib/vault-link/{swap,psbt-build}.ts`, `src/components/wallet/UtxoSwap.tsx`, `src/lib/thorchain/thornode.server.ts` and `src/lib/swap-providers/registry.server.ts`