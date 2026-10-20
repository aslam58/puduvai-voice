CREATE OR REPLACE FUNCTION public.pp_ai_claim() RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE j public.pp_ai_jobs; r public.pp_reports;
BEGIN
 -- Serializes global usage reservations and all workers; SKIP LOCKED also protects job leases.
 PERFORM pg_advisory_xact_lock(hashtext('pp-ai-usage'));
 UPDATE public.pp_ai_jobs q SET state='obsolete',lease=NULL,lease_until=NULL,updated_at=now()
 FROM public.pp_reports source_report WHERE q.report_id=source_report.id AND q.revision<>source_report.revision AND q.state IN ('pending','retry','running');
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

