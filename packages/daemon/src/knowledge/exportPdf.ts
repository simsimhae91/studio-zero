import { marked } from 'marked';
import { createTheme, formatOklch } from '@studio-zero/design';

/** A browser page that can print: implemented with the QA browser container in production, a local browser in tests. */
export type PdfRenderer = (html: string) => Promise<Uint8Array>;

/**
 * A document as a self-contained HTML page styled for print. It is rendered with scripts disabled and the
 * network off, so whatever the Markdown contains (it may quote web pages) is laid out and nothing more.
 * Mermaid diagrams appear as their source in this version; rendering them needs script execution.
 */
export function documentHtml(title: string, markdown: string): string {
  const theme = createTheme({ hue: 338, chroma: 0.16, neutralChroma: 0.004, corners: 'sharp' }).light;
  const c = (token: keyof typeof theme): string => formatOklch(theme[token]);
  const body = marked.parse(markdown, { async: false, gfm: true });
  const escaped = title.replaceAll('&', '&amp;').replaceAll('<', '&lt;');
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>${escaped}</title><style>
@page { size: A4; margin: 22mm 20mm 24mm; }
html { font-family: "Pretendard Variable", Pretendard, "Apple SD Gothic Neo", "Noto Sans CJK KR", "Noto Sans KR", system-ui, sans-serif; font-size: 10.5pt; line-height: 1.65; color: ${c('fg')}; }
body { margin: 0; }
h1 { font-size: 22pt; line-height: 1.2; margin: 0 0 10mm; letter-spacing: -0.01em; }
h2 { font-size: 13pt; margin: 9mm 0 3mm; padding-top: 3mm; border-top: 0.4pt solid ${c('fg')}; break-after: avoid; }
h3 { font-size: 11pt; margin: 6mm 0 2mm; break-after: avoid; }
p, li { margin: 0 0 2.5mm; }
ul, ol { padding-left: 5mm; margin: 0 0 3mm; }
h2:first-of-type + p, h2:first-of-type + ul { font-size: 12pt; }
table { width: 100%; border-collapse: collapse; margin: 4mm 0; font-size: 9.5pt; break-inside: avoid; }
th, td { text-align: left; vertical-align: top; padding: 2mm 2.5mm; border-bottom: 0.3pt solid ${c('control-border')}; }
th { border-bottom: 0.6pt solid ${c('fg')}; font-weight: 600; }
code, pre { font-family: "Geist Mono", ui-monospace, Menlo, monospace; font-size: 9pt; }
pre { background: ${c('sunken')}; padding: 3mm; white-space: pre-wrap; break-inside: avoid; }
a { color: ${c('accent')}; text-decoration: none; overflow-wrap: anywhere; }
blockquote { margin: 3mm 0; padding-left: 4mm; border-left: 1.2pt solid ${c('accent')}; color: ${c('fg-muted')}; }
</style></head><body>${body}</body></html>`;
}
