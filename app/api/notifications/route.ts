import {getUser} from '@/app/auth';
import {bridge} from '@/lib/server/bridge';
import {failure,readJson,sameOrigin} from '@/lib/server/http';
import {z} from 'zod';
export const dynamic='force-dynamic';
const headers={'Cache-Control':'private, no-store'};
export async function GET(req:Request){try{
 const user=await getUser();if(!user)return Response.json({error:'unauthorized'},{status:401,headers});
 const offset=z.coerce.number().int().min(0).max(10000).safeParse(new URL(req.url).searchParams.get('offset')||0);
 if(!offset.success)return Response.json({error:'invalid_request'},{status:400,headers});
 return Response.json(await bridge('notifications',user.userId,{offset:offset.data}),{headers});
}catch(e){return failure(e)}}
export async function POST(req:Request){try{
 if(!sameOrigin(req))return Response.json({error:'forbidden'},{status:403,headers});
 const user=await getUser();if(!user)return Response.json({error:'unauthorized'},{status:401,headers});
 const data=z.object({id:z.string().uuid()}).strict().safeParse(await readJson(req));
 if(!data.success)return Response.json({error:'invalid_request'},{status:400,headers});
 return Response.json(await bridge('notification_read',user.userId,data.data),{headers});
}catch(e){return failure(e)}}
