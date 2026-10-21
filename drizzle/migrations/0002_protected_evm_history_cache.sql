CREATE TABLE public.evm_history_cache (
 chain text NOT NULL CHECK (chain IN ('eth','base')),
 address text NOT NULL CHECK (address ~ '^0x[0-9a-f]{40}$'),
 payload jsonb NOT NULL DEFAULT '{"rows":[],"streams":{}}'::jsonb,
 fingerprint text NOT NULL DEFAULT '',
 synced_at timestamptz,
 attempted_at timestamptz,
 lease_token uuid,
 lease_until timestamptz,
 PRIMARY KEY (chain,address)
);
GRANT ALL ON public.evm_history_cache TO service_role;
ALTER TABLE public.evm_history_cache ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role owns public-chain cache" ON public.evm_history_cache FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE FUNCTION public.claim_evm_history_refresh(p_chain text,p_address text,p_fingerprint text,p_force boolean,p_token uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE acquired boolean;
BEGIN
 INSERT INTO public.evm_history_cache(chain,address) VALUES(p_chain,p_address) ON CONFLICT DO NOTHING;
 UPDATE public.evm_history_cache SET lease_token=p_token,lease_until=now()+interval '120 seconds',attempted_at=now()
 WHERE chain=p_chain AND address=p_address
 AND (lease_until IS NULL OR lease_until < now())
 AND (attempted_at IS NULL OR attempted_at <= now()-interval '60 seconds')
 AND (synced_at IS NULL OR synced_at <= now()-interval '10 minutes' OR fingerprint IS DISTINCT FROM p_fingerprint OR p_force OR payload->>'incomplete'='true')
 RETURNING true INTO acquired;
 RETURN coalesce(acquired,false);
END $$;
REVOKE ALL ON FUNCTION public.claim_evm_history_refresh(text,text,text,boolean,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_evm_history_refresh(text,text,text,boolean,uuid) TO service_role;
CREATE FUNCTION public.commit_evm_history_refresh(p_chain text,p_address text,p_token uuid,p_payload jsonb,p_fingerprint text)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE committed boolean;
BEGIN
 UPDATE public.evm_history_cache SET payload=p_payload,fingerprint=p_fingerprint,synced_at=now(),lease_token=NULL,lease_until=NULL
 WHERE chain=p_chain AND address=p_address AND lease_token=p_token AND lease_until>now()
 RETURNING true INTO committed;
 RETURN coalesce(committed,false);
END $$;
REVOKE ALL ON FUNCTION public.commit_evm_history_refresh(text,text,uuid,jsonb,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.commit_evm_history_refresh(text,text,uuid,jsonb,text) TO service_role;