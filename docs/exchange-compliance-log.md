# Exchange compliance log

FixedFloat and SideShift require the integrator to retain, for at least one year, the IP address,
User-Agent and browser language list of the person who paid for an exchange order, and to be able
to produce it for a specific exchange on request.

## What we store

Table: `public.exchange_compliance_log` (private — no RLS policies, service role only).

| Column | Meaning |
| --- | --- |
| `provider` | `fixedfloat` or `sideshift` |
| `order_id` | the provider's order / shift id |
| `deposit_address` | address the user paid into |
| `txid` | the user's LTC/DOGE deposit transaction (filled in when tracking starts) |
| `from_coin`, `amount_sats` | what was sent |
| `dest_asset`, `dest_address` | what they receive, and where |
| `ip_address`, `user_agent`, `lang_list` | the required identity fields |
| `created_at`, `purge_after` | written at order creation; purge is `created_at + 13 months` |

Written server-side in `createSwapOrder` (`src/lib/swap-providers/swap.functions.ts`) from
`src/lib/swap-providers/compliance.server.ts`. THORChain orders are not logged — it is a public
AMM, not an exchange partner. Logging failures never block a swap.

## Looking a record up

Ask in chat, e.g. "look up the compliance record for FixedFloat order XYZ", or run in the backend
SQL editor:

```sql
-- by provider order id
select * from public.exchange_compliance_log where order_id = 'ORDER_ID';

-- by the user's deposit transaction id
select * from public.exchange_compliance_log where txid = 'TXID';

-- by deposit address
select * from public.exchange_compliance_log where deposit_address = 'ADDRESS';
```

## Retention

A `pg_cron` job (`purge-exchange-compliance-log`, daily at 03:17 UTC) runs
`public.purge_exchange_compliance_log()`, which deletes every row past `purge_after`. To change the
window, alter the `purge_after` default in a new migration.

Retention is disclosed in the privacy policy under "Exchange swaps (the one exception)".
