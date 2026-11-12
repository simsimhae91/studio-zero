import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createTheme, renderThemeCss, type ThemeSeed } from './theme.ts';

/** The reference seed shipped as `@studio-zero/design/theme.css`. Projects get their own via `seedFromName`. */
export const referenceSeed: ThemeSeed = { hue: 168, chroma: 0.12, neutralChroma: 0.008, corners: 'soft' };

export const referenceThemePath = fileURLToPath(new URL('../theme.css', import.meta.url));

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  writeFileSync(referenceThemePath, renderThemeCss(createTheme(referenceSeed)));
  process.stdout.write(`wrote ${referenceThemePath}\n`);
}
