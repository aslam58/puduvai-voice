// Supabase Edge runtime. The private signing key exists only in Sites runtime secrets.
// verify_jwt is disabled because this endpoint verifies ECDSA service signatures instead.
import {sendAdministratorEmail,emailEnabled,EmailError,administratorEmail,type EmailConfig} from './email.ts';
import publicKey from './bridge-public-key.json' with { type: 'json' };
import jpeg from 'npm:jpeg-js@0.4.4';
import {generateAssistance, GeminiError} from './gemini.ts';
import {workerTokenHash} from './worker-public-config.ts';
const projectUrl = Deno.env.get('SUPABASE_URL')!;
const secret = (()=>{ const v=Deno.env.get('SUPABASE_SECRET_KEYS'); return (v?JSON.parse(v).default:undefined)||Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!; })();
const key = await crypto.subtle.importKey('jwk',publicKey,{name:'ECDSA',namedCurve:'P-256'},false,['verify']);
const headers = {apikey:secret, Authorization:`Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || secret}`,'Content-Type':'application/json'};
async function rpc(name:string,args:unknown){
 const res=await fetch(`${projectUrl}/rest/v1/rpc/${name}`,{method:'POST',headers,body:JSON.stringify(args)});
 const text=await res.text(); const data=text?JSON.parse(text):null;
 if(!res.ok){const code=data.code; throw {status:code==='42501'?403:code==='P0002'?404:code==='P0001'?429:code==='23505'?409:400,code:code==='P0001'?'rate_limit':code==='P0002'?'not_found':'invalid_request'};}
 return data;
}
type AiConfig={apiKey:string;model:string;enabled:boolean};
async function aiConfig():Promise<AiConfig>{
 if(Deno.env.get('GEMINI_API_KEY'))return {apiKey:Deno.env.get('GEMINI_API_KEY')!,model:Deno.env.get('GEMINI_MODEL')||'',enabled:Deno.env.get('PP_AI_ENABLED')==='true'};
 const config=await rpc('pp_ai_config',{}) as AiConfig;
 if(Deno.env.get('PP_AI_ENABLED')==='false')config.enabled=false;
 return config;
}
const aiEnabled=(config:AiConfig)=>config.enabled && !!config.apiKey && /^gemini-[a-z0-9.-]{1,80}$/.test(config.model);
async function runAiJob(){
 const config=await aiConfig();
 if(!aiEnabled(config))return {enabled:false};
 const job=await rpc('pp_ai_claim',{});
 if(!job)return {enabled:true,processed:false};
 try{
  const result=await generateAssistance(job.input,config);
  await rpc('pp_ai_finish',{p_id:job.id,p_lease:job.lease,p_result:result,p_model:config.model,p_error:null,p_retry:false});
 }catch(e){
  const err=e instanceof GeminiError?e:new GeminiError('upstream_unavailable',true);
  await rpc('pp_ai_finish',{p_id:job.id,p_lease:job.lease,p_result:null,p_model:config.model,p_error:err.code,p_retry:err.retry});
 }
 return {enabled:true,processed:true};
}
async function emailConfig():Promise<EmailConfig>{
 if(Deno.env.get('RESEND_API_KEY'))return {apiKey:Deno.env.get('RESEND_API_KEY')!,from:Deno.env.get('PP_EMAIL_FROM')||'',enabled:Deno.env.get('PP_EMAIL_ENABLED')==='true'};
 return await rpc('pp_email_config',{});
}
async function runEmailJob(){
 const config=await emailConfig();if(!emailEnabled(config))return {enabled:false};
 const job=await rpc('pp_email_claim',{});if(!job)return {enabled:true,processed:false};
 try{const provider=await sendAdministratorEmail(job,config);await rpc('pp_email_finish',{p_id:job.id,p_lease:job.lease,p_provider_id:provider,p_error:null,p_retry:false})}
 catch(e){const err=e instanceof EmailError?e:new EmailError('provider_unavailable',true);await rpc('pp_email_finish',{p_id:job.id,p_lease:job.lease,p_provider_id:null,p_error:err.code,p_retry:err.retry})}
 return {enabled:true,processed:true};
}
const allowed = ['outage_end_update','notifications','notification_read','unfollow','admin_health','admin_ai_get','admin_ai_request','admin_ai_approve','ai_translation','create','list','mine','detail','nearby','stats','support','follow','photo','admin_session','admin_queue','admin_departments','admin_detail','admin_department_save','admin_action','admin_photo'];
Deno.serve(async(req:Request)=>{
 try{
  if(req.method!=='POST')return Response.json({error:'method_not_allowed'},{status:405});
  const workerToken=req.headers.get('x-pp-worker-token');
  if(workerToken){
   if(workerToken.length>200)return Response.json({error:'unauthorized'},{status:401});
   const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(workerToken)))).map(b=>b.toString(16).padStart(2,'0')).join('');
   if(digest!==workerTokenHash)return Response.json({error:'unauthorized'},{status:401});
   const results=await Promise.allSettled([runAiJob(),runEmailJob()]);
   return Response.json({ai:results[0].status==='fulfilled'?results[0].value:{error:'worker_unavailable'},email:results[1].status==='fulfilled'?results[1].value:{error:'worker_unavailable'}});
  }
  const raw=await req.text();
  if(raw.length>3000000)return Response.json({error:'too_large'},{status:413});
  const sig=req.headers.get('x-pp-signature')||'';
  let bytes:Uint8Array;
  try{bytes=Uint8Array.from(atob(sig),c=>c.charCodeAt(0));}catch{return Response.json({error:'unauthorized'},{status:401});}
  if(!await crypto.subtle.verify({name:'ECDSA',hash:'SHA-256'},key,bytes,new TextEncoder().encode(raw)))return Response.json({error:'unauthorized'},{status:401});
  const payload=JSON.parse(raw);
  if(payload.audience!=='public-problems-puducherry' || !Number.isFinite(payload.timestamp) || Math.abs(Date.now()-payload.timestamp)>60000 || !allowed.includes(payload.action))return Response.json({error:'unauthorized'},{status:401});
  await rpc('pp_claim_nonce',{p_nonce:payload.nonce});
  const {action,subject,data}=payload;
  if(subject!==null && (typeof subject!=='string'||subject.length>200))return Response.json({error:'invalid_request'},{status:400});
  if(['admin_ai_get','admin_ai_request','admin_ai_approve','ai_translation'].includes(action)){
   // Authorize even while disabled; a resident must never discover private job status.
   if(action.startsWith('admin_'))await rpc('pp_admin_dispatch',{p_action:'admin_session',p_subject:subject,p_data:{}});
   const enabled=action.startsWith('admin_')?aiEnabled(await aiConfig()):false;
   if(action==='admin_ai_request'&&!enabled)return Response.json({error:'ai_not_configured'},{status:503});
   const result=await rpc('pp_ai_dispatch',{p_action:action,p_subject:subject,p_data:data});
   return Response.json({...result,...(action.startsWith('admin_')?{enabled}: {})});
  }
  if(['notifications','notification_read','unfollow','admin_health'].includes(action)){
   const result=await rpc('pp_pilot_dispatch',{p_action:action,p_subject:subject,p_data:data});
   if(action==='admin_health'){const status=await rpc('pp_email_status',{p_subject:subject});const config=await emailConfig();return Response.json({...result,email:{...status,enabled:emailEnabled(config),recipient:administratorEmail}})}
   return Response.json(result);
  }
  if(action==='photo'){
   await rpc('pp_dispatch',{p_action:'upload_check',p_subject:subject,p_data:data});
   if(typeof data.base64!=='string'||data.base64.length>2800000)throw {status:413,code:'too_large'};
   let image;
   try{
    const original=Uint8Array.from(atob(data.base64),c=>c.charCodeAt(0));
    if(original[0]!==255 || original[1]!==216)throw new Error('format');
    const decoded=jpeg.decode(original,{useTArray:true,maxResolutionInMP:12,maxMemoryUsageInMB:64});
    image=jpeg.encode(decoded,80).data; // Re-encoding removes embedded metadata.
    if(image.byteLength>2097152)throw new Error('size');
   }catch{throw {status:400,code:'invalid_photo'};}
   const objectKey=`${data.id}/${crypto.randomUUID()}.jpg`;
   const upload=await fetch(`${projectUrl}/storage/v1/object/pp-private-photos/${objectKey}`,{method:'POST',headers:{...headers,'Content-Type':'image/jpeg','x-upsert':'false'},body:image});
   if(!upload.ok)throw {status:503,code:'storage_unavailable'};
   try{await rpc('pp_dispatch',{p_action:'photo_record',p_subject:subject,p_data:{id:data.id,key:objectKey,bytes:image.byteLength}});}
   catch(e){await fetch(`${projectUrl}/storage/v1/object/pp-private-photos`,{method:'DELETE',headers,body:JSON.stringify({prefixes:[objectKey]})});throw e;}
   return Response.json({ok:true});
  }
  if(action==='admin_photo'){
   const photo=await rpc('pp_admin_dispatch',{p_action:action,p_subject:subject,p_data:data});
   if(!photo?.key)throw {status:404,code:'not_found'};
   const res=await fetch(`${projectUrl}/storage/v1/object/authenticated/pp-private-photos/${photo.key}`,{headers});
   if(!res.ok)throw {status:503,code:'storage_unavailable'};
   const bytes=new Uint8Array(await res.arrayBuffer());
   let raw=''; for(let i=0;i<bytes.length;i+=8192)raw+=String.fromCharCode(...bytes.subarray(i,i+8192));
   return Response.json({base64:btoa(raw)});
  }
  const result=await rpc(action.startsWith('admin_')?'pp_admin_dispatch':'pp_dispatch',{p_action:action,p_subject:subject,p_data:data});
  return Response.json(result);
 }catch(e){const err=e as {status?:number;code?:string};return Response.json({error:err.code||'service_unavailable'},{status:err.status||503});}
});
