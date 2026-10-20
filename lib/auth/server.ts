import {createServerClient} from '@supabase/ssr';
import {cookies} from 'next/headers';

import {authUrl, authKey} from './config';
export async function authClient(readOnly = false) {
  const jar = await cookies();
  return createServerClient(authUrl, authKey, {
    cookieOptions: {httpOnly: true, sameSite: 'lax', path: '/', secure: process.env.NODE_ENV === 'production'},
    cookies: {
      getAll: () => jar.getAll(),
      setAll(values) {
        // Server components cannot write cookies. Route handlers persist refreshes.
        if (readOnly) return;
        values.forEach(({name, value, options}) => jar.set(name, value, options));
      },
    },
  });
}
export async function googleAvailable(): Promise<boolean> {
  try {
    const response = await fetch(authUrl + '/auth/v1/settings', {headers: {apikey: authKey}, cache: 'no-store', signal: AbortSignal.timeout(5000)});
    if (!response.ok) return false;
    const settings = await response.json() as {external?: {google?: boolean}};
    return settings.external?.google === true;
  } catch { return false; }
}
