import {getUser} from '@/app/auth';
import {bridge} from '@/lib/server/bridge';
import {failure,readJson,sameOrigin} from '@/lib/server/http';
import {z} from 'zod';
export const dynamic='force-dynamic';
export async function POST(req:Request,ctx:{params:Promise<{id:string}>}){try{if(!sameOrigin(req))return Response.json({error:'forbidden'},{status:403});const u=await getUser();if(!u)return Response.json({error:'unauthorized'},{status:401});const {id}=await ctx.params;const body=z.object({base64:z.string().min(4).max(2800000)}).strict().safeParse(await readJson(req,2900000));if(!body.success||!z.string().uuid().safeParse(id).success)return Response.json({error:'invalid_request'},{status:400});return Response.json(await bridge('photo',u.userId,{id,...body.data}))}catch(e){return failure(e)}}
