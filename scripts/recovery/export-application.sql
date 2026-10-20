-- Catalog-based logical application snapshot. Excludes Vault secrets, system
-- schemas, ephemeral nonces and managed platform configuration. No live writes.
BEGIN ISOLATION LEVEL REPEATABLE READ;
SET LOCAL search_path='';
CREATE FUNCTION pg_temp.pp_export() RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE t record; cols text; definitions text=''; payload jsonb='{}'; rows jsonb; constraints text=''; indexes text=''; grants text=''; funcs text=''; triggers text='';
BEGIN
 FOR t IN SELECT c.oid,c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' AND c.relname LIKE 'pp_%' ORDER BY c.relname LOOP
 SELECT string_agg(format('%I %s%s%s',a.attname,format_type(a.atttypid,a.atttypmod),CASE WHEN d.adbin IS NOT NULL THEN ' DEFAULT '||pg_get_expr(d.adbin,d.adrelid) ELSE '' END,CASE WHEN a.attnotnull THEN ' NOT NULL' ELSE '' END),E',\n' ORDER BY a.attnum) INTO cols FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid=t.oid AND a.attnum>0 AND NOT a.attisdropped;
 definitions:=definitions||format(E'CREATE TABLE public.%I (\n%s\n);\nALTER TABLE public.%I ENABLE ROW LEVEL SECURITY; ALTER TABLE public.%I FORCE ROW LEVEL SECURITY;\n',t.relname,cols,t.relname,t.relname);
 EXECUTE format('SELECT coalesce(jsonb_agg(to_jsonb(r)),''[]''::jsonb) FROM public.%I r',t.relname) INTO rows;
 IF t.relname='pp_nonces' THEN rows:='[]';END IF;
 payload:=payload||jsonb_build_object(t.relname,rows);
 SELECT constraints||coalesce(string_agg(format('ALTER TABLE public.%I ADD CONSTRAINT %I %s;',t.relname,conname,pg_get_constraintdef(oid)),E'\n' ORDER BY conname),'')||E'\n' INTO constraints FROM pg_constraint WHERE conrelid=t.oid;
 SELECT indexes||coalesce(string_agg(pg_get_indexdef(i.indexrelid)||';',E'\n'),'')||E'\n' INTO indexes FROM pg_index i WHERE i.indrelid=t.oid AND NOT EXISTS(SELECT 1 FROM pg_constraint c WHERE c.conindid=i.indexrelid);
 grants:=grants||format(E'REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated,service_role;\n',t.relname);
 SELECT grants||coalesce(string_agg(format('GRANT %s ON public.%I TO %I;',privilege_type,t.relname,grantee),E'\n'),'')||E'\n' INTO grants FROM information_schema.role_table_grants WHERE table_schema='public' AND table_name=t.relname AND grantee IN ('anon','authenticated','service_role');
 END LOOP;
 SELECT string_agg(format('ALTER TABLE public.%I ADD CONSTRAINT %I %s;',rel.relname,con.conname,pg_get_constraintdef(con.oid)),E'\n' ORDER BY (con.contype='f'),rel.relname,con.conname) INTO constraints FROM pg_constraint con JOIN pg_class rel ON rel.oid=con.conrelid JOIN pg_namespace ns ON ns.oid=rel.relnamespace WHERE ns.nspname='public' AND rel.relname LIKE 'pp_%';
 SELECT string_agg(pg_get_functiondef(p.oid)||E';\n'||format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated; GRANT EXECUTE ON FUNCTION %s TO service_role;',p.oid::regprocedure,p.oid::regprocedure),E'\n' ORDER BY p.proname) INTO funcs FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname LIKE 'pp_%' AND p.proname NOT IN ('pp_ai_config','pp_email_config');
 SELECT string_agg(pg_get_triggerdef(tr.oid)||';',E'\n') INTO triggers FROM pg_trigger tr JOIN pg_class c ON c.oid=tr.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname LIKE 'pp_%' AND NOT tr.tgisinternal;
 RETURN jsonb_build_object('captured_at',now(),'tables',definitions,'data',payload,'constraints',constraints,'indexes',indexes,'grants',grants,'functions',funcs,'triggers',coalesce(triggers,''),'scope','Application schema/data; excludes Vault, auth, scheduler and Storage bytes. Nonces omitted.');
END $$;
SELECT pg_temp.pp_export() AS snapshot;
ROLLBACK;
