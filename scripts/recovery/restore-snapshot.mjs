// Emits SQL to stdout for piping into a separately provisioned local recovery DB.
// Never point this at the live Supabase database.
import {readFile} from 'node:fs/promises';import {createDecipheriv,createHash} from 'node:crypto';
const bytes=await readFile('backups/application-snapshot.enc'),key=await readFile('.sites-runtime/recovery-backup.key');const decipher=createDecipheriv('aes-256-gcm',key,bytes.subarray(0,12));decipher.setAuthTag(bytes.subarray(12,28));const plain=Buffer.concat([decipher.update(bytes.subarray(28)),decipher.final()]);
const manifest=JSON.parse(await readFile('backups/manifest.json','utf8'));if(createHash('sha256').update(plain).digest('hex')!==manifest.sha256)throw Error('Snapshot checksum mismatch');const s=JSON.parse(plain);
const quote=v=>"'"+v.replaceAll("'","''")+"'";const ident=v=>'"'+v.replaceAll('"','""')+'"';
const sql=[`SET check_function_bodies=off; CREATE SCHEMA extensions; CREATE EXTENSION postgis WITH SCHEMA extensions; CREATE EXTENSION pgcrypto WITH SCHEMA extensions;
CREATE SCHEMA storage;
-- Local Storage metadata stand-in; this is not a managed Storage service restore.
CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean);
CREATE TABLE storage.objects(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),bucket_id text,name text);
INSERT INTO storage.buckets VALUES('pp-private-photos','pp-private-photos',false);
DO $$BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF; IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated;END IF; IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role BYPASSRLS;END IF;END $$; GRANT USAGE ON SCHEMA extensions TO anon,authenticated,service_role;`,s.tables];
for(const [table,rows] of Object.entries(s.data)){if(rows.length)sql.push(`INSERT INTO public.${ident(table)} SELECT * FROM jsonb_populate_recordset(NULL::public.${ident(table)},${quote(JSON.stringify(rows))}::jsonb);`)}
sql.push(s.constraints,s.indexes,s.functions,s.triggers,s.grants);
sql.push(`CREATE SCHEMA pp_private; REVOKE ALL ON SCHEMA pp_private FROM PUBLIC,anon,authenticated; GRANT USAGE ON SCHEMA pp_private TO service_role; CREATE FUNCTION pp_private.ai_config() RETURNS jsonb LANGUAGE sql AS $$ SELECT '{"enabled":false,"apiKey":"","model":""}'::jsonb; $$; REVOKE ALL ON FUNCTION pp_private.ai_config() FROM PUBLIC,anon,authenticated; GRANT EXECUTE ON FUNCTION pp_private.ai_config() TO service_role; CREATE FUNCTION public.pp_ai_config() RETURNS jsonb LANGUAGE sql AS $$ SELECT '{"enabled":false,"apiKey":"","model":""}'::jsonb; $$; CREATE FUNCTION public.pp_email_config() RETURNS jsonb LANGUAGE sql AS $$ SELECT '{"enabled":false,"apiKey":"","from":""}'::jsonb; $$; REVOKE ALL ON FUNCTION public.pp_ai_config(),public.pp_email_config() FROM PUBLIC,anon,authenticated; GRANT EXECUTE ON FUNCTION public.pp_ai_config(),public.pp_email_config() TO service_role;`);
process.stdout.write(sql.filter(Boolean).join('\n'));
