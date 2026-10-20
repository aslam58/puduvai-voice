import {getUser} from '@/app/auth';
import {bridge} from '@/lib/server/bridge';
import {failure} from '@/lib/server/http';
import {z} from 'zod';
export const dynamic='force-dynamic';
export async function GET(req:Request,{params}:{params:Promise<{id:string}>}){
 try{
  const {id}=await params;const language=new URL(req.url).searchParams.get('language');
  if(!z.string().uuid().safeParse(id).success||!z.enum(['en','ta','hi']).safeParse(language).success)return Response.json({error:'invalid_request'},{status:400});
  const user=await getUser();
  return Response.json(await bridge('ai_translation',user?.userId||null,{id,language}),{headers:{'Cache-Control':'private, no-store'}});
 }catch(e){return failure(e)}
}
