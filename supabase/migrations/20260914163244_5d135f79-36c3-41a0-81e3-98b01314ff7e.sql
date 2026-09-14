CREATE TABLE public.exchange_compliance_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  purge_after timestamptz NOT NULL DEFAULT (now() + interval '13 months'),
  provider text NOT NULL,
  order_id text,
  deposit_address text,
  txid text,
  from_coin text NOT NULL,
  amount_sats bigint NOT NULL,
  dest_asset text,
  dest_address text,
  ip_address text,
  user_agent text,
  lang_list text
);

CREATE INDEX exchange_compliance_log_order_idx ON public.exchange_compliance_log (provider, order_id);
CREATE INDEX exchange_compliance_log_txid_idx ON public.exchange_compliance_log (txid);
CREATE INDEX exchange_compliance_log_deposit_idx ON public.exchange_compliance_log (deposit_address);
CREATE INDEX exchange_compliance_log_purge_idx ON public.exchange_compliance_log (purge_after);

GRANT ALL ON public.exchange_compliance_log TO service_role;

ALTER TABLE public.exchange_compliance_log ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.purge_exchange_compliance_log()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE removed integer;
BEGIN
  DELETE FROM public.exchange_compliance_log WHERE purge_after < now();
  GET DIAGNOSTICS removed = ROW_COUNT;
  RETURN removed;
END;
$$;

REVOKE ALL ON FUNCTION public.purge_exchange_compliance_log() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.purge_exchange_compliance_log() TO service_role;

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;

SELECT cron.schedule(
  'purge-exchange-compliance-log',
  '17 3 * * *',
  $$SELECT public.purge_exchange_compliance_log();$$
);