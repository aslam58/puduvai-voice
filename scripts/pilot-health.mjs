// Read-only operations check. Requires the existing server signing key in environment.
// Deliberately emits counts and status codes only, never report text or credentials.
const keyText=process.env.PP_BRIDGE_PRIVATE_JWK;
if(!keyText){console.error('Set PP_BRIDGE_PRIVATE_JWK in the environment through your secret manager.');process.exit(2)}
const key=await crypto.subtle.importKey('jwk',JSON.parse(keyText),{name:'ECDSA',namedCurve:'P-256'},false,['sign']);
const subject=process.env.PP_ADMIN_SUBJECT;
if(!subject){console.error('Set PP_ADMIN_SUBJECT to the allowlisted administrator identity.');process.exit(2)}
const body=JSON.stringify({action:'admin_health',subject,data:{},timestamp:Date.now(),nonce:crypto.randomUUID(),audience:'public-problems-puducherry'});
try{
 const signature=Buffer.from(await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},key,new TextEncoder().encode(body))).toString('base64');
 const response=await fetch('https://ajwuxalyrhzratqqicfc.supabase.co/functions/v1/public-problems-bridge',{method:'POST',headers:{'Content-Type':'application/json','x-pp-signature':signature},body,signal:AbortSignal.timeout(30000)});
 if(!response.ok){console.error('Health request failed: HTTP '+response.status);process.exitCode=1}
 else{const h=await response.json();const old=h.oldest_pending&&Date.now()-Date.parse(h.oldest_pending)>86400000;
 const needsAttention=h.failed_ai>0||h.overdue_ai>0||old||(h.email?.failed??0)>0||(!h.email?.enabled&&(h.email?.queued??0)>0);
 console.log(JSON.stringify({status:needsAttention?'attention':'ok',checked_at:h.checked_at,pending_reports:h.pending_reports,pending_photos:h.pending_photos,failed_ai:h.failed_ai,overdue_ai:h.overdue_ai,moderation_over_24h:!!old,active_departments:h.active_departments,email_enabled:!!h.email?.enabled,email_queued:h.email?.queued??0,email_failed:h.email?.failed??0}));process.exitCode=needsAttention?1:0;}
}catch{console.error('Health service unreachable or invalid response.');process.exitCode=1}
