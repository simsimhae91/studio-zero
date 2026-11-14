import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { ProjectTemplate } from '@studio-zero/protocol';
import { readKit, type KitFile } from '../harness/kitSource.ts';
import type { StackInfo } from './SupabaseStack.ts';

/**
 * What a project is handed of its backend: a client written for its framework, and the backend's address and
 * publishable key under the names that framework reads. Nothing else of the stack goes into a sandbox.
 */

/** Where the kit goes in a project, beside the theme and the other kits. */
export const ARMS_KIT_DIR = '.studio-zero/arms-kit';
export const ARMS_KIT_ENTRY = `${ARMS_KIT_DIR}/index.ts`;
/**
 * The file all three frameworks read by themselves, in development and when they build. The studio keeps one
 * marked block in it and leaves the rest to the project.
 */
export const ENV_FILE = '.env.local';

interface Variant {
  /** The kit's folder for this kind of project. */
  folder: 'web' | 'next' | 'expo';
  /** What a browser-side variable must begin with to reach the client code. */
  prefix: string;
  /** What the project installs to use the kit. */
  packages: string[];
}

const VARIANTS: Partial<Record<ProjectTemplate, Variant>> = {
  'web-vite-react': { folder: 'web', prefix: 'VITE_', packages: ['@supabase/supabase-js'] },
  'web-next': { folder: 'next', prefix: 'NEXT_PUBLIC_', packages: ['@supabase/supabase-js', '@supabase/ssr'] },
  'mobile-expo': { folder: 'expo', prefix: 'EXPO_PUBLIC_', packages: ['@supabase/supabase-js', '@react-native-async-storage/async-storage', 'react-native-url-polyfill'] },
};

/** The studio's own repository has no backend of this kind; every product template has. */
export const variantOf = (template: ProjectTemplate): Variant | null => VARIANTS[template] ?? null;

/** The names the kit reads, for this kind of project. */
export function envNames(template: ProjectTemplate): { url: string; key: string; logins: string; internalUrl: string | null } | null {
  const variant = variantOf(template);
  if (!variant) return null;
  // Only a framework with server code of its own runs code in the sandbox that must reach the backend from there.
  return { url: `${variant.prefix}SUPABASE_URL`, key: `${variant.prefix}SUPABASE_PUBLISHABLE_KEY`, logins: `${variant.prefix}SUPABASE_LOGINS`, internalUrl: variant.folder === 'next' ? 'SUPABASE_INTERNAL_URL' : null };
}

const OPEN = '# >>> Studio Zero backend. Rewritten by the studio: put your own lines outside this block.';
const CLOSE = '# <<< Studio Zero backend';

/** The studio's block of `.env.local`: the address a browser on this Mac reaches the backend at, and the key that is safe to ship. */
export function envBlock(template: ProjectTemplate, info: Pick<StackInfo, 'apiUrl' | 'apiUrlFromSandbox' | 'publishableKey' | 'logins'>): string | null {
  const names = envNames(template);
  if (!names) return null;
  const lines = [
    OPEN,
    '# This project\'s own Supabase on this Mac. Both values are public: they ship in what a browser downloads.',
    '# In production, set the same names to the hosted project\'s URL and publishable key.',
    `${names.url}=${info.apiUrl}`,
    `${names.key}=${info.publishableKey}`,
    '# The providers a person can sign in with here besides email (the studio\'s shared developer apps). Empty: email only.',
    `${names.logins}=${info.logins.join(',')}`,
  ];
  if (names.internalUrl) lines.push('# Server code in this sandbox reaches the same backend here. Not set in production.', `${names.internalUrl}=${info.apiUrlFromSandbox}`);
  return [...lines, CLOSE].join('\n');
}

/** Puts the studio's block into what the file holds, replacing an earlier block and keeping every other line. */
export function withEnvBlock(existing: string, block: string): string {
  const from = existing.indexOf(OPEN);
  const to = existing.indexOf(CLOSE, from === -1 ? 0 : from);
  if (from !== -1 && to !== -1) return `${existing.slice(0, from)}${block}${existing.slice(to + CLOSE.length)}`;
  const kept = existing.trimEnd();
  return `${kept === '' ? '' : `${kept}\n\n`}${block}\n`;
}

/**
 * Every file of the backend kit as it should be written into a project of this template, with paths relative to
 * `ARMS_KIT_DIR`: the rules every engine reads, and the client for its framework. The source is beside the
 * bundle of a built daemon, and in the daemon's package in development. It is not under `src`: it is written
 * against packages a product installs and the studio does not.
 */
export async function armsKitFiles(template: ProjectTemplate): Promise<KitFile[]> {
  const variant = variantOf(template);
  if (!variant) return [];
  const roots = [new URL('./arms-kit/', import.meta.url), new URL('../../arms-kit/', import.meta.url)].map((url) => fileURLToPath(url));
  const root = roots.find((dir) => existsSync(join(dir, 'README.md')));
  if (!root) throw new Error(`the backend kit was not found (looked in ${roots.join(', ')})`);
  const client = await readKit('backend kit', [pathToFileURL(`${join(root, variant.folder)}/`)]);
  return [{ path: 'README.md', content: await readFile(join(root, 'README.md'), 'utf8') }, ...client];
}
