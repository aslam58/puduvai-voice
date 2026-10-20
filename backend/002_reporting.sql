-- Hosted M2 schema. Original 001_foundation.sql is an unapplied design reference.
CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA extensions;
CREATE TABLE public.pp_reports (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 owner_subject text NOT NULL,
 category text NOT NULL CHECK(category IN ('electricity','water','drainage','roads','waste')),
 language text NOT NULL CHECK(language IN ('en','ta','hi')),
 area text NOT NULL CHECK(length(area) BETWEEN 2 AND 120),
 title text NOT NULL CHECK(length(title) BETWEEN 3 AND 160),
 description text CHECK(length(description) BETWEEN 10 AND 5000),
 outage_started_at timestamptz,
 location extensions.geography(Point,4326),
 status text NOT NULL DEFAULT 'reported' CHECK(status IN ('reported','under_review','verified','resolved','closed')),
 engagement text NOT NULL DEFAULT 'not_forwarded' CHECK(engagement IN ('not_forwarded','forwarded','acknowledged','work_reported')),
 published_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
 request_id uuid NOT NULL,
 UNIQUE(owner_subject,request_id),
 CHECK((category='electricity' AND outage_started_at IS NOT NULL AND description IS NULL AND location IS NULL)
 OR (category<>'electricity' AND outage_started_at IS NULL AND description IS NOT NULL AND location IS NOT NULL))
);
CREATE INDEX pp_reports_owner ON public.pp_reports(owner_subject,created_at DESC);
CREATE INDEX pp_reports_public ON public.pp_reports(category,created_at DESC) WHERE published_at IS NOT NULL;
CREATE INDEX pp_reports_location ON public.pp_reports USING gist(location);
CREATE TABLE public.pp_contacts (
 report_id uuid PRIMARY KEY REFERENCES public.pp_reports(id),
 name text CHECK(length(name) BETWEEN 1 AND 100),
 phone text CHECK(phone ~ '^\+?[0-9 ()-]{7,20}$')
);
CREATE TABLE public.pp_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), report_id uuid NOT NULL REFERENCES public.pp_reports(id),
 kind text NOT NULL, source text NOT NULL, public boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX pp_events_report ON public.pp_events(report_id,created_at);
CREATE TABLE public.pp_supporters (
 report_id uuid NOT NULL REFERENCES public.pp_reports(id), subject text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(report_id,subject)
);
CREATE TABLE public.pp_followers (
 report_id uuid NOT NULL REFERENCES public.pp_reports(id), subject text NOT NULL,
 PRIMARY KEY(report_id,subject)
);
CREATE TABLE public.pp_photos (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), report_id uuid NOT NULL REFERENCES public.pp_reports(id),
 object_key text NOT NULL UNIQUE, bytes integer NOT NULL CHECK(bytes BETWEEN 1 AND 2097152),
 review_state text NOT NULL DEFAULT 'pending' CHECK(review_state IN ('pending','approved','rejected')),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX pp_photos_report ON public.pp_photos(report_id);
CREATE TABLE public.pp_nonces(nonce uuid PRIMARY KEY, created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX pp_nonces_time ON public.pp_nonces(created_at);
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['pp_reports','pp_contacts','pp_events','pp_supporters','pp_followers','pp_photos','pp_nonces'] LOOP
 EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
 EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',t);
 EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated',t);
 EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON public.%I TO service_role',t);
 END LOOP;
END $$;
-- All data operations are behind the authenticated, signature-verifying Edge service.
CREATE FUNCTION public.pp_claim_nonce(p_nonce uuid) RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 DELETE FROM public.pp_nonces WHERE created_at < now()-interval '3 minutes';
 INSERT INTO public.pp_nonces(nonce) VALUES(p_nonce);
END $$;
REVOKE ALL ON FUNCTION public.pp_claim_nonce(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.pp_claim_nonce(uuid) TO service_role;

CREATE FUNCTION public.pp_dispatch(p_action text,p_subject text,p_data jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE r public.pp_reports; result jsonb; rid uuid; lat double precision; lon double precision; started timestamptz;
BEGIN
 IF p_action IN ('create','mine','support','follow','upload_check','photo_record') AND (p_subject IS NULL OR length(p_subject)<3) THEN
  RAISE EXCEPTION 'unauthorized' USING ERRCODE='42501';
 END IF;
 IF p_action='create' THEN
  -- Serialize per-resident submissions so concurrent requests cannot bypass the limit.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_subject,0));
  SELECT * INTO r FROM public.pp_reports WHERE owner_subject=p_subject AND request_id=(p_data->>'requestId')::uuid;
  IF FOUND THEN RETURN jsonb_build_object('id',r.id); END IF;
  IF (SELECT count(*) FROM public.pp_reports WHERE owner_subject=p_subject AND created_at>now()-interval '1 hour')>=10 THEN
   RAISE EXCEPTION 'rate_limit' USING ERRCODE='P0001';
  END IF;
  IF p_data->>'area' NOT IN ('White Town','Heritage Town','Muthialpet','Venkata Nagar','Saram','Nellithope','Mudaliarpet','Orleanpet','Lawspet','Reddiarpalayam','Ariyankuppam','Thattanchavady') THEN
   RAISE EXCEPTION 'unsupported_area' USING ERRCODE='22023';
  END IF;
  IF p_data->>'category'='electricity' THEN
   started:=(p_data->>'outageStartedAt')::timestamptz;
   IF started>now() OR started<'2000-01-01'::timestamptz THEN RAISE EXCEPTION 'invalid_time' USING ERRCODE='22023'; END IF;
   INSERT INTO public.pp_reports(owner_subject,category,language,area,title,outage_started_at,request_id)
   VALUES(p_subject,'electricity',p_data->>'language',p_data->>'area','Power outage · '||(p_data->>'area'),started,(p_data->>'requestId')::uuid) RETURNING * INTO r;
  ELSE
   lat:=(p_data->>'latitude')::double precision; lon:=(p_data->>'longitude')::double precision;
   IF lat IS NULL OR lon IS NULL OR NOT(lat BETWEEN 11.85 AND 12.03 AND lon BETWEEN 79.70 AND 79.87) THEN
    RAISE EXCEPTION 'outside_pilot' USING ERRCODE='22023';
   END IF;
   INSERT INTO public.pp_reports(owner_subject,category,language,area,title,description,location,request_id)
   VALUES(p_subject,p_data->>'category',p_data->>'language',p_data->>'area',p_data->>'title',p_data->>'description',extensions.st_setsrid(extensions.st_makepoint(lon,lat),4326)::extensions.geography,(p_data->>'requestId')::uuid) RETURNING * INTO r;
  END IF;
  INSERT INTO public.pp_contacts(report_id,name,phone) VALUES(r.id,nullif(p_data->>'name',''),nullif(p_data->>'phone',''));
  INSERT INTO public.pp_events(report_id,kind,source) VALUES(r.id,'reported','resident');
  INSERT INTO public.pp_followers(report_id,subject) VALUES(r.id,p_subject);
  RETURN jsonb_build_object('id',r.id);
 ELSIF p_action IN ('list','mine','nearby') THEN
  SELECT coalesce(jsonb_agg(x),'[]'::jsonb) INTO result FROM (
   SELECT a.id,a.category,a.language,a.area,a.title,a.status,a.outage_started_at,a.created_at,
    (SELECT count(*) FROM public.pp_supporters s WHERE s.report_id=a.id) AS supporters
   FROM public.pp_reports a
   WHERE ((p_action='mine' AND a.owner_subject=p_subject) OR (p_action<>'mine' AND a.published_at IS NOT NULL))
   AND (coalesce(p_data->>'category','all')='all' OR a.category=p_data->>'category')
   AND (coalesce(p_data->>'query','')='' OR a.title ILIKE '%'||(p_data->>'query')||'%' OR a.area ILIKE '%'||(p_data->>'query')||'%')
   AND (p_action<>'nearby' OR (a.created_at>now()-interval '7 days' AND a.status NOT IN ('resolved','closed') AND
    ((a.category='electricity' AND a.area=p_data->>'area') OR
    (a.location IS NOT NULL AND extensions.st_dwithin(a.location,extensions.st_setsrid(extensions.st_makepoint((p_data->>'longitude')::double precision,(p_data->>'latitude')::double precision),4326)::extensions.geography,500)))))
   ORDER BY a.created_at DESC LIMIT 50 OFFSET least(greatest(coalesce((p_data->>'offset')::integer,0),0),10000)
  ) x;
  RETURN result;
 ELSIF p_action='stats' THEN
  RETURN (SELECT jsonb_build_object('published',count(*),'resolved',count(*) FILTER(WHERE status IN ('resolved','closed'))) FROM public.pp_reports WHERE published_at IS NOT NULL);
 ELSIF p_action='detail' THEN
  SELECT * INTO r FROM public.pp_reports WHERE id=(p_data->>'id')::uuid AND (published_at IS NOT NULL OR owner_subject=p_subject);
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002'; END IF;
  RETURN jsonb_build_object('id',r.id,'category',r.category,'language',r.language,'title',r.title,'description',r.description,'area',r.area,'status',r.status,'engagement',r.engagement,'outage_started_at',r.outage_started_at,'created_at',r.created_at,'owner',coalesce(r.owner_subject=p_subject,false),'published',r.published_at IS NOT NULL,
   'supporters',(SELECT count(*) FROM public.pp_supporters WHERE report_id=r.id),
   'supported',EXISTS(SELECT 1 FROM public.pp_supporters WHERE report_id=r.id AND subject=p_subject),
   'following',EXISTS(SELECT 1 FROM public.pp_followers WHERE report_id=r.id AND subject=p_subject),
   'photo_count',(SELECT count(*) FROM public.pp_photos WHERE report_id=r.id),
   'events',(SELECT coalesce(jsonb_agg(jsonb_build_object('kind',kind,'source',source,'created_at',created_at) ORDER BY created_at),'[]'::jsonb) FROM public.pp_events WHERE report_id=r.id AND (public OR r.owner_subject=p_subject)));
 ELSIF p_action IN ('support','follow') THEN
  rid:=(p_data->>'id')::uuid;
  IF NOT EXISTS(SELECT 1 FROM public.pp_reports WHERE id=rid AND published_at IS NOT NULL) THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002'; END IF;
  IF p_action='support' THEN INSERT INTO public.pp_supporters(report_id,subject) VALUES(rid,p_subject) ON CONFLICT DO NOTHING;
  ELSE INSERT INTO public.pp_followers(report_id,subject) VALUES(rid,p_subject) ON CONFLICT DO NOTHING; END IF;
  RETURN jsonb_build_object('ok',true);
 ELSIF p_action IN ('upload_check','photo_record') THEN
  rid:=(p_data->>'id')::uuid;
  SELECT * INTO r FROM public.pp_reports WHERE id=rid AND owner_subject=p_subject AND category<>'electricity';
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002'; END IF;
  IF (SELECT count(*) FROM public.pp_photos WHERE report_id=rid)>=3 THEN RAISE EXCEPTION 'photo_limit' USING ERRCODE='22023'; END IF;
  IF p_action='photo_record' THEN
   -- Serialize concurrent attachments for the same report.
   PERFORM pg_advisory_xact_lock(hashtextextended(rid::text,1));
   IF (SELECT count(*) FROM public.pp_photos WHERE report_id=rid)>=3 THEN RAISE EXCEPTION 'photo_limit' USING ERRCODE='22023'; END IF;
   INSERT INTO public.pp_photos(report_id,object_key,bytes) VALUES(rid,p_data->>'key',(p_data->>'bytes')::integer);
  END IF;
  RETURN jsonb_build_object('ok',true);
 ELSE RAISE EXCEPTION 'invalid_action' USING ERRCODE='22023';
 END IF;
END $$;
REVOKE ALL ON FUNCTION public.pp_dispatch(text,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.pp_dispatch(text,text,jsonb) TO service_role;
INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
VALUES('pp-private-photos','pp-private-photos',false,2097152,ARRAY['image/jpeg']);
