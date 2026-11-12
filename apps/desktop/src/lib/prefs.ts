import { useSyncExternalStore } from 'react';

export type ThemePreset = 'studio-dark' | 'tokyo-night' | 'catppuccin-mocha' | 'clean-light' | 'system';
export type MonoFont = 'geist-mono' | 'jetbrains-mono' | 'd2coding' | 'fira-code' | 'sf-mono';

export interface Prefs {
  theme: ThemePreset;
  mono: MonoFont;
}

/** Each preset is a seed for the theme generator (see scripts/theme.mjs); `system` follows the OS light/dark setting. */
export const THEME_PRESETS: readonly { id: ThemePreset; label: string; note: string }[] = [
  { id: 'studio-dark', label: 'Studio Dark', note: '어두운 아연색 바탕에 인디고 강조색' },
  { id: 'tokyo-night', label: 'Tokyo Night', note: '남색이 도는 어두운 바탕' },
  { id: 'catppuccin-mocha', label: 'Catppuccin Mocha', note: '보랏빛이 도는 어두운 바탕' },
  { id: 'clean-light', label: 'Clean Light', note: '밝은 바탕' },
  { id: 'system', label: '시스템 설정 따르기', note: 'macOS의 라이트·다크 설정을 따릅니다' },
];

/**
 * Code faces. Geist Mono, JetBrains Mono and Fira Code ship with the app. D2Coding and SF Mono are used when
 * this machine has them; otherwise the stack falls through to Geist Mono.
 */
export const MONO_FONTS: readonly { id: MonoFont; label: string; stack: string; bundled: boolean; probe: string }[] = [
  { id: 'geist-mono', label: 'Geist Mono', stack: '"Geist Mono"', bundled: true, probe: 'Geist Mono' },
  { id: 'jetbrains-mono', label: 'JetBrains Mono', stack: '"JetBrains Mono", "Geist Mono"', bundled: true, probe: 'JetBrains Mono' },
  { id: 'd2coding', label: 'D2Coding', stack: '"D2Coding", "D2Coding ligature", "Geist Mono"', bundled: false, probe: 'D2Coding' },
  { id: 'fira-code', label: 'Fira Code', stack: '"Fira Code", "Geist Mono"', bundled: true, probe: 'Fira Code' },
  { id: 'sf-mono', label: 'SF Mono', stack: '"SF Mono", "SFMono-Regular", ui-monospace, "Geist Mono"', bundled: false, probe: 'SF Mono' },
];

const KEY = 'studio-zero.prefs';
const DEFAULTS: Prefs = { theme: 'studio-dark', mono: 'geist-mono' };

function load(): Prefs {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<Prefs> | null;
    return {
      theme: THEME_PRESETS.some((p) => p.id === saved?.theme) ? saved!.theme! : DEFAULTS.theme,
      mono: MONO_FONTS.some((f) => f.id === saved?.mono) ? saved!.mono! : DEFAULTS.mono,
    };
  } catch {
    return DEFAULTS;
  }
}

let current = load();
const listeners = new Set<() => void>();

/** Puts the preferences on <html>, where the stylesheet reads them: a preset attribute and the code-face variable. */
export function applyPrefs(prefs: Prefs = current): void {
  const root = document.documentElement;
  if (prefs.theme === 'system') delete root.dataset.preset;
  else root.dataset.preset = prefs.theme;
  root.style.setProperty('--sz-font-mono', MONO_FONTS.find((f) => f.id === prefs.mono)!.stack);
}

export function setPrefs(patch: Partial<Prefs>): void {
  current = { ...current, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    // Private windows refuse storage: the choice still holds until the window closes.
  }
  applyPrefs();
  listeners.forEach((l) => l());
}

export function usePrefs(): Prefs {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => current,
  );
}

/** The font stack the terminal should use right now (it draws on a canvas and cannot read a CSS variable). */
export function monoStack(prefs: Prefs): string {
  return `${MONO_FONTS.find((f) => f.id === prefs.mono)!.stack}, ui-monospace, monospace`;
}

/**
 * Whether a face that does not ship with the app is installed on this machine: text set in it measures
 * differently from the same text in the fallback alone.
 */
export function fontInstalled(family: string): boolean {
  const ctx = document.createElement('canvas').getContext('2d');
  if (!ctx) return false;
  const sample = 'mmmmmmmmlliWW@#가나다0O';
  const width = (font: string): number => ((ctx.font = `72px ${font}`), ctx.measureText(sample).width);
  return width(`"${family}", monospace`) !== width('monospace') || width(`"${family}", serif`) !== width('serif');
}
