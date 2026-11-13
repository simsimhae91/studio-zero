import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { FACE_FILES_DIR, faceFiles, type Face } from '@studio-zero/design';

/**
 * Where a project's face goes: the folder the theme stylesheet's `@font-face` points into, beside the sheet.
 * A project holds the file of the one face it is set in.
 */
export const FONT_DIR = `.studio-zero/${FACE_FILES_DIR}`;

const require = createRequire(import.meta.url);

/**
 * Where a face's variable file is on this machine. Pretendard and SUIT come from their publishers' packages.
 * SUITE is published on GitHub only, so the studio carries the file itself, with its licence: beside the bundle
 * of a built daemon first, then in the design package in development. Throws when the file is not here.
 */
export function fontPath(face: Face): string {
  if (face === 'pretendard') return require.resolve('pretendard/dist/web/variable/woff2/PretendardVariable.woff2');
  if (face === 'suit') return require.resolve('@sun-typeface/suit/fonts/variable/woff2/SUIT-Variable.woff2');
  const candidates = [new URL('./fonts/suite/', import.meta.url), new URL('../../../design/fonts/suite/', import.meta.url)].map((dir) => fileURLToPath(new URL(faceFiles.suite.file, dir)));
  const found = candidates.find((path) => existsSync(path));
  if (!found) throw new Error(`the SUITE face was not found (looked in ${candidates.join(', ')})`);
  return found;
}

/**
 * The file of a face as it is written into a project: under the name the theme stylesheet points at, so the two
 * cannot come apart. An engine is never asked to find or install a face, which is how one that is not on npm
 * can be offered at all.
 */
export function fontFile(face: Face): { name: string; read: () => Promise<Buffer> } {
  return { name: faceFiles[face].file, read: () => readFile(fontPath(face)) };
}
