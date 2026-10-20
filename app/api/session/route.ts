import {getUser} from '@/app/auth';
export const dynamic='force-dynamic';
export async function GET(){const user=await getUser();return Response.json({signedIn:!!user},{headers:{'Cache-Control':'private, no-store'}})}
