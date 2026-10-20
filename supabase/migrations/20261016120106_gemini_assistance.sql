-- Gemini can write suggestions only; publication and resolution remain in pp_admin_dispatch.
CREATE TABLE public.pp_ai_jobs(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), report_id uuid NOT NULL REFERENCES public.pp_reports(id),
 revision integer NOT NULL, prompt_version text NOT NULL DEFAULT 'm4-v1' CHECK(prompt_version='m4-v1'),
 requested_by text NOT NULL REFERENCES public.pp_admins(subject),
 state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','running','retry','succeeded','failed','obsolete')),
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 3),
 available_at timestamptz NOT NULL DEFAULT now(), lease uuid, lease_until timestamptz,
 result jsonb, model text, error_code text, approved_by text REFERENCES public.pp_admins(subject), approved_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(report_id,revision,prompt_version)
);
CREATE INDEX pp_ai_jobs_due ON public.pp_ai_jobs(available_at) WHERE state IN ('pending','retry','running');
CREATE INDEX pp_ai_jobs_requester ON public.pp_ai_jobs(requested_by,created_at);
-- Reservations count even if an upstream request fails or the worker dies.
CREATE TABLE public.pp_ai_usage(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),job_id uuid NOT NULL REFERENCES public.pp_ai_jobs(id),created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX pp_ai_usage_time ON public.pp_ai_usage(created_at);
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['pp_ai_jobs','pp_ai_usage'] LOOP
 EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
 EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',t);
 EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated',t);
 EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON public.%I TO service_role',t);
 END LOOP;
END $$;
REVOKE UPDATE,DELETE ON public.pp_ai_usage FROM service_role;

CREATE FUNCTION public.pp_ai_valid(v jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE l text; x jsonb;
BEGIN
 IF v IS NULL OR jsonb_typeof(v)<>'object' OR (SELECT count(*) FROM jsonb_object_keys(v))<>4
 OR NOT (v ?& ARRAY['category','title','summary','translations'])
 OR jsonb_typeof(v->'category')<>'string' OR v->>'category' NOT IN ('electricity','water','drainage','roads','waste','traffic','accidents')
 OR jsonb_typeof(v->'title')<>'string' OR length(btrim(v->>'title')) NOT BETWEEN 3 AND 160
 OR jsonb_typeof(v->'summary')<>'string' OR length(btrim(v->>'summary')) NOT BETWEEN 10 AND 2000
 OR jsonb_typeof(v->'translations')<>'object' THEN RETURN false; END IF;
 IF (SELECT count(*) FROM jsonb_object_keys(v->'translations'))<>3 THEN RETURN false; END IF;
 FOREACH l IN ARRAY ARRAY['en','ta','hi'] LOOP
 x:=v->'translations'->l;
 IF x IS NULL OR jsonb_typeof(x)<>'object' THEN RETURN false; END IF;
 IF (SELECT count(*) FROM jsonb_object_keys(x))<>2 OR NOT (x ?& ARRAY['title','description'])
 OR jsonb_typeof(x->'title')<>'string' OR length(btrim(x->>'title')) NOT BETWEEN 3 AND 300
 OR (jsonb_typeof(x->'description')<>'null' AND (jsonb_typeof(x->'description')<>'string' OR length(btrim(x->>'description')) NOT BETWEEN 1 AND 10000)) THEN RETURN false; END IF;
 END LOOP;
 RETURN true;
END $$;

CREATE FUNCTION public.pp_ai_dispatch(p_action text,p_subject text,p_data jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE r public.pp_reports; j public.pp_ai_jobs; detail jsonb;
BEGIN
 IF p_action='ai_translation' THEN
 -- Reuse the existing owner/public access rules, including immediate unpublication.
 detail:=public.pp_dispatch('detail',p_subject,p_data);
 SELECT * INTO r FROM public.pp_reports WHERE id=(p_data->>'id')::uuid;
 SELECT * INTO j FROM public.pp_ai_jobs WHERE report_id=r.id AND revision=r.revision AND state='succeeded' AND approved_at IS NOT NULL;
 IF NOT FOUND THEN RETURN jsonb_build_object('translation',NULL); END IF;
 IF coalesce(p_data->>'language','') NOT IN ('en','ta','hi') THEN RAISE EXCEPTION 'invalid_language' USING ERRCODE='22023'; END IF;
 RETURN jsonb_build_object('translation',j.result->'translations'->(p_data->>'language'),'revision',j.revision,'machine',true);
 END IF;
 IF p_subject IS NULL OR NOT EXISTS(SELECT 1 FROM public.pp_admins WHERE subject=p_subject) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
 IF p_action NOT IN ('admin_ai_get','admin_ai_request','admin_ai_approve') THEN RAISE EXCEPTION 'invalid_action' USING ERRCODE='22023'; END IF;
 SELECT * INTO r FROM public.pp_reports WHERE id=(p_data->>'id')::uuid FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002'; END IF;
 SELECT * INTO j FROM public.pp_ai_jobs WHERE report_id=r.id AND revision=r.revision;
 IF p_action='admin_ai_get' THEN
 RETURN jsonb_build_object('job',CASE WHEN j.id IS NULL THEN NULL ELSE to_jsonb(j)-'lease'-'requested_by'-'approved_by' END,'revision',r.revision);
 END IF;
 IF (p_data->>'revision')::integer IS DISTINCT FROM r.revision THEN RAISE EXCEPTION 'stale_revision' USING ERRCODE='23505'; END IF;
 IF p_action='admin_ai_request' THEN
 IF j.id IS NOT NULL THEN RETURN jsonb_build_object('job',to_jsonb(j)-'lease'-'requested_by'-'approved_by','cached',true); END IF;
 PERFORM pg_advisory_xact_lock(hashtext('pp-ai-request:'||p_subject));
 IF (SELECT count(*) FROM public.pp_ai_jobs WHERE requested_by=p_subject AND created_at>now()-interval '1 hour')>=20 THEN RAISE EXCEPTION 'rate_limit' USING ERRCODE='P0001'; END IF;
 INSERT INTO public.pp_ai_jobs(report_id,revision,requested_by) VALUES(r.id,r.revision,p_subject) RETURNING * INTO j;
 INSERT INTO public.pp_admin_audit(actor,action,report_id,note,after_state) VALUES(p_subject,'ai_request',r.id,'Requested Gemini text assistance; original content is preserved.',jsonb_build_object('job',j.id,'revision',j.revision));
 ELSE
 IF j.id IS NULL OR j.state<>'succeeded' OR NOT public.pp_ai_valid(j.result) THEN RAISE EXCEPTION 'invalid_job' USING ERRCODE='22023'; END IF;
 IF j.approved_at IS NULL THEN
 UPDATE public.pp_ai_jobs SET approved_by=p_subject,approved_at=now(),updated_at=now() WHERE id=j.id RETURNING * INTO j;
 INSERT INTO public.pp_admin_audit(actor,action,report_id,note,after_state) VALUES(p_subject,'ai_translation_approve',r.id,'Human reviewed all three machine translations for resident display.',jsonb_build_object('job',j.id,'revision',j.revision));
 END IF;
 END IF;
 RETURN jsonb_build_object('job',to_jsonb(j)-'lease'-'requested_by'-'approved_by');
END $$;

CREATE FUNCTION public.pp_ai_claim() RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE j public.pp_ai_jobs; r public.pp_reports;
BEGIN
 -- Serializes global usage reservations and all workers; SKIP LOCKED also protects job leases.
 PERFORM pg_advisory_xact_lock(hashtext('pp-ai-usage'));
 UPDATE public.pp_ai_jobs j SET state='obsolete',lease=NULL,lease_until=NULL,updated_at=now()
 FROM public.pp_reports r WHERE j.report_id=r.id AND j.revision<>r.revision AND j.state IN ('pending','retry','running');
 UPDATE public.pp_ai_jobs SET state='failed',error_code='lease_expired',lease=NULL,lease_until=NULL,updated_at=now()
 WHERE state='running' AND lease_until<now() AND attempts>=3;
 IF (SELECT count(*) FROM public.pp_ai_usage WHERE created_at>=date_trunc('day',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')>=100
 OR (SELECT count(*) FROM public.pp_ai_usage WHERE created_at>now()-interval '1 minute')>=5 THEN RETURN NULL; END IF;
 SELECT * INTO j FROM public.pp_ai_jobs WHERE attempts<3 AND
 ((state IN ('pending','retry') AND available_at<=now()) OR (state='running' AND lease_until<now()))
 ORDER BY available_at FOR UPDATE SKIP LOCKED LIMIT 1;
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT * INTO r FROM public.pp_reports WHERE id=j.report_id;
 UPDATE public.pp_ai_jobs SET state='running',attempts=attempts+1,lease=gen_random_uuid(),lease_until=now()+interval '2 minutes',updated_at=now() WHERE id=j.id RETURNING * INTO j;
 INSERT INTO public.pp_ai_usage(job_id) VALUES(j.id);
 -- Explicit allowlist: contacts, photos, owner identity, coordinates and audit evidence never go to Gemini.
 RETURN jsonb_build_object('id',j.id,'lease',j.lease,'input',jsonb_build_object('category',r.category,'language',r.language,'title',r.title,'description',r.description,'area',r.area));
END $$;

CREATE FUNCTION public.pp_ai_finish(p_id uuid,p_lease uuid,p_result jsonb,p_model text,p_error text,p_retry boolean) RETURNS boolean
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE j public.pp_ai_jobs; current_revision integer;
BEGIN
 SELECT * INTO j FROM public.pp_ai_jobs WHERE id=p_id FOR UPDATE;
 IF NOT FOUND OR j.state<>'running' OR j.lease IS DISTINCT FROM p_lease OR j.lease_until<now() THEN RETURN false; END IF;
 SELECT revision INTO current_revision FROM public.pp_reports WHERE id=j.report_id;
 IF j.revision<>current_revision THEN
 UPDATE public.pp_ai_jobs SET state='obsolete',lease=NULL,lease_until=NULL,updated_at=now() WHERE id=j.id; RETURN false;
 END IF;
 IF p_error IS NULL THEN
 IF NOT public.pp_ai_valid(p_result) OR p_model IS NULL OR length(p_model) NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'invalid_result' USING ERRCODE='22023'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_each(p_result->'translations') t WHERE (t.value->'description'='null'::jsonb) IS DISTINCT FROM ((SELECT description FROM public.pp_reports WHERE id=j.report_id) IS NULL)) THEN RAISE EXCEPTION 'invalid_translation' USING ERRCODE='22023'; END IF;
 UPDATE public.pp_ai_jobs SET state='succeeded',result=p_result,model=p_model,error_code=NULL,lease=NULL,lease_until=NULL,updated_at=now() WHERE id=j.id;
 ELSE
 IF p_error NOT IN ('upstream_unavailable','upstream_rate_limit','invalid_output','configuration_error','blocked_output') THEN RAISE EXCEPTION 'invalid_error' USING ERRCODE='22023'; END IF;
 UPDATE public.pp_ai_jobs SET state=CASE WHEN p_retry AND attempts<3 THEN 'retry' ELSE 'failed' END,error_code=p_error,
 available_at=now()+make_interval(secs=>30*power(2,attempts)::integer),lease=NULL,lease_until=NULL,updated_at=now() WHERE id=j.id;
 END IF;
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.pp_ai_valid(jsonb),public.pp_ai_dispatch(text,text,jsonb),public.pp_ai_claim(),public.pp_ai_finish(uuid,uuid,jsonb,text,text,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.pp_ai_valid(jsonb),public.pp_ai_dispatch(text,text,jsonb),public.pp_ai_claim(),public.pp_ai_finish(uuid,uuid,jsonb,text,text,boolean) TO service_role;

-- Database scheduler recovers pending/retry jobs without a browser or a resident submission.
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM vault.decrypted_secrets WHERE name='pp_ai_worker_token') THEN
 PERFORM vault.create_secret(encode(extensions.gen_random_bytes(32),'hex'),'pp_ai_worker_token','Puduvai Voice Gemini scheduler authentication');
 END IF;
END $$;
SELECT cron.schedule('pp-ai-worker','* * * * *',$cron$
 SELECT net.http_post(
 url:='https://ajwuxalyrhzratqqicfc.supabase.co/functions/v1/public-problems-bridge',
 headers:=jsonb_build_object('Content-Type','application/json','x-pp-worker-token',(SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='pp_ai_worker_token')),
 body:='{}'::jsonb,timeout_milliseconds:=55000
 );
$cron$);
