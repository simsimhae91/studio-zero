import { invoke, isTauri } from '@tauri-apps/api/core';

/** True inside the Tauri shell (desktop or mobile); false in a plain browser tab during development. */
export const inTauri = isTauri();

/**
 * The token the daemon on this Mac created on first boot, read from the macOS Keychain by the native shell.
 * null when there is no local daemon, on mobile, and in a browser.
 */
export async function localClientToken(): Promise<string | null> {
  if (!inTauri) return null;
  try {
    return await invoke<string | null>('local_client_token');
  } catch {
    return null;
  }
}

/** Tokens for remote daemons live in the OS keychain, keyed by host. A browser tab keeps nothing between reloads. */
export async function loadToken(host: string): Promise<string | null> {
  if (!inTauri) return null;
  try {
    return await invoke<string | null>('load_token', { host });
  } catch {
    return null;
  }
}

export async function saveToken(host: string, token: string): Promise<void> {
  if (inTauri) await invoke('save_token', { host, token });
}

export async function forgetToken(host: string): Promise<void> {
  if (inTauri) await invoke('forget_token', { host });
}
