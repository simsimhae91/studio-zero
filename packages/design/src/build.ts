import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createTheme, renderThemeCss, type ThemeSeed } from './theme.ts';

/** The reference seed shipped as `@studio-zero/design/theme.css`. Projects get their own via `seedFromName`. */
export const referenceSeed: ThemeSeed = { hue: 168, chroma: 0.12, neutralChroma: 0.005, corners: 'soft' };

export const referenceThemePath = fileURLToPath(new URL('../theme.css', import.meta.url));

/**
 * The reference sheet as it is committed. It ships as a package export with no fonts folder beside it, so it names
 * the face and points at no file: whoever imports it loads the face in its own way.
 */
export const renderReferenceTheme = (): string => renderThemeCss(createTheme(referenceSeed), undefined, { fontFiles: false });

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  writeFileSync(referenceThemePath, renderReferenceTheme());
  process.stdout.write(`wrote ${referenceThemePath}\n`);
}
