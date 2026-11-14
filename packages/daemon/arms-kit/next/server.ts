import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE } from './index.ts';

/**
 * Where server code reaches the backend. In development the server runs in the sandbox, where the address the
 * browser uses means the sandbox itself; the studio gives the way out as SUPABASE_INTERNAL_URL. In production
 * that name is not set and both sides use the same address.
 */
const url = (): string => {
  const found = process.env.SUPABASE_INTERNAL_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!found || !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) throw new Error('NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY are not set. The studio writes them to .env.local when the schema is applied; restart the dev server after that.');
  return found;
};

/** The connection for Server Components, Route Handlers and Server Actions, as the user whose cookie came with the request. */
export async function serverClient() {
  const jar = await cookies();
  return createServerClient(url(), process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
    cookieOptions: { name: SESSION_COOKIE },
    cookies: {
      getAll: () => jar.getAll(),
      setAll: (list) => {
        try {
          for (const { name, value, options } of list) jar.set(name, value, options);
        } catch {
          // A Server Component may not set cookies. `keepSession` below renews the session on the way in instead.
        }
      },
    },
  });
}

/**
 * Renews the session on each request and passes the renewed cookie on. Call it from the project's
 * `middleware.ts` (`proxy.ts` from Next 16): `export const middleware = keepSession`. Without it a session
 * that has run out is never renewed on the server, and the user is signed out in the middle of their work.
 */
export async function keepSession(request: NextRequest): Promise<NextResponse> {
  let response = NextResponse.next({ request });
  const supabase = createServerClient(url(), process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
    cookieOptions: { name: SESSION_COOKIE },
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list) => {
        for (const { name, value } of list) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of list) response.cookies.set(name, value, options);
      },
    },
  });
  // Asking who the user is what renews the session. Nothing may run between making the client and this call.
  await supabase.auth.getUser();
  return response;
}
