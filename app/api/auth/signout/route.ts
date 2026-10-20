import {authClient} from '@/lib/auth/server';
import {failure, sameOrigin} from '@/lib/server/http';
export async function POST(req: Request) {
  if (!sameOrigin(req)) return Response.json({error: 'forbidden'}, {status: 403});
  try {
    const client = await authClient();
    const {error} = await client.auth.signOut({scope: 'local'});
    if (error) return Response.json({error: 'signout_failed'}, {status: 503});
    return Response.json({signedIn: false}, {headers: {'Cache-Control': 'private, no-store'}});
  } catch (error) { return failure(error); }
}
