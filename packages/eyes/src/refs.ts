import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, rmdirSync, statSync } from 'node:fs';
import * as http from 'node:http';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { withFileLock, writeFileAtomic } from './lock.ts';

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

const writeIndex = (dir: string, refs: readonly Ref[]): void => writeFileAtomic(join(dir, REFS_INDEX), refs.map((ref) => `${JSON.stringify(ref)}\n`).join(''));

/** One writer of the library at a time, under the lock every sz-eyes file that several processes change is written under. */
async function exclusively<T>(dir: string, work: () => T): Promise<T> {
  mkdirSync(dir, { recursive: true });
  return withFileLock(join(dir, REFS_INDEX), work);
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

// What is said about a reference, checked one field at a time: add and edit make the same checks.

/** A kind, a product or a what: one line with a letter or digit in it. */
function checkName(key: 'kind' | 'product' | 'what', given: string): string {
  if (refSlug(given) === '') throw new RefsError(`--${key} "${given}" has no letter or digit in it`);
  return oneLine(given);
}

function checkLink(given: string): string {
  let link: URL;
  try {
    link = new URL(given.trim());
  } catch {
    throw new RefsError(`--link ${given} is not an address: give the address of the page the picture came from`);
  }
  if (link.protocol !== 'https:' && link.protocol !== 'http:') throw new RefsError(`--link ${given} is not the address of a page`);
  return given.trim();
}

function checkNotes(text: string): string {
  const notes = text.trim();
  const said = [...oneLine(notes)].length;
  if (said < MIN_NOTES) throw new RefsError(`the notes hold ${said} characters: say what is seen in the picture, in ${MIN_NOTES} characters at least (what the screen does, how, and what to take from it). A picture with nothing said about it is not a reference`);
  return notes;
}

/** A platform, or null when none is said. */
function checkPlatform(given: string | undefined): string | null {
  const platform = given?.trim().toLowerCase() || null;
  if (platform !== null && !PLATFORMS.includes(platform)) throw new RefsError(`--platform is one of ${PLATFORMS.join(', ')}`);
  return platform;
}

/** A language tag, or null when none is said. */
function checkLang(given: string | undefined): string | null {
  const lang = given?.trim().toLowerCase() || null;
  if (lang !== null && !/^[a-z]{2,3}(-[a-z0-9]{2,8})*$/.test(lang)) throw new RefsError(`--lang takes a language tag (ko, en, ja, zh-hant): ${given}`);
  return lang;
}

/** The text of the file --notes names. */
function notesFrom(file: string | undefined): string {
  if (!file) throw new RefsError(`--notes <file.md> is missing: say what is seen in the picture (what the screen does, how, and what to take from it), in ${MIN_NOTES} characters at least. A picture with nothing said about it is not a reference`);
  const path = resolve(file);
  if (!existsSync(path) || !statSync(path).isFile()) throw new RefsError(`--notes ${file}: no such file (--notes takes a file that says what is seen in the picture)`);
  return readFileSync(path, 'utf8');
}

function checked(input: RefInput): Omit<Ref, 'id' | 'file' | 'sha256' | 'addedAt'> {
  const missing = (['kind', 'product', 'what', 'link'] as const).filter((key) => oneLine(input[key] ?? '') === '');
  if (missing.length > 0) throw new RefsError(`${missing.map((key) => `--${key}`).join(', ')} missing: sz-eyes refs add --kind "<kind>" --product "<name>" --what "<which screen>" --link <the page it came from> (--file <picture> | --image <https address>) --notes <file.md>`);
  const [kind, product, what] = (['kind', 'product', 'what'] as const).map((key) => checkName(key, input[key])) as [string, string, string];
  const link = checkLink(input.link);
  const notes = checkNotes(input.notes);
  return { kind, product, what, platform: checkPlatform(input.platform), lang: checkLang(input.lang), link, for: oneLine(input.for ?? '') || null, notes };
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

/** The name a kind kept only by its page goes by: the page's first heading when it names that kind, else the page's own name. */
function pageKindName(page: string, slug: string): string {
  const heading = /^#\s+(.+)$/m.exec(readFileSync(page, 'utf8'))?.[1]?.trim() ?? '';
  return refSlug(heading) === slug ? oneLine(heading) : slug;
}

/**
 * Each kind, most references first, with whether it has a page and how many references came after it. A kind whose
 * references were all taken out keeps its page (the owner's writing), and is listed with none.
 */
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
  const pages = join(dir, 'kinds');
  for (const name of existsSync(pages) ? readdirSync(pages) : []) {
    if (!name.endsWith('.md') || name.endsWith('.prev.md')) continue;
    const slug = name.slice(0, -'.md'.length).normalize('NFC');
    if (!kinds.has(slug)) kinds.set(slug, { kind: pageKindName(join(pages, name), slug), slug, count: 0, page: true, keptSincePage: 0 });
  }
  return [...kinds.values()].sort((a, b) => b.count - a.count);
}

/** The ids nearest to one that is not kept: those sharing the longest beginning with it, when that is a real part of it. */
export function closestIds(asked: string, ids: readonly string[], most = 5): string[] {
  const want = asked.toLowerCase();
  const common = (id: string): number => {
    let n = 0;
    while (n < want.length && n < id.length && want[n] === id[n]!.toLowerCase()) n++;
    return n;
  };
  const best = Math.max(0, ...ids.map(common));
  if (best === 0 || best < Math.min(want.length, 4)) return [];
  return ids.filter((id) => common(id) === best).slice(0, most);
}

/** An id that is not kept, said plainly, with the ids nearest to it. */
function notKept(dir: string, id: string, refs: readonly Ref[]): RefsError {
  const near = closestIds(id, refs.map((ref) => ref.id)).map((one) => refs.find((ref) => ref.id === one)!);
  return new RefsError(`no reference ${id} is kept in ${dir} (sz-eyes refs find lists them)${near.length > 0 ? `. The closest: ${near.map((ref) => `${ref.id} ([${ref.kind}] ${ref.product}: ${ref.what})`).join(', ')}` : ''}`);
}

/** A kind's folder of pictures is taken away when nothing is left in it. */
function dropIfEmpty(folder: string): void {
  try {
    rmdirSync(folder);
  } catch {
    // Something is still in it, or it is gone already.
  }
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
    // A kind whose references were all taken out still has its page: it is not new.
    const newKind = !there && !existsSync(kindPage(dir, kindSlug));
    const productSlug = refSlug(given.product, 30);
    const file = `shots/${kindSlug}/${productSlug}-${refSlug(given.what, 40)}-${sha256.slice(0, 8)}.${picture.ext}`;
    let id = `${productSlug}-${sha256.slice(0, 8)}`;
    for (let n = 12; refs.some((ref) => ref.id === id); n += 4) id = `${productSlug}-${sha256.slice(0, n)}`;
    mkdirSync(join(dir, 'shots', kindSlug), { recursive: true });
    writeFileAtomic(join(dir, file), picture.bytes);
    const ref: Ref = { id, kind, product: given.product, what: given.what, platform: given.platform, lang: given.lang, link: given.link, file, sha256, addedAt: now, for: given.for, notes: given.notes };
    writeIndex(dir, [...refs, ref]);
    return { status: 'kept', sameAs: null, notesReplaced: false, newKind, kindsBefore, ref, path: join(dir, file) };
  });
}

/** What an edit changes, each field already checked as add checks it; a field left out stays as it is. */
export interface RefEdit {
  kind?: string;
  product?: string;
  what?: string;
  link?: string;
  notes?: string;
  platform?: string | null;
  lang?: string | null;
}

/** The fields an edit can change, in the order a change is said; `file` changes with the kind. */
const EDITABLE = ['kind', 'file', 'product', 'what', 'platform', 'lang', 'link', 'notes'] as const;

export interface RefChange {
  field: (typeof EDITABLE)[number];
  was: string | null;
  now: string | null;
}

export interface Edited {
  ref: Ref;
  /** Nothing, when the reference already said all that. */
  changes: RefChange[];
  newKind: boolean;
  /** The kinds the other references are kept under, and kinds kept only by their page. */
  kindsBefore: KindCount[];
  /** The kind it was moved out of, when no reference is kept under it now. */
  emptied: string | null;
}

/**
 * Puts right what is said about a reference, under the library's lock: the fields given change and the rest stay, the
 * id never changes. A new kind moves the picture into that kind's folder under the same file name (its hash kept):
 * copied there first, the index written, and only then the old file deleted, so the index never points at nothing.
 */
export async function editRef(dir: string, id: string, edit: RefEdit): Promise<Edited> {
  return exclusively(dir, () => {
    const refs = readRefs(dir);
    const before = refs.find((ref) => ref.id === id);
    if (!before) throw notKept(dir, id, refs);
    const others = refs.filter((ref) => ref.id !== id);
    if (edit.link !== undefined) {
      const holder = others.find((ref) => sameLink(ref.link, edit.link!));
      if (holder) throw new RefsError(`--link ${edit.link} is the address of ${holder.id} ([${holder.kind}] ${holder.product}: ${holder.what}), and an address is kept once: nothing was changed. When ${holder.id} is the one kept under the wrong address, put that right first`);
    }
    const kindsBefore = refKinds(dir, others);
    const there = edit.kind === undefined ? undefined : others.find((ref) => refSlug(ref.kind) === refSlug(edit.kind!));
    // A kind others hold keeps the name it was first given; a kind nobody else holds takes the name given now.
    const kind = edit.kind === undefined ? before.kind : (there?.kind ?? edit.kind);
    const moving = refSlug(kind) !== refSlug(before.kind);
    const file = moving ? `shots/${refSlug(kind)}/${basename(before.file)}` : before.file;
    if (moving) {
      const holder = others.find((ref) => ref.file === file);
      if (holder) throw new RefsError(`the picture would go to ${join(dir, file)}, which is ${holder.id}'s picture: nothing was changed`);
      if (!existsSync(join(dir, before.file))) throw new RefsError(`${id}'s picture is not where its line says (${join(dir, before.file)}), so it cannot be moved into "${kind}": nothing was changed. sz-eyes refs remove ${id} takes the line out, and refs add keeps it again`);
    }
    const ref: Ref = {
      ...before,
      kind,
      file,
      product: edit.product ?? before.product,
      what: edit.what ?? before.what,
      platform: edit.platform !== undefined ? edit.platform : before.platform,
      lang: edit.lang !== undefined ? edit.lang : before.lang,
      link: edit.link ?? before.link,
      notes: edit.notes ?? before.notes,
    };
    const changes = EDITABLE.filter((field) => ref[field] !== before[field]).map((field) => ({ field, was: before[field], now: ref[field] }));
    if (changes.length === 0) return { ref: before, changes, newKind: false, kindsBefore, emptied: null };
    if (moving) writeFileAtomic(join(dir, file), readFileSync(join(dir, before.file)));
    writeIndex(dir, refs.map((one) => (one.id === id ? ref : one)));
    if (moving) {
      rmSync(join(dir, before.file), { force: true });
      dropIfEmpty(dirname(join(dir, before.file)));
    }
    const emptied = moving && !others.some((one) => refSlug(one.kind) === refSlug(before.kind)) ? before.kind : null;
    return { ref, changes, newKind: moving && !there && !existsSync(kindPage(dir, refSlug(kind))), kindsBefore, emptied };
  });
}

export interface Removed {
  /** The whole entry as it was kept, notes and all. */
  ref: Ref;
  pictureDeleted: boolean;
  /** How many references its kind holds now. */
  left: number;
  /** Its kind's page, which stays. */
  page: string | null;
}

/** Takes a reference out, under the library's lock: its line first, then its picture (a crash between leaves a stray file, never a line pointing at nothing). */
export async function removeRef(dir: string, id: string): Promise<Removed> {
  return exclusively(dir, () => {
    const refs = readRefs(dir);
    const ref = refs.find((one) => one.id === id);
    if (!ref) throw notKept(dir, id, refs);
    const others = refs.filter((one) => one.id !== id);
    writeIndex(dir, others);
    const picture = join(dir, ref.file);
    const pictureDeleted = existsSync(picture) && !others.some((one) => one.file === ref.file);
    if (pictureDeleted) {
      rmSync(picture, { force: true });
      dropIfEmpty(dirname(picture));
    }
    const slug = refSlug(ref.kind);
    const page = kindPage(dir, slug);
    return { ref, pictureDeleted, left: others.filter((one) => refSlug(one.kind) === slug).length, page: existsSync(page) ? page : null };
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
    writeFileAtomic(page, text);
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
    const page = !k.page ? 'no page yet' : k.count === 0 ? 'page, and no reference kept under it now' : k.keptSincePage > 0 ? `page (${plural(k.keptSincePage, 'reference')} kept after it was written)` : 'page';
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

const LABELS: Record<RefChange['field'], string> = { kind: 'kind', file: 'picture', product: 'product', what: 'what', platform: 'platform', lang: 'lang', link: 'from', notes: 'notes' };

/** Each change, as it was and as it is now: the picture by where it is, the notes by how much they now hold. */
function renderChanges(dir: string, changes: readonly RefChange[]): string[] {
  return changes.flatMap(({ field, was, now }) => {
    if (field === 'notes') return [`  ${'notes'.padEnd(10)}replaced, ${[...(now ?? '')].length} characters`];
    const said = (value: string | null): string => (value === null ? '(not said)' : field === 'file' ? join(dir, value) : value);
    return [`  ${LABELS[field].padEnd(10)}was  ${said(was)}`, `  ${''.padEnd(10)}now  ${said(now)}`];
  });
}

/** What is said of a kind an edit or a remove left with no reference: its page, the owner's writing, stays. */
function emptiedLine(kind: string, page: string | null, gone: string | null): string {
  if (!page) return `"${kind}" holds no reference now, and had no page: it is no longer listed.`;
  return `"${kind}" holds no reference now. Its page${gone ? ` still speaks of ${gone}, and` : ''} stays as it is, since it is the owner's writing (${page}): sz-eyes refs kinds lists the kind with 0 references, and the page is rewritten once references of the kind are kept again.`;
}

/** The command line as cli.ts parses it: bare words, and `--flag value` pairs (every flag given, by name). */
export interface RefsArgs {
  words: string[];
  has: (flag: string) => boolean;
  one: (flag: string) => string | undefined;
  flags?: ReadonlyMap<string, unknown>;
}

const EDIT_USAGE = 'sz-eyes refs edit <id> [--kind "<kind>"] [--product "<name>"] [--what "<one line>"] [--notes <file.md>] [--platform ios|android|web] [--lang <code>] [--link <address>] [--json]';
const EDIT_TAKES = ['--kind', '--product', '--what', '--notes', '--platform', '--lang', '--link', '--json'];

/** The one id an edit or a remove is about. A flag it does not take is refused rather than passed over. */
function theId(a: RefsArgs, command: 'edit' | 'remove', usage: string, takes: readonly string[]): string {
  const id = a.words[0];
  if (!id) throw new RefsError(`which reference: ${usage} (sz-eyes refs find lists them)`);
  if (a.words.length > 1) throw new RefsError(`${command} takes one id, and ${a.words.slice(1).map((word) => JSON.stringify(word)).join(' ')} is more: a value of more than one word is given in quotes (--what "phone number first"). ${usage}`);
  const other = [...(a.flags?.keys() ?? [])].filter((flag) => !takes.includes(flag));
  if (other.includes('--file') || other.includes('--image')) throw new RefsError(`the picture is what a reference is: another picture is another reference (sz-eyes refs remove ${id}, then sz-eyes refs add). Nothing was changed`);
  if (other.length > 0) throw new RefsError(`${command} does not take ${other.join(', ')}: ${usage}`);
  return id;
}

/** `sz-eyes refs <command>`: what to print and the exit code. A refusal is thrown as a RefsError. */
export async function refsCommand(command: string | undefined, a: RefsArgs, dir: string = refsDir()): Promise<{ text: string; code: number }> {
  const json = a.has('--json');
  const done = (value: unknown, text: string): { text: string; code: number } => ({ text: json ? JSON.stringify(value, null, 2) : text, code: 0 });
  if (command === 'add') {
    const notes = notesFrom(a.one('--notes'));
    const added = await addRef(dir, { kind: a.one('--kind') ?? '', product: a.one('--product') ?? '', what: a.one('--what') ?? '', link: a.one('--link') ?? '', notes, file: a.one('--file'), image: a.one('--image'), platform: a.one('--platform'), lang: a.one('--lang'), for: a.one('--for') });
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
      return done({ dir, total: refs.length, kinds }, kinds.length === 0 ? EMPTY(dir) : `${plural(refs.length, 'reference')} kept, by kind:\n${renderKinds(dir, kinds)}\nsz-eyes refs find <words> [--kind <kind>] [--product <name>] looks among them`);
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
    return done(kinds, kinds.length === 0 ? EMPTY(dir) : `${plural(kinds.length, 'kind')}, ${plural(refs.length, 'reference')}:\n${renderKinds(dir, kinds)}`);
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
    if (mine.length === 0) {
      // A kind whose references were all taken out keeps its page, and the page can still be read.
      const kept = refKinds(dir, refs).find((k) => k.slug === refSlug(name) && k.page);
      if (kept) {
        const pagePath = kindPage(dir, kept.slug);
        const page = readFileSync(pagePath, 'utf8');
        return done({ ...kept, page, pagePath, refs: [] }, `${kept.kind}: no reference is kept under it now. Its page stays as it is (the owner's writing), and is rewritten once references of the kind are kept again\n\n${pagePath}\n\n${page.trimEnd()}`);
      }
      return done({ kind: name, slug: refSlug(name), page: null, pagePath: null, refs: [] }, `nothing is kept under "${name}". Kinds: ${refKinds(dir, refs).map((k) => `${k.kind} (${k.count})`).join(', ') || '(none yet)'}`);
    }
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
    const refs = readRefs(dir);
    const ref = refs.find((one) => one.id === id);
    if (!ref) throw notKept(dir, id, refs);
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
  if (command === 'edit') {
    const id = theId(a, 'edit', EDIT_USAGE, EDIT_TAKES);
    const edit: RefEdit = {};
    for (const key of ['kind', 'product', 'what'] as const) if (a.has(`--${key}`)) edit[key] = checkName(key, a.one(`--${key}`) ?? '');
    if (a.has('--link')) edit.link = checkLink(a.one('--link') ?? '');
    if (a.has('--notes')) edit.notes = checkNotes(notesFrom(a.one('--notes')));
    if (a.has('--platform')) edit.platform = checkPlatform(a.one('--platform'));
    if (a.has('--lang')) edit.lang = checkLang(a.one('--lang'));
    if (Object.keys(edit).length === 0) throw new RefsError(`what to change: ${EDIT_USAGE}`);
    const edited = await editRef(dir, id, edit);
    const { ref, changes } = edited;
    const value = { id, changes, ref: withPath(dir, ref), newKind: edited.newKind, emptied: edited.emptied };
    if (changes.length === 0) return done(value, `nothing changed: ${id} already says that`);
    const lines = [`edited: ${id}`, ...renderChanges(dir, changes)];
    if (edited.newKind) {
      const others = edited.kindsBefore.map((k) => `${k.kind} (${k.count})`).join(', ');
      lines.push(others ? `"${ref.kind}" is a new kind. Kinds already kept: ${others}. When it is the same kind of screen as one of them, give that name: sz-eyes refs edit ${id} --kind "<that name>".` : `"${ref.kind}" is a new kind (the only one in the library).`);
    }
    // The pages of the kind it was in and the kind it is in now were written before this change.
    const wasKind = changes.find((change) => change.field === 'kind')?.was ?? ref.kind;
    const kinds = refSlug(wasKind) === refSlug(ref.kind) ? [ref.kind] : [wasKind, ref.kind];
    for (const kind of kinds) {
      const page = kindPage(dir, refSlug(kind));
      if (edited.emptied !== null && refSlug(kind) === refSlug(edited.emptied)) lines.push(emptiedLine(kind, existsSync(page) ? page : null, null));
      else if (existsSync(page)) lines.push(`The page of "${kind}" (${page}) was written before this change: read it again (sz-eyes refs kind "${kind}") and, where what it says rested on what changed, rewrite it from its references (sz-eyes refs kind "${kind}" --write <file.md>).`);
    }
    return done(value, lines.join('\n'));
  }
  if (command === 'remove') {
    const usage = 'sz-eyes refs remove <id> [--json]';
    const removed = await removeRef(dir, theId(a, 'remove', usage, ['--json']));
    const { ref } = removed;
    const flag = (name: string, value: string | null): string => (value ? ` --${name} ${JSON.stringify(value)}` : '');
    const lines = [
      `removed: ${ref.id} (${removed.pictureDeleted ? 'its picture is deleted' : 'its picture was not there'}: ${join(dir, ref.file)})`,
      `  kind      ${ref.kind}`,
      `  product   ${ref.product}`,
      `  what      ${ref.what}`,
      ...(ref.platform ? [`  platform  ${ref.platform}`] : []),
      ...(ref.lang ? [`  lang      ${ref.lang}`] : []),
      ...(ref.for ? [`  for       ${ref.for}`] : []),
      `  from      ${ref.link}`,
      `  kept      ${ref.addedAt}`,
      '',
      ref.notes,
      '',
      `To keep it again: sz-eyes refs add --kind ${JSON.stringify(ref.kind)} --product ${JSON.stringify(ref.product)} --what ${JSON.stringify(ref.what)} --link ${ref.link}${flag('platform', ref.platform)}${flag('lang', ref.lang)}${flag('for', ref.for)} (--file <picture> | --image <https address of the picture>) --notes <a file holding the notes above>`,
    ];
    if (removed.left === 0) lines.push(emptiedLine(ref.kind, removed.page, ref.id));
    else if (removed.page) lines.push(`The page of "${ref.kind}" (${removed.page}) was written while ${ref.id} was kept, and still speaks of it: read it again (sz-eyes refs kind "${ref.kind}") and rewrite it from the ${plural(removed.left, 'reference')} left (sz-eyes refs kind "${ref.kind}" --write <file.md>).`);
    return done({ removed: withPath(dir, ref), pictureDeleted: removed.pictureDeleted, left: removed.left, page: removed.page }, lines.join('\n'));
  }
  throw new RefsError('sz-eyes refs add|find|kinds|kind|show|edit|remove (sz-eyes help)');
}
