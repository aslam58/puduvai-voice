-- In-site notifications derive from committed events, so there is no delivery dual-write.
ALTER TABLE public.pp_followers ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();
CREATE TABLE public.pp_notification_reads (
 subject text NOT NULL, event_id uuid NOT NULL REFERENCES public.pp_events(id) ON DELETE CASCADE,
 read_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(subject,event_id)
);
ALTER TABLE public.pp_notification_reads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pp_notification_reads FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.pp_notification_reads FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,DELETE ON public.pp_notification_reads TO service_role;
CREATE INDEX pp_followers_subject ON public.pp_followers(subject,report_id);
CREATE FUNCTION public.pp_pilot_dispatch(p_action text,p_subject text,p_data jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
 IF p_subject IS NULL OR length(p_subject)<3 THEN RAISE EXCEPTION 'unauthorized' USING ERRCODE='42501'; END IF;
 IF p_action='admin_health' THEN
 PERFORM public.pp_admin_dispatch('admin_session',p_subject,'{}');
 RETURN jsonb_build_object('checked_at',now(),
 'pending_reports',(SELECT count(*) FROM public.pp_reports WHERE published_at IS NULL AND status NOT IN ('closed','resolved')),
 'oldest_pending',(SELECT min(created_at) FROM public.pp_reports WHERE published_at IS NULL AND status NOT IN ('closed','resolved')),
 'pending_photos',(SELECT count(*) FROM public.pp_photos WHERE review_state='pending'),
 'failed_ai',(SELECT count(*) FROM public.pp_ai_jobs WHERE state='failed' AND updated_at>now()-interval '24 hours'),
 'overdue_ai',(SELECT count(*) FROM public.pp_ai_jobs WHERE (state IN ('pending','retry') AND available_at<now()-interval '10 minutes') OR (state='running' AND lease_until<now()-interval '10 minutes')),
 'active_departments',(SELECT count(*) FROM public.pp_departments WHERE active));
 ELSIF p_action='unfollow' THEN
 DELETE FROM public.pp_followers WHERE report_id=(p_data->>'id')::uuid AND subject=p_subject;
 RETURN jsonb_build_object('ok',true);
 ELSIF p_action NOT IN ('notifications','notification_read') THEN
 RAISE EXCEPTION 'invalid_action' USING ERRCODE='22023';
 END IF;
 -- Re-check visibility on every read; unpublication immediately removes follower access.
 -- Owner updates can include private review/close events but never notes or evidence.
 IF p_action='notification_read' THEN
 INSERT INTO public.pp_notification_reads(subject,event_id)
 SELECT p_subject,e.id FROM public.pp_events e
 JOIN public.pp_reports r ON r.id=e.report_id
 JOIN public.pp_followers f ON f.report_id=r.id AND f.subject=p_subject
 WHERE e.id=(p_data->>'id')::uuid AND e.created_at>=f.created_at
 AND e.kind IN ('review','publish','unpublish','close','resolve','reopen','forward','acknowledge','work_reported')
 AND (r.owner_subject=p_subject OR (r.published_at IS NOT NULL AND e.public))
 ON CONFLICT DO NOTHING;
 RETURN jsonb_build_object('ok',true);
 END IF;
 SELECT coalesce(jsonb_agg(x),'[]'::jsonb) INTO result FROM (
 SELECT e.id,e.report_id,e.kind,e.created_at,r.category,r.area,
 EXISTS(SELECT 1 FROM public.pp_notification_reads n WHERE n.event_id=e.id AND n.subject=p_subject) AS read
 FROM public.pp_events e JOIN public.pp_reports r ON r.id=e.report_id
 JOIN public.pp_followers f ON f.report_id=r.id AND f.subject=p_subject
 WHERE e.created_at>=f.created_at
 AND e.kind IN ('review','publish','unpublish','close','resolve','reopen','forward','acknowledge','work_reported')
 AND (r.owner_subject=p_subject OR (r.published_at IS NOT NULL AND e.public))
 ORDER BY e.created_at DESC,e.id DESC LIMIT 50 OFFSET least(greatest(coalesce((p_data->>'offset')::integer,0),0),10000)
 ) x;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.pp_pilot_dispatch(text,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.pp_pilot_dispatch(text,text,jsonb) TO service_role;
