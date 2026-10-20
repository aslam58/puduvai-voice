import {authClient} from '@/lib/auth/server';
import {safeReturnPath, signInPath} from '@/lib/auth/paths';
export const dynamic = 'force-dynamic';
export async function GET(req: Request) {
  const url = new URL(req.url);
  const returnTo = safeReturnPath(url.searchParams.get('return_to'));
  const code = url.searchParams.get('code');
  if (code && code.length <= 4096) {
    try {
      const client = await authClient();
      const {error} = await client.auth.exchangeCodeForSession(code);
      if (!error) return new Response(null, {status: 303, headers: {Location: returnTo, 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer'}});
    } catch {}
  }
  return new Response(null, {status: 303, headers: {Location: signInPath(returnTo) + '&error=callback', 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer'}});
}
