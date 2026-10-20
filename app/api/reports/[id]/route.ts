import {getUser} from '@/app/auth';
import {bridge} from '@/lib/server/bridge';
import {failure,readJson,sameOrigin} from '@/lib/server/http';
import {z} from 'zod';
export const dynamic='force-dynamic';
type Context={params:Promise<{id:string}>};
export async function GET(req:Request,ctx:Context){try{const {id}=await ctx.params;if(!z.string().uuid().safeParse(id).success)return Response.json({error:'not_found'},{status:404});const u=await getUser();return Response.json(await bridge('detail',u?.userId||null,{id}),{headers:{'Cache-Control':'private, no-store'}})}catch(e){return failure(e)}}
export async function POST(req:Request,ctx:Context){try{if(!sameOrigin(req))return Response.json({error:'forbidden'},{status:403});const u=await getUser();if(!u)return Response.json({error:'unauthorized'},{status:401});const {id}=await ctx.params;const body=z.discriminatedUnion('action',[z.object({action:z.enum(['support','follow','unfollow'])}).strict(),z.object({action:z.literal('outage_end_update'),outageEndedAt:z.string().datetime({offset:true})}).strict()]).safeParse(await readJson(req));if(!body.success||!z.string().uuid().safeParse(id).success)return Response.json({error:'invalid_request'},{status:400});return Response.json(await bridge(body.data.action,u.userId,{id,...body.data}))}catch(e){return failure(e)}}
