-- M3: service-only administrator operations; resident identity comes from signed Sites requests.
CREATE TABLE public.pp_admins(subject text PRIMARY KEY, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.pp_departments(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL CHECK(length(name) BETWEEN 3 AND 160),
 category text NOT NULL CHECK(category IN ('electricity','water','drainage','roads','waste','traffic','accidents')),
 contact text NOT NULL CHECK(length(contact) BETWEEN 3 AND 500),
 verification_source text NOT NULL CHECK(length(verification_source) BETWEEN 10 AND 1000),
 verified_at timestamptz NOT NULL DEFAULT now(), active boolean NOT NULL DEFAULT true
);
ALTER TABLE public.pp_reports ADD COLUMN department_id uuid REFERENCES public.pp_departments(id);
ALTER TABLE public.pp_reports ADD COLUMN revision integer NOT NULL DEFAULT 0;
CREATE TABLE public.pp_admin_audit(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), actor text NOT NULL REFERENCES public.pp_admins(subject),
 action text NOT NULL, report_id uuid REFERENCES public.pp_reports(id), department_id uuid REFERENCES public.pp_departments(id),
 note text NOT NULL CHECK(length(note) BETWEEN 10 AND 2000), evidence text,
 before_state jsonb, after_state jsonb, created_at timestamptz NOT NULL DEFAULT now()
);
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['pp_admins','pp_departments','pp_admin_audit'] LOOP
 EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
 EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',t);
 EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated',t);
 EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON public.%I TO service_role',t);
 END LOOP;
END $$;
-- Audit history is append-only for the runtime role.
REVOKE UPDATE,DELETE ON public.pp_admin_audit FROM service_role;
CREATE FUNCTION public.pp_admin_dispatch(p_action text,p_subject text,p_data jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE r public.pp_reports; previous jsonb; result jsonb; d public.pp_departments; op text; note text; evidence text;
BEGIN
 IF p_subject IS NULL OR NOT EXISTS(SELECT 1 FROM public.pp_admins WHERE subject=p_subject) THEN
 RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
 IF p_action='admin_session' THEN RETURN jsonb_build_object('admin',true); END IF;
 IF p_action='admin_queue' THEN
 SELECT coalesce(jsonb_agg(x),'[]'::jsonb) INTO result FROM (
 SELECT id,category,area,title,status,engagement,published_at,department_id,revision,created_at
 FROM public.pp_reports WHERE (coalesce(p_data->>'filter','pending')='all' OR published_at IS NULL)
 ORDER BY created_at LIMIT 100 OFFSET least(greatest(coalesce((p_data->>'offset')::integer,0),0),10000)) x;
 RETURN result;
 ELSIF p_action='admin_departments' THEN
 RETURN (SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY name),'[]'::jsonb) FROM public.pp_departments a);
 ELSIF p_action='admin_photo' THEN
 RETURN (SELECT jsonb_build_object('key',object_key) FROM public.pp_photos WHERE id=(p_data->>'photoId')::uuid);
 ELSIF p_action='admin_detail' THEN
 SELECT * INTO r FROM public.pp_reports WHERE id=(p_data->>'id')::uuid;
 IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002'; END IF;
 RETURN (to_jsonb(r)-'owner_subject'-'request_id'-'location') || jsonb_build_object(
 'photos',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'review_state',review_state)),'[]'::jsonb) FROM public.pp_photos WHERE report_id=r.id),
 'audit',(SELECT coalesce(jsonb_agg(jsonb_build_object('action',action,'note',note,'evidence',evidence,'created_at',created_at) ORDER BY created_at),'[]'::jsonb) FROM public.pp_admin_audit WHERE report_id=r.id));
 END IF;
 note:=btrim(p_data->>'note'); evidence:=nullif(btrim(p_data->>'evidence'),'');
 IF note IS NULL OR length(note) NOT BETWEEN 10 AND 2000 OR length(evidence)>2000 THEN RAISE EXCEPTION 'invalid_note' USING ERRCODE='22023'; END IF;
 IF p_action='admin_department_save' THEN
 IF p_data->>'id' IS NULL THEN
 INSERT INTO public.pp_departments(name,category,contact,verification_source) VALUES(btrim(p_data->>'name'),p_data->>'category',btrim(p_data->>'contact'),btrim(p_data->>'verificationSource')) RETURNING * INTO d;
 ELSE
 SELECT * INTO d FROM public.pp_departments WHERE id=(p_data->>'id')::uuid FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002'; END IF;
 previous:=to_jsonb(d);
 UPDATE public.pp_departments SET name=btrim(p_data->>'name'),category=p_data->>'category',contact=btrim(p_data->>'contact'),verification_source=btrim(p_data->>'verificationSource'),active=coalesce((p_data->>'active')::boolean,true),verified_at=now() WHERE id=d.id RETURNING * INTO d;
 END IF;
 INSERT INTO public.pp_admin_audit(actor,action,department_id,note,before_state,after_state) VALUES(p_subject,p_action,d.id,note,previous,to_jsonb(d));
 RETURN to_jsonb(d);
 ELSIF p_action<>'admin_action' THEN RAISE EXCEPTION 'invalid_action' USING ERRCODE='22023'; END IF;
 SELECT * INTO r FROM public.pp_reports WHERE id=(p_data->>'id')::uuid FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002'; END IF;
 IF (p_data->>'revision')::integer IS DISTINCT FROM r.revision THEN RAISE EXCEPTION 'stale_revision' USING ERRCODE='23505'; END IF;
 previous:=to_jsonb(r)-'owner_subject'-'request_id'-'location'; op:=p_data->>'operation';
 IF op='photo_approve' OR op='photo_reject' THEN
 previous:=previous || jsonb_build_object('photo',(SELECT jsonb_build_object('id',id,'review_state',review_state) FROM public.pp_photos WHERE id=(p_data->>'photoId')::uuid AND report_id=r.id));
 UPDATE public.pp_photos SET review_state=CASE WHEN op='photo_approve' THEN 'approved' ELSE 'rejected' END WHERE id=(p_data->>'photoId')::uuid AND report_id=r.id;
 IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002'; END IF;
 ELSIF op='review' AND r.status='reported' THEN r.status:='under_review';
 ELSIF op='publish' AND r.status IN ('reported','under_review','verified') THEN r.status:='verified'; r.published_at:=coalesce(r.published_at,now());
 ELSIF op='unpublish' AND r.published_at IS NOT NULL THEN r.published_at:=NULL;
 ELSIF op='close' AND r.status NOT IN ('resolved','closed') THEN r.status:='closed';
 ELSIF op='resolve' AND r.status='verified' AND r.published_at IS NOT NULL AND length(evidence)>=10 THEN r.status:='resolved';
 ELSIF op='reopen' AND r.status IN ('resolved','closed') THEN r.status:='under_review'; r.engagement:='not_forwarded';
 ELSIF op='route' AND r.status NOT IN ('resolved','closed') THEN
 SELECT * INTO d FROM public.pp_departments WHERE id=(p_data->>'departmentId')::uuid AND active AND category=r.category;
 IF NOT FOUND THEN RAISE EXCEPTION 'invalid_department' USING ERRCODE='22023'; END IF;
 r.department_id:=d.id; r.engagement:='not_forwarded';
 ELSIF op='forward' AND r.department_id IS NOT NULL AND r.published_at IS NOT NULL AND r.status='verified' AND r.engagement='not_forwarded' AND length(evidence)>=10 THEN r.engagement:='forwarded';
 ELSIF op='acknowledge' AND r.status='verified' AND r.engagement='forwarded' AND length(evidence)>=10 THEN r.engagement:='acknowledged';
 ELSIF op='work_reported' AND r.status='verified' AND r.engagement='acknowledged' AND length(evidence)>=10 THEN r.engagement:='work_reported';
 ELSE RAISE EXCEPTION 'invalid_transition' USING ERRCODE='22023'; END IF;
 UPDATE public.pp_reports SET status=r.status,engagement=r.engagement,published_at=r.published_at,department_id=r.department_id,revision=revision+1 WHERE id=r.id RETURNING * INTO r;
 INSERT INTO public.pp_admin_audit(actor,action,report_id,note,evidence,before_state,after_state)
 VALUES(p_subject,op,r.id,note,evidence,previous,(to_jsonb(r)-'owner_subject'-'request_id'-'location') || CASE WHEN op IN ('photo_approve','photo_reject') THEN jsonb_build_object('photo',jsonb_build_object('id',p_data->>'photoId','review_state',CASE WHEN op='photo_approve' THEN 'approved' ELSE 'rejected' END)) ELSE '{}'::jsonb END);
 INSERT INTO public.pp_events(report_id,kind,source,public) VALUES(r.id,op,'administrator',op IN ('publish','resolve','reopen','forward','acknowledge','work_reported'));
 RETURN jsonb_build_object('ok',true,'revision',r.revision);
END $$;
REVOKE ALL ON FUNCTION public.pp_admin_dispatch(text,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.pp_admin_dispatch(text,text,jsonb) TO service_role;
