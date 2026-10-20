import {getUser} from '@/app/auth';
import {bridge} from '@/lib/server/bridge';
import {failure,readJson,sameOrigin} from '@/lib/server/http';
import {filterSchema,reportSchema} from '@/lib/report-validation';
export const dynamic='force-dynamic';
const noStore={'Cache-Control':'private, no-store'};
export async function GET(req:Request){try{
 const url=new URL(req.url); const filters=filterSchema.safeParse(Object.fromEntries(url.searchParams));
 if(!filters.success)return Response.json({error:'invalid_request'},{status:400});
 const user=await getUser();const mine=url.searchParams.get('mine')==='true';
 if(mine&&!user)return Response.json({error:'unauthorized'},{status:401});
 const nearby=url.searchParams.get('nearby')==='true';
 const action=url.searchParams.get('stats')==='true'?'stats':nearby?'nearby':mine?'mine':'list';
 const data:Record<string,unknown>={...filters.data,...(url.searchParams.get('map')==='true'?{map:true,offset:0}:{})};
 if(nearby){const area=url.searchParams.get('area')?.trim(),constituency=Number(url.searchParams.get('constituency'));if(!area||area.length>120||!Number.isInteger(constituency)||constituency<1||constituency>30)return Response.json({error:'invalid_request'},{status:400});data.area=area;data.constituency=constituency}

 return Response.json(await bridge(action,user?.userId||null,data),{headers:noStore});
 }catch(e){return failure(e)}}
export async function POST(req:Request){try{
 if(!sameOrigin(req))return Response.json({error:'forbidden'},{status:403});
 const user=await getUser();if(!user)return Response.json({error:'unauthorized'},{status:401});
 const parsed=reportSchema.safeParse(await readJson(req));if(!parsed.success)return Response.json({error:'invalid_request'},{status:400});
 return Response.json(await bridge('create',user.userId,parsed.data),{status:201,headers:noStore});
 }catch(e){return failure(e)}}
