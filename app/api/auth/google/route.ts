import {authClient, googleAvailable} from '@/lib/auth/server';
import {safeReturnPath, signInPath} from '@/lib/auth/paths';
import {sameOrigin} from '@/lib/server/http';
export const dynamic = 'force-dynamic';
export async function POST(req: Request) {
  if (!sameOrigin(req)) return new Response('Forbidden', {status: 403});
  const returnTo = safeReturnPath(new URL(req.url).searchParams.get('return_to'));
  const failed = () => new Response(null, {status: 303, headers: {Location: signInPath(returnTo) + '&error=google', 'Cache-Control': 'private, no-store'}});
  try {
    if (!await googleAvailable()) return failed();
    const callback = new URL('/auth/callback', req.url);
    callback.searchParams.set('return_to', returnTo);
    const client = await authClient();
    const {data, error} = await client.auth.signInWithOAuth({provider: 'google', options: {redirectTo: callback.toString(), skipBrowserRedirect: true}});
    if (error || !data.url) return failed();
    return new Response(null, {status: 303, headers: {Location: data.url, 'Cache-Control': 'private, no-store'}});
  } catch { return failed(); }
}
