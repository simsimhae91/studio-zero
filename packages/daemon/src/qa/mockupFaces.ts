import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

/**
 * The theme's Latin faces, as files a mock-up page can carry inside itself.
 *
 * A mock-up names its fonts by family and is shown with the network off, in a browser container and in the
 * owner's app. Neither has Fraunces or Geist installed, so until the studio supplied the files every title a
 * direction had chosen a face for was drawn in the fallback: the look the theme decided on never reached the
 * page, on either screen. A built product installs and self-hosts these faces; a mock-up has no build, so the
 * studio puts the files in for it.
 *
 * Latin only. The Hangul partners run to megabytes each and fall to the system's faces, which is also what a
 * built product shows before its own font files arrive.
 */
const FACES: readonly { family: string; file: string; weight: string }[] = [
  { family: 'Geist', file: '@fontsource-variable/geist/files/geist-latin-wght-normal.woff2', weight: '100 900' },
  { family: 'Fraunces', file: '@fontsource-variable/fraunces/files/fraunces-latin-wght-normal.woff2', weight: '100 900' },
  { family: 'Instrument Serif', file: '@fontsource/instrument-serif/files/instrument-serif-latin-400-normal.woff2', weight: '400' },
  { family: 'Bricolage Grotesque', file: '@fontsource-variable/bricolage-grotesque/files/bricolage-grotesque-latin-wght-normal.woff2', weight: '200 800' },
];

/** The families this module can supply. */
export const SUPPLIED_FACES: readonly string[] = FACES.map((face) => face.family);

const require = createRequire(import.meta.url);
const loaded = new Map<string, string | null>();

/** One face as an `@font-face` rule with the file inside it; null when its package is not installed here. */
function rule(face: (typeof FACES)[number]): string | null {
  if (!loaded.has(face.family)) {
    let css: string | null = null;
    try {
      const data = readFileSync(require.resolve(face.file)).toString('base64');
      css = `@font-face{font-family:"${face.family}";font-style:normal;font-weight:${face.weight};font-display:block;src:url(data:font/woff2;base64,${data}) format("woff2")}`;
    } catch {
      css = null;
    }
    loaded.set(face.family, css);
  }
  return loaded.get(face.family) ?? null;
}

/**
 * A page with the faces it names put inside it. Only the faces whose family the page mentions are added, in a
 * `<style>` of the studio's own placed where it cannot change how the document is parsed: after `<head>` when
 * there is one, otherwise after the doctype.
 */
export function withFaces(html: string): string {
  const rules = FACES.filter((face) => html.toLowerCase().includes(face.family.toLowerCase())).flatMap((face) => rule(face) ?? []);
  if (rules.length === 0) return html;
  const style = `<style data-studio-faces>${rules.join('')}</style>`;
  const head = /<head[^>]*>/i.exec(html);
  if (head) return `${html.slice(0, head.index + head[0].length)}${style}${html.slice(head.index + head[0].length)}`;
  const doctype = /^\s*<!doctype[^>]*>/i.exec(html);
  return doctype ? `${doctype[0]}${style}${html.slice(doctype[0].length)}` : `${style}${html}`;
}
