// Generates src/styles/theme.css from the design contract. The app is built with the same theme generator,
// lint and audit it applies to the projects it builds.
import { writeFileSync } from 'node:fs';
import { createTheme, renderThemeCss } from '@studio-zero/design';

// Proof-mark magenta on near-neutral paper: the colour a designer annotates a print with.
const seed = { hue: 338, chroma: 0.16, neutralChroma: 0.004, corners: 'sharp' };

writeFileSync(new URL('../src/styles/theme.css', import.meta.url), renderThemeCss(createTheme(seed)));
