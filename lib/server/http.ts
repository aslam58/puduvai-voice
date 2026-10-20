import {ApiError} from './bridge';
export function failure(e:unknown){if(e instanceof ApiError)return Response.json({error:e.code},{status:e.status,headers:{'Cache-Control':'private, no-store'}});return Response.json({error:'service_unavailable'},{status:503,headers:{'Cache-Control':'private, no-store'}});}
export function sameOrigin(req:Request){return req.headers.get('origin')===new URL(req.url).origin;}
export async function readJson(req:Request,max=16000){const text=await req.text();if(text.length>max)throw new ApiError(413,'too_large');try{return JSON.parse(text)}catch{throw new ApiError(400,'invalid_request')}}
