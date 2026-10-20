// Server-only Resend adapter. Recipient is deliberately fixed to the pilot owner.
export const administratorEmail='admin@example.com';
const origin='https://puduvaivoice.online';
export type EmailConfig={apiKey:string;from:string;enabled:boolean};
export type EmailJob={id:string;reportId:string;kind:'report'|'photo';lease:string};
export class EmailError extends Error{constructor(public code:string,public retry:boolean){super(code)}}
export function emailEnabled(c:EmailConfig){return c.enabled&&!!c.apiKey&&/^[^\r\n]+@[^\r\n]+$/.test(c.from)}
export async function sendAdministratorEmail(job:EmailJob,config:EmailConfig,request:typeof fetch=fetch){
 if(!emailEnabled(config))throw new EmailError('configuration_error',false);
 if(!/^[0-9a-f-]{36}$/i.test(job.id)||!/^[0-9a-f-]{36}$/i.test(job.reportId)||!['report','photo'].includes(job.kind))throw new EmailError('invalid_response',false);
 const subject=job.kind==='photo'?'Puduvai Voice: new photo awaiting review':'Puduvai Voice: new report awaiting review';
 // No resident-written text, contact details, coordinates or photo bytes leave the backend.
 const text=`${subject}\n\nSign in as the administrator to review it:\n${origin}/admin?report=${job.reportId}\n\nReport reference: ${job.reportId}\n\nYou receive this alert because you are the daily pilot reviewer.`;
 let response:Response;
 try{response=await request('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${config.apiKey}`,'Content-Type':'application/json','Idempotency-Key':`pp-admin-${job.id}`},body:JSON.stringify({from:config.from,to:[administratorEmail],subject,text}),signal:AbortSignal.timeout(15000)})}catch{throw new EmailError('provider_unavailable',true)}
 if(!response.ok)throw new EmailError(response.status===429?'provider_rate_limit':response.status>=500?'provider_unavailable':'configuration_error',response.status===429||response.status>=500);
 let data:{id?:unknown};try{data=await response.json()}catch{throw new EmailError('invalid_response',true)}
 if(typeof data.id!=='string'||data.id.length<1||data.id.length>200)throw new EmailError('invalid_response',true);
 return data.id;
}
