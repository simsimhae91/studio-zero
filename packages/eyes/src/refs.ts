import { createHash, randomBytes } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import * as http from 'node:http';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

/**
 * The house reference library: pictures of how shipped products do a screen, each with what is seen in it, and
 * for each kind of screen a page of what its references teach. Every pull from a reference service leaves
 * something here, so the library gets better with each one and can be used once the service is gone.
 *
 * It is the owner's own and lives on this machine, outside any project: pictures of other products' screens,
 * kept to look at, never put into a product, never committed to a repository, never passed on.
 *
 *   index.jsonl                    one reference a line
 *   shots/<kind>/<product>-<what>-<sha8>.<ext>
 *   kinds/<kind>.md                what the kind's references teach (and <kind>.prev.md, the page before)
 */
export class RefsError extends Error {}

export const REFS_INDEX = 'index.jsonl';
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
/** Fewer characters than this say nothing about a picture that a look at it would not. */
const MIN_NOTES = 80;
const PLATFORMS = ['ios', 'android', 'web'];

export interface Ref {
  id: string;
  kind: string;
  product: string;
  what: string;
  platform: string | null;
  lang: string | null;
  /** The page the picture came from. */
  link: string;
  /** The picture, from the library's folder. */
  file: string;
  sha256: string;
  addedAt: string;
  /** The project it was looked up for. */
  for: string | null;
  notes: string;
}

export interface KindCount {
  kind: string;
  slug: string;
  count: number;
  page: boolean;
  /** References kept after the page was last written (all of them when there is no page). */
  keptSincePage: number;
}

/** `$SZ_REFS_DIR`, or `~/.studio-zero/references`. */
export function refsDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.SZ_REFS_DIR ? resolve(env.SZ_REFS_DIR) : join(homedir(), '.studio-zero', 'references');
}

/** Lower case, dashes between words, letters of every script kept (로그인 화면 is 로그인-화면). */
export function refSlug(text: string, max = 60): string {
  const dashed = text.normalize('NFC').toLowerCase().replace(/[^\p{L}\p{M}\p{N}]+/gu, '-').replace(/^-+/, '');
  return [...dashed].slice(0, max).join('').replace(/-+$/, '');
}

const oneLine = (text: string): string => text.replace(/\s+/g, ' ').trim();
const kindPage = (dir: string, slug: string): string => join(dir, 'kinds', `${slug}.md`);

function isRef(value: unknown): value is Ref {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  const text = ['id', 'kind', 'product', 'what', 'link', 'file', 'sha256', 'addedAt', 'notes'].every((key) => typeof v[key] === 'string');
  const maybe = ['platform', 'lang', 'for'].every((key) => v[key] === null || typeof v[key] === 'string');
  return text && maybe;
}

/** Every reference kept, in the order kept. Nothing is read past, or written over, a line that cannot be read. */
export function readRefs(dir: string): Ref[] {
  const file = join(dir, REFS_INDEX);
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8')
    .split('\n')
    .flatMap((line, i) => {
      if (line.trim() === '') return [];
      let ref: unknown = null;
      try {
        ref = JSON.parse(line);
      } catch {
        // said below
      }
      if (!isRef(ref)) throw new RefsError(`line ${i + 1} of ${file} cannot be read as a reference: put it right by hand or take it out (nothing is written over an index that cannot be read)`);
      return [ref];
    });
}

/** Written whole beside where it goes and renamed over it: a reader sees the file before or after, never half of it. */
function writeWhole(path: string, data: string | Buffer): void {
  const temporary = `${path}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  writeFileSync(temporary, data);
  renameSync(temporary, path);
}

const writeIndex = (dir: string, refs: readonly Ref[]): void => writeWhole(join(dir, REFS_INDEX), refs.map((ref) => `${JSON.stringify(ref)}\n`).join(''));

/**
 * One writer of the library at a time: a lock folder beside the index (making a folder either succeeds or finds
 * it there, in one step), let go in `finally`, waited for up to ten seconds, and taken over when it is older
 * than thirty (whoever made it died holding it). Kept small and private here: a general lock.ts is being added
 * on another branch, and this should be folded into it once both are merged.
 */
async function exclusively<T>(dir: string, work: () => T): Promise<T> {
  mkdirSync(dir, { recursive: true });
  const lock = join(dir, `${REFS_INDEX}.lock`);
  const until = Date.now() + 10_000;
  for (;;) {
    try {
      mkdirSync(lock);
      break;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
    }
    let age: number;
    try {
      age = Date.now() - statSync(lock).mtimeMs;
    } catch {
      continue; // let go between the two looks
    }
    if (age > 30_000) {
      rmSync(lock, { recursive: true, force: true });
      continue;
    }
    if (Date.now() > until) throw new RefsError(`the library is being written by another sz-eyes refs (${lock} is there): try again in a moment`);
    await new Promise((done) => setTimeout(done, 15 + Math.random() * 35));
  }
  try {
    return work();
  } finally {
    rmSync(lock, { recursive: true, force: true });
  }
}

/** What the bytes are, from their first bytes: only pictures of the kinds a screen is kept in. */
function pictureType(bytes: Buffer): string | null {
  const ascii = (from: number, to: number): string => bytes.subarray(from, to).toString('latin1');
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpg';
  if (bytes.length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'webp';
  if (bytes.length >= 6 && (ascii(0, 6) === 'GIF87a' || ascii(0, 6) === 'GIF89a')) return 'gif';
  if (bytes.length >= 12 && ascii(4, 8) === 'ftyp') {
    const brand = ascii(8, 12);
    if (brand === 'avif' || brand === 'avis') return 'avif';
    if (brand === 'heic' || brand === 'heix') return 'heic';
  }
  return null;
}

const NOT_A_PICTURE = 'a reference is a picture of a screen (PNG, JPEG, WebP, GIF, AVIF or HEIC)';

function pictureFromFile(path: string): { bytes: Buffer; ext: string } {
  if (!existsSync(path) || !statSync(path).isFile()) throw new RefsError(`--file ${path}: no such file`);
  const bytes = readFileSync(path);
  const ext = pictureType(bytes);
  if (!ext) throw new RefsError(`--file ${path} is not a picture: ${NOT_A_PICTURE}`);
  return { bytes, ext };
}

/**
 * The picture at an https address, by its bytes: an image content type, 10 MB at most, and bytes that are a
 * picture. It is only ever written to a file, never opened as anything else. Nothing is kept when any of that
 * fails. SZ_REFS_ALLOW_HTTP=1 lets plain http through, for the tests alone (a server they start cannot speak https).
 */
async function pictureFromAddress(address: string): Promise<{ bytes: Buffer; ext: string }> {
  const allowed = (url: URL): boolean => url.protocol === 'https:' || (process.env.SZ_REFS_ALLOW_HTTP === '1' && url.protocol === 'http:');
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    throw new RefsError(`--image ${address} is not an address`);
  }
  if (!allowed(url)) throw new RefsError(`--image takes an https address, and ${address} is not one: a picture is fetched over https only`);
  // Inside a session's command sandbox the network is reached only through the proxy its environment names,
  // and fetch does not use one unless told (what NODE_USE_ENV_PROXY=1 does). Where none is named, nothing changes.
  const proxyFromEnv = (http as unknown as { setGlobalProxyFromEnv?: () => unknown }).setGlobalProxyFromEnv;
  if ((process.env.HTTPS_PROXY || process.env.https_proxy) && typeof proxyFromEnv === 'function') proxyFromEnv();
  const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(60_000), headers: { accept: 'image/*', 'user-agent': 'sz-eyes' } }).catch((err: unknown) => {
    const cause = (err as { cause?: { message?: string } }).cause?.message;
    throw new RefsError(`${address} could not be downloaded: ${cause ?? (err instanceof Error ? err.message : String(err))}`);
  });
  if (!allowed(new URL(res.url || address))) throw new RefsError(`${address} sent the download on to ${res.url}, which is not https`);
  if (!res.ok) throw new RefsError(`${address} answered ${res.status}: nothing was kept`);
  const type = (res.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
  if (!type.startsWith('image/')) throw new RefsError(`${address} is not a picture: it was served as ${type || 'nothing it named'}`);
  if (Number(res.headers.get('content-length') ?? 0) > MAX_IMAGE_BYTES) throw new RefsError(`${address} is more than 10 MB: a screen is kept at 10 MB at most`);
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = res.body?.getReader();
  for (;;) {
    if (!reader) break;
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_IMAGE_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw new RefsError(`${address} is more than 10 MB: a screen is kept at 10 MB at most`);
    }
    chunks.push(value);
  }
  const bytes = Buffer.concat(chunks);
  const ext = pictureType(bytes);
  if (!ext) throw new RefsError(`${address} was served as ${type} but is not a picture: ${NOT_A_PICTURE}`);
  return { bytes, ext };
}

export interface RefInput {
  kind: string;
  product: string;
  what: string;
  link: string;
  notes: string;
  /** A picture on disk, or the https address of one: one of the two. */
  file?: string | undefined;
  image?: string | undefined;
  platform?: string | undefined;
  lang?: string | undefined;
  for?: string | undefined;
}

export interface Added {
  status: 'kept' | 'already kept';
  /** How the reference that was there was found: by its address, or by the same picture. */
  sameAs: 'link' | 'picture' | null;
  notesReplaced: boolean;
  newKind: boolean;
  /** The kinds there were before this one. */
  kindsBefore: KindCount[];
  ref: Ref;
  path: string;
}

function checked(input: RefInput): Omit<Ref, 'id' | 'file' | 'sha256' | 'addedAt'> {
  const missing = (['kind', 'product', 'what', 'link'] as const).filter((key) => oneLine(input[key] ?? '') === '');
  if (missing.length > 0) throw new RefsError(`${missing.map((key) => `--${key}`).join(', ')} missing: sz-eyes refs add --kind "<kind>" --product "<name>" --what "<which screen>" --link <the page it came from> (--file <picture> | --image <https address>) --notes <file.md>`);
  for (const key of ['kind', 'product', 'what'] as const) if (refSlug(input[key]) === '') throw new RefsError(`--${key} "${input[key]}" has no letter or digit in it`);
  let link: URL;
  try {
    link = new URL(input.link.trim());
  } catch {
    throw new RefsError(`--link ${input.link} is not an address: give the address of the page the picture came from`);
  }
  if (link.protocol !== 'https:' && link.protocol !== 'http:') throw new RefsError(`--link ${input.link} is not the address of a page`);
  const notes = input.notes.trim();
  const said = [...oneLine(notes)].length;
  if (said < MIN_NOTES) throw new RefsError(`the notes hold ${said} characters: say what is seen in the picture, in ${MIN_NOTES} characters at least (what the screen does, how, and what to take from it). A picture with nothing said about it is not a reference`);
  const platform = input.platform?.trim().toLowerCase() || null;
  if (platform !== null && !PLATFORMS.includes(platform)) throw new RefsError(`--platform is one of ${PLATFORMS.join(', ')}`);
  const lang = input.lang?.trim().toLowerCase() || null;
  if (lang !== null && !/^[a-z]{2,3}(-[a-z0-9]{2,8})*$/.test(lang)) throw new RefsError(`--lang takes a language tag (ko, en, ja, zh-hant): ${input.lang}`);
  return { kind: oneLine(input.kind), product: oneLine(input.product), what: oneLine(input.what), platform, lang, link: input.link.trim(), for: oneLine(input.for ?? '') || null, notes };
}

/** Two ways of writing one address are one address (the host's case, an encoded letter). */
const sameLink = (a: string, b: string): boolean => {
  const canon = (link: string): string => {
    try {
      return new URL(link).href;
    } catch {
      return link;
    }
  };
  return canon(a) === canon(b);
};

/** Each kind, most references first, with whether it has a page and how many references came after it. */
export function refKinds(dir: string, refs: readonly Ref[] = readRefs(dir)): KindCount[] {
  const kinds = new Map<string, KindCount>();
  for (const ref of refs) {
    const slug = refSlug(ref.kind);
    const kind = kinds.get(slug) ?? { kind: ref.kind, slug, count: 0, page: false, keptSincePage: 0 };
    kind.count++;
    kinds.set(slug, kind);
  }
  for (const kind of kinds.values()) {
    const page = kindPage(dir, kind.slug);
    const written = existsSync(page) ? statSync(page).mtimeMs : null;
    kind.page = written !== null;
    kind.keptSincePage = refs.filter((ref) => refSlug(ref.kind) === kind.slug && (written === null || Date.parse(ref.addedAt) > written)).length;
  }
  return [...kinds.values()].sort((a, b) => b.count - a.count);
}

/**
 * Keeps a reference: the picture under shots/<kind>/, and a line in the index. The same link, or the same
 * picture, is kept once: what is there gets the new notes when they differ.
 */
export async function addRef(dir: string, input: RefInput, now = new Date().toISOString()): Promise<Added> {
  const given = checked(input);
  if (Boolean(input.file) === Boolean(input.image)) throw new RefsError('the picture comes from one place: --file <a picture on disk> or --image <its https address>');
  const linked = readRefs(dir).some((ref) => sameLink(ref.link, given.link));
  // A download is not made for an address already kept; a file on disk is always looked at.
  const picture = input.file ? pictureFromFile(resolve(input.file)) : linked ? null : await pictureFromAddress(input.image!);
  return exclusively(dir, () => {
    const refs = readRefs(dir);
    const kindsBefore = refKinds(dir, refs);
    const sha256 = picture ? createHash('sha256').update(picture.bytes).digest('hex') : null;
    const byLink = refs.find((ref) => sameLink(ref.link, given.link));
    const held = byLink ?? refs.find((ref) => ref.sha256 === sha256);
    if (held) {
      const notesReplaced = held.notes !== given.notes;
      const ref = notesReplaced ? { ...held, notes: given.notes } : held;
      if (notesReplaced) writeIndex(dir, refs.map((one) => (one.id === held.id ? ref : one)));
      return { status: 'already kept', sameAs: byLink ? 'link' : 'picture', notesReplaced, newKind: false, kindsBefore, ref, path: join(dir, ref.file) };
    }
    if (!picture || !sha256) throw new RefsError(`${given.link} was kept a moment ago and is not now: try again`);
    const there = refs.find((ref) => refSlug(ref.kind) === refSlug(given.kind));
    // A kind is kept under the name it was first given, whatever case it comes in later.
    const kind = there?.kind ?? given.kind;
    const kindSlug = refSlug(kind);
    const productSlug = refSlug(given.product, 30);
    const file = `shots/${kindSlug}/${productSlug}-${refSlug(given.what, 40)}-${sha256.slice(0, 8)}.${picture.ext}`;
    let id = `${productSlug}-${sha256.slice(0, 8)}`;
    for (let n = 12; refs.some((ref) => ref.id === id); n += 4) id = `${productSlug}-${sha256.slice(0, n)}`;
    mkdirSync(join(dir, 'shots', kindSlug), { recursive: true });
    writeWhole(join(dir, file), picture.bytes);
    const ref: Ref = { id, kind, product: given.product, what: given.what, platform: given.platform, lang: given.lang, link: given.link, file, sha256, addedAt: now, for: given.for, notes: given.notes };
    writeIndex(dir, [...refs, ref]);
    return { status: 'kept', sameAs: null, notesReplaced: false, newKind: !there, kindsBefore, ref, path: join(dir, file) };
  });
}

/** The references that have every word somewhere in their kind, product, what or notes (any case), and match the filters. */
export function findRefs(dir: string, ask: { words?: readonly string[]; kind?: string | undefined; product?: string | undefined }, refs: readonly Ref[] = readRefs(dir)): Ref[] {
  const fold = (text: string): string => text.normalize('NFC').toLowerCase();
  const words = (ask.words ?? []).flatMap((word) => fold(word).split(/\s+/)).filter(Boolean);
  const kind = ask.kind ? refSlug(ask.kind) : null;
  const product = ask.product ? fold(ask.product.trim()) : null;
  return refs.filter((ref) => {
    const hay = fold(`${ref.kind}\n${ref.product}\n${ref.what}\n${ref.notes}`);
    return words.every((word) => hay.includes(word)) && (kind === null || refSlug(ref.kind) === kind) && (product === null || fold(ref.product).includes(product));
  });
}

/** Replaces a kind's page with what its references teach; the page before is kept beside it as <kind>.prev.md. */
export async function writeKindPage(dir: string, kind: string, text: string): Promise<{ page: string; previous: string | null }> {
  const slug = refSlug(kind);
  if (!readRefs(dir).some((ref) => refSlug(ref.kind) === slug)) throw new RefsError(`no reference is kept under "${kind}", and a kind's page is written from its references. Kinds: ${refKinds(dir).map((k) => k.kind).join(', ') || '(none yet)'}`);
  if ([...oneLine(text)].length < MIN_NOTES) throw new RefsError(`the page holds next to nothing: write what the references of "${kind}" teach, from all of them`);
  return exclusively(dir, () => {
    const page = kindPage(dir, slug);
    mkdirSync(join(dir, 'kinds'), { recursive: true });
    const previous = existsSync(page) ? join(dir, 'kinds', `${slug}.prev.md`) : null;
    if (previous) copyFileSync(page, previous);
    writeWhole(page, text);
    return { page, previous };
  });
}

const withPath = (dir: string, ref: Ref): Ref & { path: string } => ({ ...ref, path: join(dir, ref.file) });
const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

/** A reference as `find` lists it: where the picture is, where it came from, and the first two lines of its notes. */
export function renderRef(dir: string, ref: Ref): string {
  const notes = ref.notes.split('\n').filter((line) => line.trim() !== '').slice(0, 2);
  const about = [ref.platform, ref.lang, ref.for ? `for ${ref.for}` : null].filter(Boolean).join(', ');
  return [
    `${ref.id}  [${ref.kind}] ${ref.product}: ${ref.what}`,
    `  picture  ${join(dir, ref.file)}`,
    `  from     ${ref.link}`,
    `  kept     ${ref.addedAt.slice(0, 10)}${about ? ` (${about})` : ''}`,
    ...notes.map((line, i) => `${i === 0 ? '  notes    ' : '           '}${line.trim()}`),
  ].join('\n');
}

/** How many columns a terminal gives the text: a Hangul or CJK letter takes two. */
const columns = (text: string): number => [...text].reduce((n, ch) => n + (/[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/.test(ch) ? 2 : 1), 0);

function renderKinds(dir: string, kinds: readonly KindCount[]): string {
  const width = Math.max(...kinds.map((k) => columns(k.kind)));
  const lines = kinds.map((k) => {
    const page = !k.page ? 'no page yet' : k.keptSincePage > 0 ? `page (${plural(k.keptSincePage, 'reference')} kept after it was written)` : 'page';
    return `  ${k.kind}${' '.repeat(width - columns(k.kind))}  ${String(k.count).padStart(3)}  ${page}`;
  });
  return `${lines.join('\n')}\n  (in ${dir})`;
}

/** What to do after a reference is kept: the kind's page is rewritten from all of its references. */
function nextForKind(dir: string, kind: string): string {
  const k = refKinds(dir).find((one) => one.slug === refSlug(kind));
  if (!k) return '';
  const read = `sz-eyes refs kind "${k.kind}"`;
  if (!k.page) return `"${k.kind}" holds ${plural(k.count, 'reference')} and no page yet: read ${k.count === 1 ? 'it' : 'them'} (${read}) and write what ${k.count === 1 ? 'it teaches' : 'they teach'} (${read} --write <file.md>).`;
  if (k.keptSincePage === 0) return '';
  return `"${k.kind}" holds ${plural(k.count, 'reference')}, ${k.keptSincePage} kept after its page was written: read them (${read}) and rewrite the page from all of them (${read} --write <file.md>).`;
}

const EMPTY = (dir: string): string => `nothing is kept yet in ${dir}: keep a reference with sz-eyes refs add (sz-eyes help)`;

/** The command line as cli.ts parses it: bare words, and `--flag value` pairs. */
export interface RefsArgs {
  words: string[];
  has: (flag: string) => boolean;
  one: (flag: string) => string | undefined;
}

/** `sz-eyes refs <command>`: what to print and the exit code. A refusal is thrown as a RefsError. */
export async function refsCommand(command: string | undefined, a: RefsArgs, dir: string = refsDir()): Promise<{ text: string; code: number }> {
  const json = a.has('--json');
  const done = (value: unknown, text: string): { text: string; code: number } => ({ text: json ? JSON.stringify(value, null, 2) : text, code: 0 });
  if (command === 'add') {
    const notesFile = a.one('--notes');
    if (!notesFile) throw new RefsError(`--notes <file.md> is missing: say what is seen in the picture (what the screen does, how, and what to take from it), in ${MIN_NOTES} characters at least. A picture with nothing said about it is not a reference`);
    const notesPath = resolve(notesFile);
    if (!existsSync(notesPath) || !statSync(notesPath).isFile()) throw new RefsError(`--notes ${notesFile}: no such file (--notes takes a file that says what is seen in the picture)`);
    const added = await addRef(dir, { kind: a.one('--kind') ?? '', product: a.one('--product') ?? '', what: a.one('--what') ?? '', link: a.one('--link') ?? '', notes: readFileSync(notesPath, 'utf8'), file: a.one('--file'), image: a.one('--image'), platform: a.one('--platform'), lang: a.one('--lang'), for: a.one('--for') });
    const lines =
      added.status === 'kept'
        ? [`kept: ${added.ref.id}`, `picture: ${added.path}`]
        : [
            `already kept: ${added.ref.id} (the same ${added.sameAs}${added.sameAs === 'link' ? ': an address is kept once, and another screen of that page is kept with its own address' : ''}). ${added.notesReplaced ? 'Its notes were replaced with these.' : 'Its notes are unchanged.'}`,
            `picture: ${added.path}`,
          ];
    if (added.newKind) {
      const others = added.kindsBefore.map((k) => `${k.kind} (${k.count})`).join(', ');
      lines.push(others ? `"${added.ref.kind}" is a new kind. Kinds already kept: ${others}. When it is the same kind of screen as one of them, give that name from the next reference on.` : `"${added.ref.kind}" is a new kind (the first in the library).`);
    }
    const next = added.status === 'kept' || added.notesReplaced ? nextForKind(dir, added.ref.kind) : '';
    if (next) lines.push(next);
    return done({ ...added, ref: withPath(dir, added.ref) }, lines.join('\n'));
  }
  if (command === 'find') {
    const refs = readRefs(dir);
    const ask = { words: a.words, kind: a.one('--kind'), product: a.one('--product') };
    if (a.words.length === 0 && !ask.kind && !ask.product) {
      const kinds = refKinds(dir, refs);
      return done({ dir, total: refs.length, kinds }, refs.length === 0 ? EMPTY(dir) : `${plural(refs.length, 'reference')} kept, by kind:\n${renderKinds(dir, kinds)}\nsz-eyes refs find <words> [--kind <kind>] [--product <name>] looks among them`);
    }
    const matches = findRefs(dir, ask, refs);
    const asked = [a.words.length > 0 ? `"${a.words.join(' ')}"` : '', ask.kind ? `kind ${ask.kind}` : '', ask.product ? `product ${ask.product}` : ''].filter(Boolean).join(', ');
    const text =
      refs.length === 0 ? EMPTY(dir)
      : matches.length === 0 ? `nothing kept matches ${asked} (${plural(refs.length, 'reference')} kept). Kinds: ${refKinds(dir, refs).map((k) => `${k.kind} (${k.count})`).join(', ')}`
      : `${plural(matches.length, 'kept reference')} ${matches.length === 1 ? 'matches' : 'match'} ${asked}:\n\n${matches.map((ref) => renderRef(dir, ref)).join('\n\n')}`;
    return done({ dir, total: refs.length, matches: matches.map((ref) => withPath(dir, ref)) }, text);
  }
  if (command === 'kinds') {
    const refs = readRefs(dir);
    const kinds = refKinds(dir, refs);
    return done(kinds, refs.length === 0 ? EMPTY(dir) : `${plural(kinds.length, 'kind')}, ${plural(refs.length, 'reference')}:\n${renderKinds(dir, kinds)}`);
  }
  if (command === 'kind') {
    const name = a.words.join(' ').trim();
    if (!name) throw new RefsError('which kind: sz-eyes refs kind "<kind>" [--write <file.md>] (sz-eyes refs kinds lists them)');
    const write = a.one('--write');
    let wrote = '';
    if (write) {
      const path = resolve(write);
      if (!existsSync(path) || !statSync(path).isFile()) throw new RefsError(`--write ${write}: no such file`);
      const written = await writeKindPage(dir, name, readFileSync(path, 'utf8'));
      wrote = `page written: ${written.page}${written.previous ? ` (the one before is kept as ${written.previous})` : ''}\n\n`;
    }
    const refs = readRefs(dir);
    const mine = findRefs(dir, { kind: name }, refs);
    if (mine.length === 0) return done({ kind: name, slug: refSlug(name), page: null, pagePath: null, refs: [] }, `nothing is kept under "${name}". Kinds: ${refKinds(dir, refs).map((k) => `${k.kind} (${k.count})`).join(', ') || '(none yet)'}`);
    const kind = refKinds(dir, refs).find((k) => k.slug === refSlug(name))!;
    const pagePath = kindPage(dir, kind.slug);
    const page = existsSync(pagePath) ? readFileSync(pagePath, 'utf8') : null;
    const head = page === null
      ? `no page yet: read the references below and write what they teach, from all of them (sz-eyes refs kind "${kind.kind}" --write <file.md>)`
      : `${pagePath}${kind.keptSincePage > 0 ? ` (${plural(kind.keptSincePage, 'reference')} below kept after it was written: rewrite it from all of them with --write <file.md>)` : ''}\n\n${page.trimEnd()}`;
    return done({ ...kind, page, pagePath, refs: mine.map((ref) => withPath(dir, ref)) }, `${wrote}${kind.kind}: ${plural(mine.length, 'reference')}\n\n${head}\n\n${'-'.repeat(40)}\n\n${mine.map((ref) => renderRef(dir, ref)).join('\n\n')}`);
  }
  if (command === 'show') {
    const id = a.words[0];
    if (!id) throw new RefsError('which reference: sz-eyes refs show <id> (sz-eyes refs find lists them)');
    const ref = readRefs(dir).find((one) => one.id === id);
    if (!ref) throw new RefsError(`no reference ${id} is kept in ${dir} (sz-eyes refs find lists them)`);
    const text = [
      ref.id,
      `  kind      ${ref.kind}`,
      `  product   ${ref.product}`,
      `  what      ${ref.what}`,
      ...(ref.platform ? [`  platform  ${ref.platform}`] : []),
      ...(ref.lang ? [`  lang      ${ref.lang}`] : []),
      ...(ref.for ? [`  for       ${ref.for}`] : []),
      `  from      ${ref.link}`,
      `  picture   ${join(dir, ref.file)}`,
      `  sha256    ${ref.sha256}`,
      `  kept      ${ref.addedAt}`,
      '',
      ref.notes,
    ].join('\n');
    return done(withPath(dir, ref), text);
  }
  throw new RefsError('sz-eyes refs add|find|kinds|kind|show (sz-eyes help)');
}
