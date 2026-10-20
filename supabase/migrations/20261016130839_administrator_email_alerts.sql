-- Transactional outbox: no network request can block report/photo persistence.
CREATE TABLE public.pp_email_outbox(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), report_id uuid NOT NULL REFERENCES public.pp_reports(id) ON DELETE CASCADE,
 event_key text NOT NULL UNIQUE, kind text NOT NULL CHECK(kind IN ('report','photo')),
 state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','running','retry','sent','failed','uncertain')),
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 5),
 available_at timestamptz NOT NULL DEFAULT now(), lease uuid, lease_until timestamptz,
 first_attempt_at timestamptz, provider_id text, error_code text, created_at timestamptz NOT NULL DEFAULT now(), sent_at timestamptz
);
CREATE INDEX pp_email_outbox_due ON public.pp_email_outbox(available_at) WHERE state IN ('pending','running','retry');
ALTER TABLE public.pp_email_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pp_email_outbox FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.pp_email_outbox FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.pp_email_outbox TO service_role;
CREATE FUNCTION public.pp_email_enqueue() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 IF TG_TABLE_NAME='pp_reports' THEN
 INSERT INTO public.pp_email_outbox(report_id,event_key,kind) VALUES(NEW.id,'report:'||NEW.id,'report') ON CONFLICT DO NOTHING;
 ELSE
 INSERT INTO public.pp_email_outbox(report_id,event_key,kind) VALUES(NEW.report_id,'photo:'||NEW.id,'photo') ON CONFLICT DO NOTHING;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.pp_email_enqueue() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.pp_email_enqueue() TO service_role;
CREATE TRIGGER pp_report_email AFTER INSERT ON public.pp_reports FOR EACH ROW EXECUTE FUNCTION public.pp_email_enqueue();
CREATE TRIGGER pp_photo_email AFTER INSERT ON public.pp_photos FOR EACH ROW EXECUTE FUNCTION public.pp_email_enqueue();
CREATE FUNCTION public.pp_email_claim() RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE j public.pp_email_outbox;
BEGIN
 -- Provider idempotency lasts 24h. Never automatically resend an ambiguous job
 -- beyond a shorter 20h window from its first request.
 UPDATE public.pp_email_outbox SET state='uncertain',lease=NULL,lease_until=NULL,error_code='review_required'
 WHERE state IN ('pending','running','retry') AND first_attempt_at<now()-interval '20 hours';
 UPDATE public.pp_email_outbox SET state='failed',lease=NULL,lease_until=NULL,error_code='attempt_limit'
 WHERE state='running' AND lease_until<now() AND attempts>=5;
 SELECT * INTO j FROM public.pp_email_outbox WHERE attempts<5 AND
 ((state IN ('pending','retry') AND available_at<=now()) OR (state='running' AND lease_until<now()))
 ORDER BY available_at,id FOR UPDATE SKIP LOCKED LIMIT 1;
 IF NOT FOUND THEN RETURN NULL; END IF;
 UPDATE public.pp_email_outbox SET state='running',attempts=attempts+1,lease=gen_random_uuid(),lease_until=now()+interval '2 minutes',first_attempt_at=coalesce(first_attempt_at,now()) WHERE id=j.id RETURNING * INTO j;
 RETURN jsonb_build_object('id',j.id,'reportId',j.report_id,'kind',j.kind,'lease',j.lease);
END $$;
CREATE FUNCTION public.pp_email_finish(p_id uuid,p_lease uuid,p_provider_id text,p_error text,p_retry boolean) RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE j public.pp_email_outbox;
BEGIN
 SELECT * INTO j FROM public.pp_email_outbox WHERE id=p_id FOR UPDATE;
 IF NOT FOUND OR j.state<>'running' OR j.lease IS DISTINCT FROM p_lease OR j.lease_until<now() THEN RETURN false; END IF;
 IF p_error IS NULL THEN
 IF p_provider_id IS NULL OR length(p_provider_id) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'invalid_provider_id' USING ERRCODE='22023';END IF;
 UPDATE public.pp_email_outbox SET state='sent',sent_at=now(),provider_id=p_provider_id,error_code=NULL,lease=NULL,lease_until=NULL WHERE id=j.id;
 ELSE
 IF p_error NOT IN ('provider_unavailable','provider_rate_limit','configuration_error','invalid_response') THEN RAISE EXCEPTION 'invalid_error' USING ERRCODE='22023'; END IF;
 UPDATE public.pp_email_outbox SET state=CASE WHEN p_retry AND attempts<5 THEN 'retry' ELSE 'failed' END,error_code=p_error,available_at=now()+make_interval(secs=>60*(2^j.attempts)::integer),lease=NULL,lease_until=NULL WHERE id=j.id;
 END IF;
 RETURN true;
END $$;
CREATE FUNCTION public.pp_email_status(p_subject text) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 PERFORM public.pp_admin_dispatch('admin_session',p_subject,'{}');
 RETURN jsonb_build_object('queued',(SELECT count(*) FROM public.pp_email_outbox WHERE state IN ('pending','retry','running')),
 'failed',(SELECT count(*) FROM public.pp_email_outbox WHERE state IN ('failed','uncertain')),
 'last_sent',(SELECT max(sent_at) FROM public.pp_email_outbox));
END $$;
REVOKE ALL ON FUNCTION public.pp_email_claim(),public.pp_email_finish(uuid,uuid,text,text,boolean),public.pp_email_status(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.pp_email_claim(),public.pp_email_finish(uuid,uuid,text,text,boolean),public.pp_email_status(text) TO service_role;
CREATE FUNCTION pp_private.email_config() RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object('apiKey',coalesce((SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='pp_resend_api_key'),''),
 'from',coalesce((SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='pp_email_from'),''),
 'enabled',coalesce((SELECT decrypted_secret='true' FROM vault.decrypted_secrets WHERE name='pp_email_enabled'),false));
$$;
REVOKE ALL ON FUNCTION pp_private.email_config() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION pp_private.email_config() TO service_role;
CREATE FUNCTION public.pp_email_config() RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT pp_private.email_config(); $$;
REVOKE ALL ON FUNCTION public.pp_email_config() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.pp_email_config() TO service_role;
