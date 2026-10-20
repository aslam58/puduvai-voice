import {z} from 'zod';
import {authClient} from '@/lib/auth/server';
import {safeReturnPath} from '@/lib/auth/paths';
import {failure, readJson, sameOrigin} from '@/lib/server/http';
export const dynamic = 'force-dynamic';
const headers = {'Cache-Control': 'private, no-store'};
export async function POST(req: Request) {
  try {
    if (!sameOrigin(req)) return Response.json({error: 'forbidden'}, {status: 403, headers});
    const parsed = z.object({email: z.string().trim().email().max(254), returnTo: z.string().max(2048).optional()}).strict().safeParse(await readJson(req, 4096));
    if (!parsed.success) return Response.json({error: 'invalid_email'}, {status: 400, headers});
    const callback = new URL('/auth/callback', req.url);
    callback.searchParams.set('return_to', safeReturnPath(parsed.data.returnTo));
    const client = await authClient();
    const {error} = await client.auth.signInWithOtp({email: parsed.data.email, options: {emailRedirectTo: callback.toString()}});
    if (error) return Response.json({error: error.status === 429 ? 'rate_limit' : 'email_unavailable'}, {status: error.status === 429 ? 429 : 503, headers});
    return Response.json({sent: true}, {headers});
  } catch (error) { return failure(error); }
}
