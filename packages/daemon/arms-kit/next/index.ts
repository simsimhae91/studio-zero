import { createBrowserClient } from '@supabase/ssr';

/**
 * The name the session's cookie is kept under. It is fixed here because the default is made from the backend's
 * address, and in development the browser and the server reach the backend at different addresses: left to the
 * default, the server would look for a cookie the browser never set.
 */
export const SESSION_COOKIE = 'sb-session';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

/** The connection for Client Components. The session lives in a cookie, so the server sees the same user. */
export function browserClient() {
  if (!url || !key) throw new Error('NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY are not set. The studio writes them to .env.local when the schema is applied; restart the dev server after that.');
  return createBrowserClient(url, key, { cookieOptions: { name: SESSION_COOKIE } });
}
