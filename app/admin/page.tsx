import {Brand} from '@/components/brand';
import {requireUser} from '@/app/auth';
import {bridge,ApiError} from '@/lib/server/bridge';
import {AdminConsole} from '@/components/admin-console';
export const dynamic='force-dynamic';
export default async function AdminPage(){const u=await requireUser('/admin');try{await bridge('admin_session',`email:${u.email.toLowerCase()}`)}catch(e){return <main><Brand/><h1>Administrator access</h1><p>{e instanceof ApiError&&e.status===403?'This account does not have administrator access.':'Administrator service is unavailable. Please try again.'}</p></main>}return <AdminConsole/>}
