-- Return only neighbourhood-scale rounded coordinates for map requests.
CREATE OR REPLACE FUNCTION public.pp_dispatch(p_action text, p_subject text, p_data jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE c public.pp_contacts; r public.pp_reports; result jsonb; rid uuid; lat double precision; lon double precision; started timestamptz; ended timestamptz;
BEGIN
 IF p_action IN ('create','mine','support','follow','upload_check','photo_record','outage_end_update') AND (p_subject IS NULL OR length(p_subject)<3) THEN
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
  IF p_data->>'constituency' IS NOT NULL THEN
   IF NOT EXISTS(SELECT 1 FROM public.pp_constituencies WHERE id=(p_data->>'constituency')::integer AND region=p_data->>'region') THEN
    RAISE EXCEPTION 'invalid_constituency' USING ERRCODE='22023';
   END IF;
   IF coalesce(length(btrim(p_data->>'area')),0) NOT BETWEEN 2 AND 120 THEN RAISE EXCEPTION 'invalid_area' USING ERRCODE='22023'; END IF;
   lat:=(p_data->>'latitude')::double precision; lon:=(p_data->>'longitude')::double precision;
   IF NOT public.pp_in_region(p_data->>'region',lat,lon) THEN RAISE EXCEPTION 'outside_region' USING ERRCODE='22023'; END IF;
  ELSE
   -- Compatibility for the previous deployed form; never assign legacy reports a guessed constituency.
   IF coalesce(p_data->>'area','') NOT IN ('White Town','Heritage Town','Muthialpet','Venkata Nagar','Saram','Nellithope','Mudaliarpet','Orleanpet','Lawspet','Reddiarpalayam','Ariyankuppam','Thattanchavady') THEN
    RAISE EXCEPTION 'unsupported_area' USING ERRCODE='22023';
   END IF;
  END IF;
  IF p_data->>'category'='electricity' THEN
   IF coalesce((p_data->>'observed')::boolean,false) IS NOT TRUE THEN RAISE EXCEPTION 'observation_required' USING ERRCODE='22023'; END IF;
   started:=(p_data->>'outageStartedAt')::timestamptz;
   ended:=nullif(p_data->>'outageEndedAt','')::timestamptz;
   IF ended IS NOT NULL AND (ended<started OR ended>now()) THEN RAISE EXCEPTION 'invalid_time' USING ERRCODE='22023'; END IF;
   IF started IS NULL THEN RAISE EXCEPTION 'invalid_time' USING ERRCODE='22023'; END IF;
   -- The resident lock above makes duplicate and rate checks atomic.
   SELECT * INTO r FROM public.pp_reports WHERE owner_subject=p_subject AND category='electricity'
    AND area=p_data->>'area' AND constituency_id IS NOT DISTINCT FROM (p_data->>'constituency')::integer AND outage_started_at BETWEEN started-interval '30 minutes' AND started+interval '30 minutes'
    AND status NOT IN ('closed') ORDER BY created_at DESC LIMIT 1;
   IF FOUND THEN RETURN jsonb_build_object('id',r.id,'duplicate',true); END IF;
   IF (SELECT count(*) FROM public.pp_reports WHERE owner_subject=p_subject AND category='electricity' AND created_at>now()-interval '1 hour')>=3 THEN
    RAISE EXCEPTION 'rate_limit' USING ERRCODE='P0001';
   END IF;
   IF started>now() OR started<'2000-01-01'::timestamptz THEN RAISE EXCEPTION 'invalid_time' USING ERRCODE='22023'; END IF;
   INSERT INTO public.pp_reports(owner_subject,category,language,area,title,outage_started_at,outage_ended_at,firsthand_attested,request_id)
   VALUES(p_subject,'electricity',p_data->>'language',p_data->>'area','Power outage · '||(p_data->>'area'),started,ended,true,(p_data->>'requestId')::uuid) RETURNING * INTO r;
  ELSE
   lat:=(p_data->>'latitude')::double precision; lon:=(p_data->>'longitude')::double precision;
   IF p_data->>'constituency' IS NULL AND (lat IS NULL OR lon IS NULL OR NOT(lat BETWEEN 11.85 AND 12.03 AND lon BETWEEN 79.70 AND 79.87)) THEN
    RAISE EXCEPTION 'outside_pilot' USING ERRCODE='22023';
   END IF;
   INSERT INTO public.pp_reports(owner_subject,category,language,area,title,description,location,request_id)
   VALUES(p_subject,p_data->>'category',p_data->>'language',p_data->>'area',p_data->>'title',p_data->>'description',extensions.st_setsrid(extensions.st_makepoint(lon,lat),4326)::extensions.geography,(p_data->>'requestId')::uuid) RETURNING * INTO r;
  END IF;
  IF p_data->>'constituency' IS NOT NULL THEN
   UPDATE public.pp_reports SET constituency_id=(p_data->>'constituency')::integer,
    location=extensions.st_setsrid(extensions.st_makepoint(lon,lat),4326)::extensions.geography WHERE id=r.id;
  END IF;
  INSERT INTO public.pp_contacts(report_id,name,phone,address,landmark,pin_code)
   VALUES(r.id,nullif(p_data->>'name',''),nullif(p_data->>'phone',''),nullif(btrim(p_data->>'address'),''),nullif(btrim(p_data->>'landmark'),''),nullif(p_data->>'pinCode',''));
  INSERT INTO public.pp_events(report_id,kind,source) VALUES(r.id,'reported','resident');
  INSERT INTO public.pp_followers(report_id,subject) VALUES(r.id,p_subject);
  RETURN jsonb_build_object('id',r.id);
 ELSIF p_action='outage_end_update' THEN
  rid:=(p_data->>'id')::uuid;
  SELECT * INTO r FROM public.pp_reports WHERE id=rid FOR UPDATE;
  IF NOT FOUND OR r.owner_subject IS DISTINCT FROM p_subject OR r.category<>'electricity' THEN
   RAISE EXCEPTION 'not_found' USING ERRCODE='P0002';
  END IF;
  ended:=(p_data->>'outageEndedAt')::timestamptz;
  IF ended IS NULL OR ended<r.outage_started_at OR ended>now() THEN
   RAISE EXCEPTION 'invalid_time' USING ERRCODE='22023';
  END IF;
  UPDATE public.pp_reports SET outage_ended_at=ended,revision=revision+1 WHERE id=rid;
  INSERT INTO public.pp_events(report_id,kind,source,public) VALUES(rid,'outage_end_updated','resident',true);
  RETURN jsonb_build_object('ok',true);
 ELSIF p_action IN ('list','mine','nearby') THEN
  SELECT coalesce(jsonb_agg(x),'[]'::jsonb) INTO result FROM (
   SELECT a.id,a.category,a.language,a.area,a.constituency_id AS constituency,a.title,a.status,a.outage_started_at,a.outage_ended_at,a.created_at,
    CASE WHEN p_data->>'map'='true' THEN round(extensions.st_y(a.location::extensions.geometry)::numeric,2) END AS map_latitude,
    CASE WHEN p_data->>'map'='true' THEN round(extensions.st_x(a.location::extensions.geometry)::numeric,2) END AS map_longitude,
    (SELECT count(*) FROM public.pp_supporters s WHERE s.report_id=a.id) AS supporters
   FROM public.pp_reports a
   WHERE ((p_action='mine' AND a.owner_subject=p_subject) OR (p_action<>'mine' AND a.published_at IS NOT NULL))
   AND (coalesce(p_data->>'category','all')='all' OR a.category=p_data->>'category')
   AND (coalesce(p_data->>'query','')='' OR a.title ILIKE '%'||(p_data->>'query')||'%' OR a.area ILIKE '%'||(p_data->>'query')||'%')
   AND (p_action<>'nearby' OR (a.created_at>now()-interval '7 days' AND a.status NOT IN ('resolved','closed') AND
    a.area=p_data->>'area' AND a.constituency_id IS NOT DISTINCT FROM (p_data->>'constituency')::integer))

   ORDER BY a.created_at DESC,a.id DESC LIMIT (CASE WHEN p_data->>'map'='true' THEN 10001 ELSE 50 END) OFFSET least(greatest(coalesce((p_data->>'offset')::integer,0),0),10000)
  ) x;
  RETURN result;
 ELSIF p_action='stats' THEN
  RETURN (SELECT jsonb_build_object('published',count(*),'resolved',count(*) FILTER(WHERE status IN ('resolved','closed'))) FROM public.pp_reports WHERE published_at IS NOT NULL);
 ELSIF p_action='detail' THEN
  SELECT * INTO r FROM public.pp_reports WHERE id=(p_data->>'id')::uuid AND (published_at IS NOT NULL OR owner_subject=p_subject);
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002'; END IF;
  SELECT * INTO c FROM public.pp_contacts WHERE report_id=r.id;
  RETURN jsonb_build_object('id',r.id,'category',r.category,'language',r.language,'title',r.title,'description',r.description,'area',r.area,'constituency',r.constituency_id,'status',r.status,'engagement',r.engagement,'outage_started_at',r.outage_started_at,'outage_ended_at',r.outage_ended_at,'created_at',r.created_at,'owner',coalesce(r.owner_subject=p_subject,false),'published',r.published_at IS NOT NULL,
   'supporters',(SELECT count(*) FROM public.pp_supporters WHERE report_id=r.id),
   'supported',EXISTS(SELECT 1 FROM public.pp_supporters WHERE report_id=r.id AND subject=p_subject),
   'following',EXISTS(SELECT 1 FROM public.pp_followers WHERE report_id=r.id AND subject=p_subject),
   'private_location',CASE WHEN r.owner_subject=p_subject THEN jsonb_build_object('address',c.address,'landmark',c.landmark,'pin_code',c.pin_code,'latitude',extensions.st_y(r.location::extensions.geometry),'longitude',extensions.st_x(r.location::extensions.geometry)) ELSE NULL END,
   'photo_count',(SELECT count(*) FROM public.pp_photos WHERE report_id=r.id),
   'events',(SELECT coalesce(jsonb_agg(jsonb_build_object('kind',kind,'source',source,'created_at',created_at) ORDER BY created_at),'[]'::jsonb) FROM public.pp_events WHERE report_id=r.id AND (public OR r.owner_subject=p_subject)));
 ELSIF p_action IN ('support','follow') THEN
  rid:=(p_data->>'id')::uuid;
  IF NOT EXISTS(SELECT 1 FROM public.pp_reports WHERE id=rid AND published_at IS NOT NULL) THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002'; END IF;
  IF p_action='support' AND EXISTS(SELECT 1 FROM public.pp_reports WHERE id=rid AND owner_subject=p_subject) THEN RAISE EXCEPTION 'self_confirmation' USING ERRCODE='22023'; END IF;
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
END $function$
;
