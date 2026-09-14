REVOKE ALL ON FUNCTION public.purge_exchange_compliance_log() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.purge_exchange_compliance_log() FROM anon;
REVOKE ALL ON FUNCTION public.purge_exchange_compliance_log() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.purge_exchange_compliance_log() TO service_role;