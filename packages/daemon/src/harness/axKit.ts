import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Where the kit goes in a project, beside the theme. */
export const AX_DIR = '.studio-zero/ax';
export const AX_ENTRY = `${AX_DIR}/index.ts`;

/** The kit's source: copied next to the bundle in a built daemon, in the workspace package in development. */
function locateKit(): string {
  const candidates = [new URL('./ax-kit/', import.meta.url), new URL('../../../ax/src/', import.meta.url)].map((u) => fileURLToPath(u));
  const found = candidates.find((dir) => existsSync(join(dir, 'index.ts')));
  if (!found) throw new Error(`the AX kit was not found (looked in ${candidates.join(', ')})`);
  return found;
}

/**
 * The kit's own imports name files with their extension (`./stream.ts`), which is what Node needs to run them
 * directly. A scaffolded app's compiler usually rejects that, and every bundler resolves the bare path, so the
 * copy in a project has the extensions removed.
 */
export function forBundlers(source: string): string {
  return source.replace(/(\bfrom\s+['"]\.{1,2}\/[^'"]+?)\.tsx?(['"])/g, '$1$2');
}

async function walk(dir: string): Promise<string[]> {
  // Dot entries are editor and tool droppings, never part of the kit.
  const entries = (await readdir(dir, { withFileTypes: true })).filter((e) => !e.name.startsWith('.'));
  const nested = await Promise.all(entries.map((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)])));
  return nested.flat();
}

/** Every file of the kit as it should be written into a project, with paths relative to `AX_DIR`. */
export async function kitFiles(): Promise<{ path: string; content: string }[]> {
  const root = locateKit();
  const files = (await walk(root)).filter((f) => /\.(tsx?|md)$/.test(f)).sort();
  return Promise.all(
    files.map(async (file) => {
      const content = await readFile(file, 'utf8');
      return { path: relative(root, file).split('\\').join('/'), content: file.endsWith('.md') ? content : forBundlers(content) };
    }),
  );
}
