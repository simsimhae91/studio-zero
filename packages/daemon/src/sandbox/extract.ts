import { z } from 'zod';

export interface ExtractLimits {
  maxFiles: number;
  maxFileBytes: number;
  maxTotalBytes: number;
}

export interface ExtractedFile {
  path: string;
  /** null when the file exists but its content was not read (binary, too large, lockfile, over budget). */
  content: string | null;
}

export interface Extraction {
  files: ExtractedFile[];
  /** True when the file or byte budget cut the listing short. */
  partial: boolean;
}

const TEXT_EXTENSIONS = [
  'ts', 'tsx', 'mts', 'cts', 'js', 'jsx', 'mjs', 'cjs', 'json', 'css', 'scss', 'pcss', 'html', 'vue', 'svelte', 'astro', 'md', 'mdx', 'yml', 'yaml', 'toml',
  // A repository worth learning from is not always written in the language of the project that learns from it.
  'py', 'rb', 'erb', 'rake', 'gemspec', 'go', 'rs', 'java', 'kt', 'kts', 'swift', 'dart', 'php', 'cs', 'ex', 'exs', 'sh', 'sql', 'jinja', 'j2', 'txt', 'cfg', 'ini',
];
/** Files that say what a repository is and carry no extension. */
const TEXT_NAMES = ['Dockerfile', 'Makefile', 'Gemfile', 'Rakefile', 'Procfile', 'Justfile', 'LICENSE', 'LICENCE', 'COPYING', 'NOTICE'];
const CONTENT_SKIP = ['pnpm-lock.yaml', 'package-lock.json', 'yarn.lock', 'bun.lockb', 'bun.lock', 'Gemfile.lock', 'uv.lock', 'poetry.lock', 'Cargo.lock', 'go.sum', 'composer.lock', 'pubspec.lock'];
/** Folders whose files are listed and not read: what was installed, built or generated is not what the repository's people wrote. */
const SKIP_DIRS = ['node_modules', 'vendor', 'dist', 'build', 'target', '__pycache__', '.next', 'coverage', '.venv', 'venv', 'Pods'];
/** Read before anything else, wherever the budget ends: the files a person opens first. */
export const ORIENTATION = /^(?:readme|agents|claude|skill|contributing|architecture|project_vision|license|licence|copying)(?:\.[a-z0-9.-]+)?$|^(?:package\.json|pyproject\.toml|requirements\.txt|gemfile|cargo\.toml|go\.mod|pubspec\.yaml|composer\.json|dockerfile|makefile|procfile)$/i;

/**
 * A Node program piped into `node -` inside a container. It lists the repository the way git sees it
 * (tracked + untracked, minus ignored) and prints one JSON object per file. It only reads; nothing from the
 * repository is ever executed, installed or imported.
 *
 * What is read when not everything can be: the files a person opens first, then the shallow before the deep,
 * and what the repository is before what it is tested and demonstrated with.
 * Read in path order, a large repository spent its whole budget on `docs/` and `examples/` and never reached
 * its own manifest (measured on next.js: "no strict TypeScript, no tests").
 */
export function extractorScript(limits: ExtractLimits): string {
  const config = JSON.stringify({ ...limits, text: TEXT_EXTENSIONS, names: TEXT_NAMES, skip: CONTENT_SKIP, skipDirs: SKIP_DIRS, orientation: ORIENTATION.source });
  return `
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const cfg = ${config};
const orientation = new RegExp(cfg.orientation, 'i');
const all = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { maxBuffer: 64 * 1024 * 1024 }).toString('utf8').split('\\0').filter(Boolean);
const list = all.slice(0, cfg.maxFiles * 6);
const readable = (p) => {
  const parts = p.split('/');
  const base = parts[parts.length - 1];
  const ext = base.includes('.') ? base.split('.').pop().toLowerCase() : '';
  if (parts.slice(0, -1).some((dir) => cfg.skipDirs.includes(dir)) || cfg.skip.includes(base) || /\\.min\\.(js|css)$/.test(base)) return false;
  return cfg.text.includes(ext) || cfg.names.includes(base);
};
const aside = /(^|\\/)(__tests__|tests?|spec|e2e|fixtures|examples?|snapshots?|testdata)\\//i;
const rank = (p) => {
  const parts = p.split('/');
  return (orientation.test(parts[parts.length - 1]) && parts.length <= 2 ? 0 : 1000) + parts.length + (aside.test(p) ? 500 : 0);
};
const order = list.map((p, i) => i).filter((i) => readable(list[i])).sort((a, b) => rank(list[a]) - rank(list[b]) || a - b);
const content = new Map();
let total = 0, partial = false;
for (const i of order) {
  if (content.size >= cfg.maxFiles) { partial = true; break; }
  try {
    const st = fs.lstatSync(list[i]);
    if (!st.isFile() || st.size > cfg.maxFileBytes) continue;
    if (total + st.size > cfg.maxTotalBytes) { partial = true; continue; }
    const buf = fs.readFileSync(list[i]);
    if (!buf.includes(0)) { content.set(i, buf.toString('utf8')); total += st.size; }
  } catch {}
}
for (let i = 0; i < list.length; i++) process.stdout.write(JSON.stringify({ p: list[i], c: content.has(i) ? content.get(i) : null }) + '\\n');
if (all.length > list.length) partial = true;
process.stdout.write(JSON.stringify({ done: true, partial }) + '\\n');
`;
}

const FileLine = z.object({ p: z.string().min(1).max(400), c: z.string().nullable() });
const DoneLine = z.object({ done: z.literal(true), partial: z.boolean() });

/**
 * Parses extractor output. The producer ran next to untrusted code, so nothing it says is taken on faith:
 * every line is schema-checked, paths are normalised and confined, and the limits are enforced again here.
 */
export function parseExtraction(stdout: string, limits: ExtractLimits): Extraction {
  const files: ExtractedFile[] = [];
  let total = 0;
  let withContent = 0;
  let partial = true; // until the terminating line proves the listing is complete
  for (const line of stdout.split('\n')) {
    if (line === '') continue;
    let json: unknown;
    try {
      json = JSON.parse(line);
    } catch {
      continue;
    }
    const done = DoneLine.safeParse(json);
    if (done.success) {
      partial = done.data.partial;
      break;
    }
    const file = FileLine.safeParse(json);
    if (!file.success || files.length >= limits.maxFiles * 6) continue;
    const path = file.data.p;
    if (path.startsWith('/') || path.split('/').some((seg) => seg === '..' || seg === '')) continue;
    let content = file.data.c;
    if (content !== null) {
      const bytes = Buffer.byteLength(content);
      if (bytes > limits.maxFileBytes || total + bytes > limits.maxTotalBytes || withContent >= limits.maxFiles) content = null;
      else {
        total += bytes;
        withContent += 1;
      }
    }
    files.push({ path, content });
  }
  return { files, partial };
}
