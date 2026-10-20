const endpoint='https://ajwuxalyrhzratqqicfc.supabase.co/functions/v1/public-problems-bridge';
export class ApiError extends Error {constructor(public status:number,public code:string){super(code)}}
export async function bridge(action:string,subject:string|null,data:unknown={}){
 const privateJwk=process.env.PP_BRIDGE_PRIVATE_JWK;
 if(!privateJwk)throw new ApiError(503,'service_unavailable');
 const key=await crypto.subtle.importKey('jwk',JSON.parse(privateJwk),{name:'ECDSA',namedCurve:'P-256'},false,['sign']);
 const body=JSON.stringify({action,subject,data,timestamp:Date.now(),nonce:crypto.randomUUID(),audience:'public-problems-puducherry'});
 const signature=await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},key,new TextEncoder().encode(body));
 const res=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json','x-pp-signature':btoa(String.fromCharCode(...new Uint8Array(signature)))},body,signal:AbortSignal.timeout(25000)});
 const result=await res.json() as {error?:string};
 if(!res.ok)throw new ApiError(res.status,result.error||'service_unavailable');
 return result;
}
