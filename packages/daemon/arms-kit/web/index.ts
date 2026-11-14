import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;
if (!url || !key) throw new Error('VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY are not set. The studio writes them to .env.local when the schema is applied; restart the dev server after that.');

/**
 * The product's one connection to its backend. The session is kept in the browser and renewed by itself; a
 * request made while signed in carries the user, and the database's policies decide what it may touch.
 */
export const supabase = createClient(url, key);

/**
 * The providers a person can sign in with here besides email, as the studio set them up: 'kakao', 'google' or
 * neither. Show a button for each of these and for no other. In production the same name lists the providers
 * the product's own developer apps are registered with.
 */
export const logins = ((import.meta.env.VITE_SUPABASE_LOGINS as string | undefined) ?? '').split(',').filter(Boolean) as ('kakao' | 'google')[];
