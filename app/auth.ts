import {redirect} from 'next/navigation';
import {authClient} from '@/lib/auth/server';
import {signInPath} from '@/lib/auth/paths';
export type AppUser = {userId: string; displayName: string; email: string; fullName: string | null};
export async function getUser(readOnly = false): Promise<AppUser | null> {
  const client = await authClient(readOnly);
  // Verify with Auth rather than trusting cookie contents or proxy identity headers.
  const {data: {user}, error} = await client.auth.getUser();
  if (error || !user?.email || !user.email_confirmed_at) return null;
  const fullName = typeof user.user_metadata?.full_name === 'string' ? user.user_metadata.full_name : null;
  return {userId: 'supabase:' + user.id, displayName: fullName || user.email, email: user.email, fullName};
}
export async function requireUser(returnTo: string): Promise<AppUser> {
  const user = await getUser(true);
  if (user) return user;
  redirect(signInPath(returnTo));
}
