import { common, createLowlight } from 'lowlight';

/** A highlighted fragment as plain data. The viewer turns it into elements; no markup string is ever injected. */
export type CodeNode = { type: 'text'; value: string } | { type: 'span'; classes: string[]; children: CodeNode[] };

const lowlight = createLowlight(common);

const BY_EXTENSION: Record<string, string> = {
  ts: 'typescript', tsx: 'typescript', mts: 'typescript', cts: 'typescript',
  js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
  json: 'json', jsonc: 'json', css: 'css', scss: 'scss', less: 'less',
  html: 'xml', xml: 'xml', svg: 'xml', vue: 'xml', md: 'markdown', mdx: 'markdown',
  yml: 'yaml', yaml: 'yaml', toml: 'ini', ini: 'ini', env: 'ini',
  sh: 'bash', bash: 'bash', zsh: 'bash', py: 'python', rs: 'rust', go: 'go', sql: 'sql',
  graphql: 'graphql', gql: 'graphql', java: 'java', kt: 'kotlin', swift: 'swift', rb: 'ruby', php: 'php',
  c: 'c', h: 'c', cpp: 'cpp', diff: 'diff', patch: 'diff',
};
const BY_NAME: Record<string, string> = { dockerfile: 'bash', makefile: 'makefile', '.gitignore': 'bash', '.env': 'ini' };

export function languageOf(path: string): string | null {
  const name = path.slice(path.lastIndexOf('/') + 1).toLowerCase();
  const extension = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1) : '';
  const language = BY_NAME[name] ?? BY_EXTENSION[extension];
  return language && lowlight.registered(language) ? language : null;
}

interface HastNode {
  type: string;
  value?: string;
  properties?: { className?: unknown };
  children?: HastNode[];
}

function convert(nodes: readonly HastNode[]): CodeNode[] {
  return nodes.flatMap((node): CodeNode[] => {
    if (node.type === 'text') return [{ type: 'text', value: node.value ?? '' }];
    if (node.type !== 'element') return [];
    const classes = Array.isArray(node.properties?.className) ? node.properties.className.filter((c): c is string => typeof c === 'string') : [];
    return [{ type: 'span', classes, children: convert(node.children ?? []) }];
  });
}

/** null when the file's language is not one the highlighter knows; the viewer then shows it as plain text. */
export function highlight(path: string, code: string): CodeNode[] | null {
  const language = languageOf(path);
  if (!language) return null;
  try {
    return convert(lowlight.highlight(language, code).children as HastNode[]);
  } catch {
    return null;
  }
}
