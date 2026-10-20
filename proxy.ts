import {createServerClient} from '@supabase/ssr';
import {NextResponse, type NextRequest} from 'next/server';
import {authUrl, authKey} from './lib/auth/config';

// Persist refreshed cookies before rendering the protected server component.
export async function proxy(request: NextRequest) {
 let response = NextResponse.next();
 const client = createServerClient(authUrl, authKey, {
  cookieOptions: {httpOnly:true, sameSite:'lax', path:'/', secure:process.env.NODE_ENV === 'production'},
  cookies: {
   getAll: () => request.cookies.getAll(),
   setAll(values, headers) {
    values.forEach(({name, value}) => request.cookies.set(name, value));
    response = NextResponse.next({request});
    values.forEach(({name, value, options}) => response.cookies.set(name, value, options));
    Object.entries(headers).forEach(([name, value]) => response.headers.set(name, value));
   },
  },
 });
 await client.auth.getUser();
 response.headers.set('Cache-Control', 'private, no-store');
 return response;
}
export const config = {matcher: ['/admin/:path*']};
