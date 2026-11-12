import type { Finding, FindingCategory, Severity } from '@studio-zero/protocol';
import { hueSaturation, parseHex } from './color.ts';
import { contract as defaultContract, type DesignContract } from './contract.ts';

export interface SourceFile {
  path: string;
  content: string;
}

interface Hit {
  line: number;
  message: string;
}

interface LineRule {
  id: string;
  category: FindingCategory;
  severity: Severity;
  fix: string;
  /** File kinds the rule applies to. */
  applies: (file: FileInfo) => boolean;
  check: (line: string, file: FileInfo, c: DesignContract) => string | null;
}

interface FileRule extends Omit<LineRule, 'check'> {
  /** Sees the whole file; for rules about repetition rather than a single occurrence. */
  checkFile: (file: FileInfo, c: DesignContract) => Hit[];
}

interface FileInfo extends SourceFile {
  markup: boolean;
  styles: boolean;
  /** The token source itself is allowed to contain raw colours and font stacks. */
  themeFile: boolean;
  lines: string[];
}

const PALETTE = 'slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose';
const CLICHE = 'blue|indigo|violet|purple|fuchsia|pink|sky|cyan';
const COLOR_UTILITY = 'bg|text|border|ring|from|via|to|fill|stroke|outline|shadow|decoration|divide|accent|caret|placeholder';

const defaultPaletteClass = new RegExp(`(?<![\\w-])(?:[a-z-]+:)*(?:${COLOR_UTILITY})-(?:${PALETTE})-(?:50|[1-9]00|950)(?![\\w-])`);
const clicheGradientFrom = new RegExp(`(?<![\\w-])from-(?:${CLICHE})-\\d{2,3}`);
const clicheGradientTo = new RegExp(`(?<![\\w-])(?:via|to)-(?:${CLICHE})-\\d{2,3}`);
const arbitraryValue = /(?<![\w-])(?:[a-z-]+:)*[a-z][a-z0-9-]*-\[([^\]]+)\]/g;
const rawColor = /#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})\b|\b(?:rgb|rgba|hsl|hsla)\(\s*\d/i;
const emoji = /[\p{Extended_Pictographic}](?<![©®™0-9#*])/u;
const hexInGradient = /#(?:[0-9a-f]{6}|[0-9a-f]{3})\b/gi;

const lineRules: LineRule[] = [
  {
    id: 'slop/cliche-gradient',
    category: 'color',
    severity: 'major',
    fix: 'Remove the gradient. Use a flat `bg-surface` / `bg-accent`, or carry emphasis with type size and spacing.',
    applies: (f) => f.markup || f.styles,
    check: (line, _f, c) => {
      if (clicheGradientFrom.test(line) && clicheGradientTo.test(line)) return 'blue-to-purple gradient utility classes';
      if (!/gradient\(/.test(line)) return null;
      const stops = [...line.matchAll(hexInGradient)].map((m) => parseHex(m[0])).filter((rgb) => rgb !== null).map(hueSaturation);
      const inBand = stops.filter((s) => s.saturation > 0.35 && s.hue >= c.clicheGradientHues.from && s.hue <= c.clicheGradientHues.to);
      return inBand.length >= 2 ? 'CSS gradient between two saturated blue/violet/purple stops' : null;
    },
  },
  {
    id: 'slop/default-palette',
    category: 'color',
    severity: 'major',
    fix: 'Use a semantic token: bg-bg, bg-surface, bg-sunken, text-fg, text-fg-muted, text-accent, bg-accent, border-border, border-control-border.',
    applies: (f) => f.markup,
    check: (line) => {
      const m = defaultPaletteClass.exec(line);
      return m ? `Tailwind default palette class \`${m[0]}\` (not part of this theme)` : null;
    },
  },
  {
    id: 'slop/raw-color',
    category: 'color',
    severity: 'major',
    fix: 'Reference a token (`var(--color-…)` or a semantic utility). New colours belong in the theme seed, where contrast is solved.',
    applies: (f) => (f.markup || f.styles) && !f.themeFile,
    check: (line) => {
      if (/^\s*(\/\/|\/\*|\*)/.test(line)) return null;
      const m = rawColor.exec(line);
      return m ? `hard-coded colour \`${m[0].replace(/\($/, '(…)')}\`` : null;
    },
  },
  {
    id: 'slop/arbitrary-value',
    category: 'spacing',
    severity: 'minor',
    fix: 'Use the scale: spacing utilities are multiples of 4px and font sizes come from text-xs … text-6xl.',
    applies: (f) => f.markup,
    check: (line) => {
      for (const m of line.matchAll(arbitraryValue)) {
        const value = m[1]!;
        // Computed and structural values are legitimate; literal lengths and colours bypass the scale.
        if (/^(?:var\(|calc\(|min\(|max\(|clamp\(|minmax\(|repeat\(|url\(|[\d.]+(?:%|fr|ch|vw|vh|dvh|svh|lvh)$|[a-z-]+$)/.test(value)) continue;
        if (/\d(?:px|rem|em)\b|^#/.test(value)) return `arbitrary value \`${m[0]}\``;
      }
      return null;
    },
  },
  {
    id: 'slop/emoji-as-icon',
    category: 'originality',
    severity: 'major',
    fix: 'Use an icon from the icon set (lucide-react) sized on the type scale, or no icon at all.',
    applies: (f) => f.markup,
    check: (line) => {
      if (/^\s*(\/\/|\/\*|\*|import\s)/.test(line)) return null;
      const m = emoji.exec(line);
      return m ? `emoji \`${m[0]}\` used in interface text` : null;
    },
  },
  {
    id: 'slop/caps-eyebrow',
    category: 'typography',
    severity: 'minor',
    fix: 'Drop the tracked-out capitals. If the label carries information, set it in sentence case at text-sm with text-fg-muted; if it does not, delete it.',
    applies: (f) => f.markup,
    check: (line) => (/(?<![\w-])uppercase(?![\w-])/.test(line) && /(?<![\w-])tracking-(?:wide|wider|widest)(?![\w-])/.test(line) ? 'all-caps letter-spaced label' : null),
  },
  {
    id: 'slop/arrow-suffix',
    category: 'copy',
    severity: 'minor',
    fix: 'Name the action ("View invoices") and let the control look like a control; a trailing arrow adds nothing.',
    applies: (f) => f.markup,
    check: (line) => (/(?:→|&rarr;|-&gt;)\s*<\/(?:a|button|Link|Button)>/.test(line) ? 'decorative arrow appended to link or button text' : null),
  },
  {
    id: 'slop/heavy-shadow',
    category: 'originality',
    severity: 'minor',
    fix: 'Use shadow-sm or shadow-md, or separate surfaces with bg-surface and border-border instead of blur.',
    applies: (f) => f.markup || (f.styles && !f.themeFile),
    check: (line) => (/(?<![\w-])shadow-(?:lg|xl|2xl)(?![\w-])/.test(line) || /box-shadow:[^;]*\b(?:[3-9]\d|\d{3})px/.test(line) ? 'large soft shadow' : null),
  },
  {
    id: 'slop/default-font',
    category: 'typography',
    severity: 'major',
    fix: 'Use font-sans / font-mono from the theme (Geist with Pretendard for Hangul).',
    applies: (f) => (f.markup || f.styles) && !f.themeFile,
    check: (line) => {
      const m = /font-family\s*:\s*["']?(Inter|Roboto|Arial|Helvetica|Open Sans|Poppins|Montserrat|system-ui|sans-serif)\b/i.exec(line) ?? /(?<![\w-])font-\[['"]?(Inter|Roboto|Arial|Poppins|Montserrat)/i.exec(line);
      return m ? `font stack starts with ${m[1]}` : null;
    },
  },
  {
    id: 'slop/important',
    category: 'originality',
    severity: 'minor',
    fix: 'Fix the specificity conflict at its source instead of overriding it.',
    applies: (f) => (f.styles && !f.themeFile) || f.markup,
    check: (line, f) => (f.styles ? (/!important/.test(line) ? '`!important`' : null) : /(?:^|["'\s`])!(?:[a-z-]+:)*[a-z]+-[\w-]+/.test(line) && /class(?:Name)?=/.test(line) ? 'Tailwind important modifier' : null),
  },
  {
    id: 'slop/filler-copy',
    category: 'copy',
    severity: 'major',
    fix: 'Say what the thing is or does in plain words, from the user’s side of the screen.',
    applies: (f) => f.markup,
    check: (line) => {
      const m = /\b(lorem ipsum|unlock the power|supercharge your|elevate your|seamlessly integrat\w*|revolutioni[sz]e your|take (?:your|it) to the next level|welcome to (?:your|the) (?:dashboard|app)|get started today|built for the modern)\b/i.exec(line);
      return m ? `filler copy: "${m[0]}"` : null;
    },
  },
];

const fileRules: FileRule[] = [
  {
    id: 'slop/uniform-pill-cards',
    category: 'originality',
    severity: 'minor',
    fix: 'Reserve rounded-full for avatars and pill controls; give containers rounded-md or rounded-lg so radius follows hierarchy.',
    applies: (f) => f.markup,
    checkFile: (f) => {
      const hits = f.lines.flatMap((line, i) => (/(?<![\w-])rounded-(?:2xl|3xl)(?![\w-])/.test(line) ? [i + 1] : []));
      return hits.length > 0 ? [{ line: hits[0]!, message: `oversized corner radius (rounded-2xl/3xl) used ${hits.length}×; the theme defines sm, md and lg only` }] : [];
    },
  },
  {
    id: 'slop/entrance-animation-everywhere',
    category: 'originality',
    severity: 'minor',
    fix: 'Keep one orchestrated entrance at most. Motion should answer an action (open, expand, confirm), not decorate every section.',
    applies: (f) => f.markup,
    checkFile: (f) => {
      const hits = f.lines.flatMap((line, i) => (/initial=\{\{\s*opacity:\s*0|animate-(?:fade|slide)[\w-]*|whileInView=/.test(line) ? [i + 1] : []));
      return hits.length > 3 ? [{ line: hits[0]!, message: `${hits.length} scroll/entrance animations in one file` }] : [];
    },
  },
  {
    id: 'slop/gradient-wash',
    category: 'color',
    severity: 'minor',
    fix: 'One gradient per view at most, and only where it carries meaning (a chart, a media scrim).',
    applies: (f) => f.markup,
    checkFile: (f) => {
      const hits = f.lines.flatMap((line, i) => (/(?<![\w-])bg-(?:gradient|linear|radial|conic)-/.test(line) ? [i + 1] : []));
      return hits.length > 1 ? [{ line: hits[1]!, message: `${hits.length} gradient backgrounds in one file` }] : [];
    },
  },
];

function describe(file: SourceFile): FileInfo | null {
  const markup = /\.(tsx|jsx|html|vue|svelte|astro|mdx)$/.test(file.path);
  const styles = /\.(css|scss|pcss)$/.test(file.path);
  if (!markup && !styles) return null;
  if (/(^|\/)(node_modules|dist|build|\.next|coverage)\//.test(file.path)) return null;
  const themeFile = /(^|\/)(theme|tokens)\.css$/.test(file.path) || /Generated by @studio-zero\/design/.test(file.content.slice(0, 200));
  return { ...file, markup, styles, themeFile, lines: file.content.split('\n') };
}

/**
 * Static half of the anti-slop gate: finds, in source, the patterns that make an interface read as generated.
 * Deterministic and fast, so it runs on every verify round before a browser is started. An `// sz-allow <rule>`
 * comment on the same or the preceding line records a deliberate exception.
 */
export function lintSources(files: readonly SourceFile[], c: DesignContract = defaultContract): Finding[] {
  const findings: Finding[] = [];
  const push = (rule: Omit<LineRule, 'check' | 'applies'>, file: FileInfo, hit: Hit): void => {
    const allow = `sz-allow ${rule.id}`;
    if (file.lines[hit.line - 1]?.includes(allow) || file.lines[hit.line - 2]?.includes(allow)) return;
    findings.push({
      rule: rule.id,
      category: rule.category,
      severity: rule.severity,
      source: 'lint',
      viewport: null,
      route: null,
      message: hit.message,
      selector: null,
      bbox: null,
      fix: rule.fix,
      file: file.path,
      line: hit.line,
    });
  };

  for (const source of files) {
    const file = describe(source);
    if (!file) continue;
    for (const rule of lineRules) {
      if (!rule.applies(file)) continue;
      file.lines.forEach((line, i) => {
        if (line.length > 2000) return; // minified or generated: not authored code
        const message = rule.check(line, file, c);
        if (message) push(rule, file, { line: i + 1, message });
      });
    }
    for (const rule of fileRules) {
      if (rule.applies(file)) for (const hit of rule.checkFile(file, c)) push(rule, file, hit);
    }
  }
  return findings;
}

export const lintRuleIds = [...lineRules, ...fileRules].map((r) => r.id);
