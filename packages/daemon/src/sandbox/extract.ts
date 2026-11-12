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

const TEXT_EXTENSIONS = ['ts', 'tsx', 'mts', 'cts', 'js', 'jsx', 'mjs', 'cjs', 'json', 'css', 'scss', 'pcss', 'html', 'vue', 'svelte', 'astro', 'md', 'mdx', 'yml', 'yaml', 'toml'];
const CONTENT_SKIP = ['pnpm-lock.yaml', 'package-lock.json', 'yarn.lock', 'bun.lockb', 'bun.lock'];

/**
 * A Node program piped into `node -` inside a container. It lists the repository the way git sees it
 * (tracked + untracked, minus ignored) and prints one JSON object per file. It only reads; nothing from the
 * repository is ever executed, installed or imported.
 */
export function extractorScript(limits: ExtractLimits): string {
  const config = JSON.stringify({ ...limits, text: TEXT_EXTENSIONS, skip: CONTENT_SKIP });
  return `
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const cfg = ${config};
const list = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { maxBuffer: 64 * 1024 * 1024 }).toString('utf8').split('\\0').filter(Boolean);
let total = 0, withContent = 0, partial = false;
for (const p of list.slice(0, cfg.maxFiles * 6)) {
  let c = null;
  const base = p.split('/').pop();
  const ext = base.includes('.') ? base.split('.').pop().toLowerCase() : '';
  if (cfg.text.includes(ext) && !cfg.skip.includes(base) && withContent < cfg.maxFiles) {
    try {
      const st = fs.lstatSync(p);
      if (st.isFile() && st.size <= cfg.maxFileBytes && total + st.size <= cfg.maxTotalBytes) {
        const buf = fs.readFileSync(p);
        if (!buf.includes(0)) { c = buf.toString('utf8'); total += st.size; withContent++; }
      } else if (st.isFile() && total + st.size > cfg.maxTotalBytes) partial = true;
    } catch {}
  }
  process.stdout.write(JSON.stringify({ p, c }) + '\\n');
}
if (list.length > cfg.maxFiles * 6) partial = true;
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
