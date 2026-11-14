import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { AppState, Platform } from 'react-native';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const key = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
if (!url || !key) throw new Error('EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY are not set. The studio writes them to .env.local when the schema is applied; restart the dev server after that.');

/** The web target is first rendered where there is no browser; nothing is kept there. */
const nowhere = { getItem: async (): Promise<string | null> => null, setItem: async (): Promise<void> => undefined, removeItem: async (): Promise<void> => undefined };
const storage = Platform.OS === 'web' && typeof window === 'undefined' ? nowhere : AsyncStorage;

/**
 * The product's one connection to its backend. The session is kept on the device and renewed by itself; a
 * request made while signed in carries the user, and the database's policies decide what it may touch.
 */
export const supabase = createClient(url, key, {
  auth: { storage, autoRefreshToken: true, persistSession: true, detectSessionInUrl: Platform.OS === 'web' },
});

// A phone stops an app's timers when it leaves the screen, so the session is renewed only while it is in front.
if (Platform.OS !== 'web') {
  AppState.addEventListener('change', (state) => {
    if (state === 'active') void supabase.auth.startAutoRefresh();
    else void supabase.auth.stopAutoRefresh();
  });
}
