import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

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

/**
 * The menu-bar item of the desktop shell. A choice made there arrives as `onRequest`; the returned function
 * stops listening. In a browser tab and on a phone there is no menu bar and this does nothing.
 */
export function onTrayPowerRequest(onRequest: (mode: string) => void): () => void {
  if (!inTauri) return () => undefined;
  let stop: (() => void) | null = null;
  let stopped = false;
  void listen<string>('power-request', (event) => onRequest(event.payload))
    .then((unlisten) => (stopped ? unlisten() : void (stop = unlisten)))
    .catch(() => undefined);
  return () => {
    stopped = true;
    stop?.();
  };
}

/** Moves the menu-bar check mark to what the daemon says the mode is. */
export async function markTrayPower(mode: string): Promise<void> {
  if (inTauri) await invoke('mark_power', { mode }).catch(() => undefined);
}
