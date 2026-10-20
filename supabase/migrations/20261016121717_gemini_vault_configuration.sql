-- Vault-backed fallback when Edge secret management is unavailable to the connector.
-- The credential reader is private and callable only by the trusted service role.
CREATE SCHEMA IF NOT EXISTS pp_private;
REVOKE ALL ON SCHEMA pp_private FROM PUBLIC,anon,authenticated;
GRANT USAGE ON SCHEMA pp_private TO service_role;
CREATE FUNCTION pp_private.ai_config() RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object(
 'apiKey',coalesce((SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='pp_gemini_api_key'),''),
 'model',coalesce((SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='pp_gemini_model'),''),
 'enabled',coalesce((SELECT decrypted_secret='true' FROM vault.decrypted_secrets WHERE name='pp_gemini_enabled'),false));
$$;
REVOKE ALL ON FUNCTION pp_private.ai_config() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION pp_private.ai_config() TO service_role;
CREATE FUNCTION public.pp_ai_config() RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
 SELECT pp_private.ai_config();
$$;
REVOKE ALL ON FUNCTION public.pp_ai_config() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.pp_ai_config() TO service_role;
