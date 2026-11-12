import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface KitFile {
  /** Relative to the kit's folder in a project. */
  path: string;
  content: string;
}

/**
 * A kit's own imports name files with their extension (`./stream.ts`), which is what Node needs to run them
 * directly. A scaffolded app's compiler usually rejects that, and every bundler resolves the bare path, so the
 * copy in a project has the extensions removed.
 */
export function forBundlers(source: string): string {
  return source.replace(/(\bfrom\s+['"]\.{1,2}\/[^'"]+?)\.tsx?(['"])/g, '$1$2');
}

async function walk(dir: string): Promise<string[]> {
  // Dot entries are editor and tool droppings, never part of a kit.
  const entries = (await readdir(dir, { withFileTypes: true })).filter((e) => !e.name.startsWith('.'));
  const nested = await Promise.all(entries.map((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)])));
  return nested.flat();
}

/**
 * Every file of a kit as it should be written into a project. A kit is source the daemon ships and a project
 * then owns: `candidates` are where that source can be, the copy beside the bundle of a built daemon first,
 * then the workspace package in development. The first folder that holds an `index.ts` is the kit.
 */
export async function readKit(name: string, candidates: readonly URL[]): Promise<KitFile[]> {
  const dirs = candidates.map((u) => fileURLToPath(u));
  const root = dirs.find((dir) => existsSync(join(dir, 'index.ts')));
  if (!root) throw new Error(`the ${name} was not found (looked in ${dirs.join(', ')})`);
  const files = (await walk(root)).filter((f) => /\.(tsx?|md)$/.test(f)).sort();
  return Promise.all(
    files.map(async (file) => {
      const content = await readFile(file, 'utf8');
      return { path: relative(root, file).split('\\').join('/'), content: file.endsWith('.md') ? content : forBundlers(content) };
    }),
  );
}
