// Generates src/styles/theme.css from the design contract. The app is built with the same theme generator,
// lint and audit it applies to the projects it builds.
import { writeFileSync } from 'node:fs';
import { colorTokens, createTheme, formatOklch, renderThemeCss } from '@studio-zero/design';

// Zinc neutrals with an indigo accent: quiet enough to sit beside someone else's product all day.
const base = createTheme({ hue: 277, chroma: 0.17, neutralChroma: 0.006, corners: 'soft' });

/**
 * Presets the owner can pick in Settings. Each is a seed for the same generator, shown in one scheme, so every
 * preset keeps the contract's contrast (text tokens are solved, not copied from a palette file). They are named
 * for the editor themes they lean towards, not ports of them.
 */
const presets = [
  { id: 'studio-dark', scheme: 'dark', palette: base.dark },
  { id: 'tokyo-night', scheme: 'dark', palette: createTheme({ hue: 265, chroma: 0.13, neutralChroma: 0.03, corners: 'soft' }).dark },
  { id: 'catppuccin-mocha', scheme: 'dark', palette: createTheme({ hue: 300, chroma: 0.11, neutralChroma: 0.028, corners: 'soft' }).dark },
  { id: 'clean-light', scheme: 'light', palette: createTheme({ hue: 277, chroma: 0.17, neutralChroma: 0.002, corners: 'soft' }).light },
];

const block = ({ id, scheme, palette }) => `:root[data-preset="${id}"],
.preset-${id} {
  color-scheme: ${scheme};
${colorTokens.map((token) => `  --sz-${token}: ${formatOklch(palette[token])};`).join('\n')}
}`;

// The app loads its faces itself (styles/app.css), so the sheet names the face and points at no file of its own.
const css = `${renderThemeCss(base, undefined, { fontFiles: false })}
/* Presets. Set as data-preset on <html> (Settings); the class form scopes one to a subtree, for the swatches. */
${presets.map(block).join('\n')}
`;

writeFileSync(new URL('../src/styles/theme.css', import.meta.url), css);
