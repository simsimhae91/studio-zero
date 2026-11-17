import { spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, rmdirSync, statSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { withFileLock, writeFileAtomic } from './lock.ts';
import { closestIds, keptInside, refSlug } from './refs.ts';

/**
 * The owner's stock of pictures: every picture made for a product's screens, kept with the words it was made
 * from, so that the next product takes it instead of making it again. Designer agents made the same pictures for
 * every product (faces for avatars, a bathroom scale, a meal), each one to three minutes of the owner's
 * subscription. The owner's decision (2026-11-17): a face photograph as an avatar is fine, made every time is not:
 * "저장해두죠". So every picture made is kept here, and the stock is looked in before anything is made.
 *
 * It is the owner's own and lives on this machine, outside any project and any repository.
 *
 *   index.jsonl                                 one picture a line
 *   pictures/<kind>/<what>-<sha8>.<ext>
 */
export class StockError extends Error {
  /** The session's command sandbox stopped it: says nothing about the stock or the picture. */
  readonly sandboxed: boolean;
  constructor(message: string, sandboxed = false) {
    super(message);
    this.sandboxed = sandboxed;
  }
}

export const STOCK_INDEX = 'index.jsonl';
/** What a picture is named in a project: lower-case letters, digits and dashes (the same rule as image make). */
export const PICTURE_NAME = /^[a-z0-9][a-z0-9-]{0,60}$/;
const MAX_SIDE = 10_000;

export interface StockPicture {
  id: string;
  kind: string;
  /** One line: what is in the picture. */
  what: string;
  /** The words it was made from, when they are known. */
  prompt: string | null;
  width: number;
  height: number;
  /** The picture, from the stock's folder. */
  file: string;
  sha256: string;
  addedAt: string;
  /** What made it (codex, for a picture made by sz-eyes image make); null when that was not said. */
  madeBy: string | null;
  /** The project it was made or kept for. */
  for: string | null;
}

export interface StockKind {
  kind: string;
  slug: string;
  count: number;
}

/** `$SZ_STOCK_DIR`, or `~/.studio-zero/stock`. */
export function stockDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.SZ_STOCK_DIR ? resolve(env.SZ_STOCK_DIR) : join(homedir(), '.studio-zero', 'stock');
}

const oneLine = (text: string): string => text.replace(/\s+/g, ' ').trim();
const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;
const codeOf = (err: unknown): string | undefined => (err as NodeJS.ErrnoException | null)?.code;

export type PictureType = 'png' | 'jpg' | 'webp';

/**
 * What the bytes are and how big, from their first bytes: a PNG, a JPEG or a WebP (the kinds a product's screen
 * shows), or null for anything else. `size` is null when the kind is plain but the size cannot be read from it.
 */
export function pictureOf(bytes: Buffer): { type: PictureType; size: [number, number] | null } | null {
  const ascii = (from: number, to: number): string => bytes.subarray(from, to).toString('latin1');
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { type: 'png', size: bytes.length >= 24 && ascii(12, 16) === 'IHDR' ? [bytes.readUInt32BE(16), bytes.readUInt32BE(20)] : null };
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { type: 'jpg', size: jpegSize(bytes) };
  if (bytes.length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return { type: 'webp', size: webpSize(bytes) };
  return null;
}

/** A JPEG's size, from the first frame header among its segments. */
function jpegSize(bytes: Buffer): [number, number] | null {
  let at = 2;
  while (at + 4 <= bytes.length) {
    if (bytes[at] !== 0xff) return null;
    const marker = bytes[at + 1]!;
    if (marker === 0xff) {
      at++;
      continue;
    }
    // Markers that stand alone, with no length after them.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      at += 2;
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) return null;
    const length = bytes.readUInt16BE(at + 2);
    const frame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (frame) return at + 9 <= bytes.length ? [bytes.readUInt16BE(at + 7), bytes.readUInt16BE(at + 5)] : null;
    at += 2 + length;
  }
  return null;
}

/** A WebP's size, from its first chunk: lossy (VP8), lossless (VP8L) or extended (VP8X). */
function webpSize(bytes: Buffer): [number, number] | null {
  const chunk = bytes.subarray(12, 16).toString('latin1');
  if (chunk === 'VP8 ' && bytes.length >= 30) return [bytes.readUInt16LE(26) & 0x3fff, bytes.readUInt16LE(28) & 0x3fff];
  if (chunk === 'VP8L' && bytes.length >= 25 && bytes[20] === 0x2f) {
    const bits = bytes.readUInt32LE(21);
    return [(bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1];
  }
  if (chunk === 'VP8X' && bytes.length >= 30) return [bytes.readUIntLE(24, 3) + 1, bytes.readUIntLE(27, 3) + 1];
  return null;
}

function isPicture(value: unknown): value is StockPicture {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  const text = ['id', 'kind', 'what', 'file', 'sha256', 'addedAt'].every((key) => typeof v[key] === 'string');
  const maybe = ['prompt', 'madeBy', 'for'].every((key) => v[key] === null || typeof v[key] === 'string');
  const sizes = ['width', 'height'].every((key) => Number.isInteger(v[key]));
  return text && maybe && sizes;
}

/** Every picture kept, in the order kept. Nothing is read past, or written over, a line that cannot be read. */
export function readStock(dir: string): StockPicture[] {
  const file = join(dir, STOCK_INDEX);
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8')
    .split('\n')
    .flatMap((line, i) => {
      if (line.trim() === '') return [];
      let picture: unknown = null;
      try {
        picture = JSON.parse(line);
      } catch {
        // said below
      }
      if (!isPicture(picture)) throw new StockError(`line ${i + 1} of ${file} cannot be read as a picture of the stock: put it right by hand or take it out (nothing is written over an index that cannot be read)`);
      return [picture];
    });
}

const writeIndex = (dir: string, pictures: readonly StockPicture[]): void => writeFileAtomic(join(dir, STOCK_INDEX), pictures.map((picture) => `${JSON.stringify(picture)}\n`).join(''));

/** Why the stock cannot be written here and what came of it, said so that whoever runs it knows what to do. */
function cannotWrite(dir: string, err: unknown, outcome = 'nothing was kept'): StockError {
  const code = codeOf(err) ?? (err as Error).message;
  const sandboxed = code === 'EPERM';
  return new StockError(
    `the stock is ${dir}, and this command cannot write there (${code}): ${outcome}. ${sandboxed ? "Run it outside the session's command sandbox (dangerouslyDisableSandbox: true on the Bash call)." : `When it runs inside the session's command sandbox, run it outside (dangerouslyDisableSandbox: true on the Bash call); otherwise ${dir} has to be writable by this user.`}`,
    sandboxed,
  );
}
const DENIED = new Set(['EPERM', 'EACCES', 'EROFS']);

/** Whether the stock can be written, asked before anything is spent on a picture that is to go into it. */
export function checkWritable(dir: string, outcome: string): void {
  try {
    mkdirSync(dir, { recursive: true });
    rmdirSync(mkdtempSync(join(dir, '.sz-stock-')));
  } catch (err) {
    throw cannotWrite(dir, err, outcome);
  }
}

/** One writer of the stock at a time, under the lock every sz-eyes file that several processes change is written under. */
function exclusively<T>(dir: string, work: () => T): T {
  try {
    mkdirSync(dir, { recursive: true });
    return withFileLock(join(dir, STOCK_INDEX), work);
  } catch (err) {
    if (DENIED.has(codeOf(err) ?? '')) throw cannotWrite(dir, err);
    throw err;
  }
}

/** Each kind, most pictures first; kinds are one kind whatever their case. */
export function stockKinds(pictures: readonly StockPicture[]): StockKind[] {
  const kinds = new Map<string, StockKind>();
  for (const picture of pictures) {
    const slug = refSlug(picture.kind);
    const kind = kinds.get(slug) ?? { kind: picture.kind, slug, count: 0 };
    kind.count++;
    kinds.set(slug, kind);
  }
  return [...kinds.values()].sort((a, b) => b.count - a.count);
}

/** The pictures of a kind, whatever case it is given in. */
export const ofKind = (pictures: readonly StockPicture[], kind: string): StockPicture[] => pictures.filter((picture) => refSlug(picture.kind) === refSlug(kind));

export interface PictureFields {
  kind: string;
  what: string;
  prompt?: string | undefined;
  for?: string | undefined;
}

/** The flags that are missing of --kind and --what. */
export const missingFields = (given: { kind?: string | undefined; what?: string | undefined }): string[] => (['kind', 'what'] as const).filter((key) => oneLine(given[key] ?? '') === '').map((key) => `--${key}`);

/** What a picture is kept as, checked: a kind and a what with a letter or digit in each. */
export function checkFields(given: PictureFields): { kind: string; what: string; prompt: string | null; for: string | null } {
  const missing = missingFields(given);
  if (missing.length > 0) throw new StockError(`${missing.join(', ')} missing`);
  for (const key of ['kind', 'what'] as const) if (refSlug(given[key]) === '') throw new StockError(`--${key} "${given[key]}" has no letter or digit in it`);
  return { kind: oneLine(given.kind), what: oneLine(given.what), prompt: (given.prompt ?? '').trim() || null, for: oneLine(given.for ?? '') || null };
}

export interface KeptPicture {
  status: 'kept' | 'already kept';
  newKind: boolean;
  /** The kinds there were before this one. */
  kindsBefore: StockKind[];
  picture: StockPicture;
  path: string;
}

/**
 * Keeps a picture: the file under pictures/<kind>/, and a line in the index. The same picture (by its bytes) is
 * kept once: the one kept first is left as it was.
 */
export function keepPicture(dir: string, bytes: Buffer, given: PictureFields & { madeBy?: string | null }, now = new Date().toISOString()): KeptPicture {
  const fields = checkFields(given);
  const seen = pictureOf(bytes);
  if (!seen) throw new StockError(`it is not a picture: ${NOT_A_PICTURE}`);
  if (!seen.size) throw new StockError(`its size cannot be read from it (a ${seen.type.toUpperCase()} whose header is not whole): nothing was kept`);
  const [width, height] = seen.size;
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  return exclusively(dir, () => {
    // Read inside the lock: what another writer kept a moment ago is in it.
    const pictures = readStock(dir);
    const kindsBefore = stockKinds(pictures);
    const held = pictures.find((picture) => picture.sha256 === sha256);
    if (held) return { status: 'already kept', newKind: false, kindsBefore, picture: held, path: join(dir, held.file) };
    const there = ofKind(pictures, fields.kind)[0];
    // A kind is kept under the name it was first given, whatever case it comes in later.
    const kind = there?.kind ?? fields.kind;
    const kindSlug = refSlug(kind);
    const whatSlug = refSlug(fields.what, 40);
    const named = (n: number): { id: string; file: string } => ({ id: `${refSlug(kind, 20)}-${sha256.slice(0, n)}`, file: `pictures/${kindSlug}/${whatSlug}-${sha256.slice(0, n)}.${seen.type}` });
    let n = 8;
    while (pictures.some((picture) => picture.id === named(n).id || picture.file === named(n).file)) n += 4;
    const { id, file } = named(n);
    writeFileAtomic(join(dir, file), bytes);
    const picture: StockPicture = { id, kind, what: fields.what, prompt: fields.prompt, width, height, file, sha256, addedAt: now, madeBy: given.madeBy ?? null, for: fields.for };
    writeIndex(dir, [...pictures, picture]);
    return { status: 'kept', newKind: !there, kindsBefore, picture, path: join(dir, file) };
  });
}

const NOT_A_PICTURE = 'PNG, JPEG or WebP (what a screen shows) are kept';

/** An id that is not kept, said plainly, with the ids nearest to it. */
function notKept(dir: string, id: string, pictures: readonly StockPicture[]): StockError {
  const near = closestIds(id, pictures.map((picture) => picture.id)).map((one) => pictures.find((picture) => picture.id === one)!);
  return new StockError(`no picture ${id} is kept in ${dir} (sz-eyes image find lists them)${near.length > 0 ? `. The closest: ${near.map((picture) => `${picture.id} ([${picture.kind}] ${picture.what})`).join(', ')}` : ''}`);
}

/** A kind's folder of pictures is taken away when nothing is left in it. */
function dropIfEmpty(folder: string): void {
  try {
    rmdirSync(folder);
  } catch {
    // Something is still in it, or it is gone already.
  }
}

/** What an edit changes, each field already checked; a field left out stays as it is, and a prompt of null is taken out. */
export interface PictureEdit {
  kind?: string;
  what?: string;
  prompt?: string | null;
}

/** The fields an edit can change, in the order a change is said; `file` changes with the kind. */
const EDITABLE = ['kind', 'file', 'what', 'prompt'] as const;

export interface PictureChange {
  field: (typeof EDITABLE)[number];
  was: string | null;
  now: string | null;
}

export interface EditedPicture {
  picture: StockPicture;
  /** Nothing, when the picture's entry already said all that. */
  changes: PictureChange[];
  newKind: boolean;
  /** The kinds the other pictures are kept under. */
  kindsBefore: StockKind[];
  /** The kind it was moved out of, when no picture is kept under it now. */
  emptied: string | null;
}

/**
 * Puts right what is said about a picture of the stock, under the stock's lock: the fields given change and the rest
 * stay, the id never changes. A new kind moves the picture into that kind's folder under the same file name (its hash
 * kept): copied there first, the index written, and only then the old file deleted, so the index never points at nothing.
 */
export function editPicture(dir: string, id: string, edit: PictureEdit): EditedPicture {
  return exclusively(dir, () => {
    const pictures = readStock(dir);
    const before = pictures.find((picture) => picture.id === id);
    if (!before) throw notKept(dir, id, pictures);
    const others = pictures.filter((picture) => picture.id !== id);
    const kindsBefore = stockKinds(others);
    const there = edit.kind === undefined ? undefined : ofKind(others, edit.kind)[0];
    // A kind others hold keeps the name it was first given; a kind nobody else holds takes the name given now.
    const kind = edit.kind === undefined ? before.kind : (there?.kind ?? edit.kind);
    const moving = refSlug(kind) !== refSlug(before.kind);
    const file = moving ? `pictures/${refSlug(kind)}/${basename(before.file)}` : before.file;
    if (moving) {
      const holder = others.find((picture) => picture.file === file);
      if (holder) throw new StockError(`the picture would go to ${join(dir, file)}, which is ${holder.id}'s picture: nothing was changed`);
      if (!keptInside(dir, before.file) || !existsSync(join(dir, before.file))) throw new StockError(`${id}'s picture is not where its line says (${join(dir, before.file)}), so it cannot be moved into "${kind}": nothing was changed. sz-eyes image remove ${id} takes the line out`);
    }
    const picture: StockPicture = { ...before, kind, file, what: edit.what ?? before.what, prompt: edit.prompt !== undefined ? edit.prompt : before.prompt };
    const changes = EDITABLE.filter((field) => picture[field] !== before[field]).map((field) => ({ field, was: before[field], now: picture[field] }));
    if (changes.length === 0) return { picture: before, changes, newKind: false, kindsBefore, emptied: null };
    if (moving) writeFileAtomic(join(dir, file), readFileSync(join(dir, before.file)));
    writeIndex(dir, pictures.map((one) => (one.id === id ? picture : one)));
    if (moving) {
      rmSync(join(dir, before.file), { force: true });
      dropIfEmpty(dirname(join(dir, before.file)));
    }
    const emptied = moving && ofKind(others, before.kind).length === 0 ? before.kind : null;
    return { picture, changes, newKind: moving && !there, kindsBefore, emptied };
  });
}

export interface RemovedPicture {
  /** The whole entry as it was kept. */
  picture: StockPicture;
  pictureDeleted: boolean;
  /** How many pictures its kind holds now. */
  left: number;
}

/**
 * Takes a picture out of the stock, under its lock: its line first, then its file in the stock (a crash between
 * leaves a stray file, never a line pointing at nothing). A copy put in a project is the project's, and is not touched.
 */
export function removePicture(dir: string, id: string): RemovedPicture {
  return exclusively(dir, () => {
    const pictures = readStock(dir);
    const picture = pictures.find((one) => one.id === id);
    if (!picture) throw notKept(dir, id, pictures);
    const others = pictures.filter((one) => one.id !== id);
    writeIndex(dir, others);
    const path = join(dir, picture.file);
    const pictureDeleted = keptInside(dir, picture.file) && existsSync(path) && !others.some((one) => one.file === picture.file);
    if (pictureDeleted) {
      rmSync(path, { force: true });
      dropIfEmpty(dirname(path));
    }
    return { picture, pictureDeleted, left: ofKind(others, picture.kind).length };
  });
}

/** The pictures that have every word somewhere in their kind, what or prompt (any case), and are of the kind asked. */
export function findPictures(pictures: readonly StockPicture[], ask: { words?: readonly string[]; kind?: string | undefined }): StockPicture[] {
  const fold = (text: string): string => text.normalize('NFC').toLowerCase();
  const words = (ask.words ?? []).flatMap((word) => fold(word).split(/\s+/)).filter(Boolean);
  const kind = ask.kind ? refSlug(ask.kind) : null;
  return pictures.filter((picture) => {
    const hay = fold(`${picture.kind}\n${picture.what}\n${picture.prompt ?? ''}`);
    return words.every((word) => hay.includes(word)) && (kind === null || refSlug(picture.kind) === kind);
  });
}

/** `WxH` → [width, height], each from 1 to 10000. */
export function askedSize(given: string): [number, number] {
  const match = /^(\d{1,5})\s*[x×]\s*(\d{1,5})$/i.exec(given.trim());
  const size = match ? ([Number(match[1]), Number(match[2])] as [number, number]) : null;
  if (!size || size.some((side) => side < 1 || side > MAX_SIDE)) throw new StockError(`--size ${given}: give it as <width>x<height> in pixels (96x96, 1200x630), each from 1 to ${MAX_SIDE}`);
  return size;
}

/** The name a picture is put in a project under, without the type it may be given with. */
export function pictureName(given: string | undefined): string {
  const name = (given ?? '').trim().replace(/\.(png|jpe?g|webp)$/i, '');
  if (name === '') throw new StockError('--name <name> is missing: the picture is written as <name>.<its type>');
  if (!PICTURE_NAME.test(name)) throw new StockError(`--name ${name}: lower-case letters, digits and dashes, 61 at most (the picture is written as <name>.<its type>)`);
  return name;
}

/**
 * One run of macOS's sips. sips writes its working copy in the system's own temporary folder, which the session's
 * command sandbox does not let it write: that is told apart, since it says nothing about the picture.
 */
function sips(args: string[], work: string): void {
  const ran = spawnSync('sips', args, { encoding: 'utf8', timeout: 60_000 });
  if (ran.error) {
    if (codeOf(ran.error) === 'ENOENT') throw new StockError('sips is not on this machine (it comes with macOS, and resizes the copy): nothing was put in the project. Without --size the picture is copied as it is');
    throw new StockError(`sips could not be run (${ran.error.message}): nothing was put in the project`);
  }
  const said = `${ran.stderr ?? ''}${ran.stdout ?? ''}`;
  const elsewhere = /Cannot write to file (\/\S+)/.exec(said);
  if (elsewhere && !resolve(elsewhere[1]!).startsWith(resolve(work))) {
    throw new StockError(`sips keeps its working copy in the system's temporary folder (${elsewhere[1]}), and this command cannot write there: nothing was put in the project. Run it outside the session's command sandbox (dangerouslyDisableSandbox: true on the Bash call), or without --size`, true);
  }
  if (ran.status !== 0 || /^Error/m.test(said)) throw new StockError(`sips could not resize the picture (${oneLine(said).slice(0, 300) || `exit ${ran.status}`}): nothing was put in the project`);
}

export interface UsedPicture {
  path: string;
  id: string;
  kind: string;
  what: string;
  width: number;
  height: number;
  bytes: number;
  /** The size it is kept at in the stock, when the copy was resized. */
  from: string | null;
  replaced: boolean;
}

/**
 * Puts a stock picture in a project as `<out>/<name>.<type>`: as it is kept, or resized to exactly `size`
 * (scaled to cover it and cut from the middle, never stretched; a WebP comes out a PNG, which sips can write). The
 * copy is made whole in a folder of its own and only then renamed into place, so a file an earlier call left under
 * that name stays as it was when anything fails.
 */
export function usePicture(dir: string, id: string, ask: { name: string; out: string; size?: [number, number] | undefined }): UsedPicture {
  const pictures = readStock(dir);
  const picture = pictures.find((one) => one.id === id);
  if (!picture) throw notKept(dir, id, pictures);
  const source = join(dir, picture.file);
  if (!existsSync(source)) throw new StockError(`${id} is in the stock's index, but its picture is not there (${source}): nothing was put in the project`);
  const bytes = readFileSync(source);
  if (createHash('sha256').update(bytes).digest('hex') !== picture.sha256) throw new StockError(`the file kept as ${id} (${source}) is no longer the picture that was kept (its bytes changed): nothing was put in the project`);
  const type = pictureOf(bytes)?.type ?? 'png';
  const [width, height] = ask.size ?? [picture.width, picture.height];
  const resize = width !== picture.width || height !== picture.height;
  const ext = resize && type === 'webp' ? 'png' : type;
  const work = mkdtempSync(join(tmpdir(), 'sz-stock-'));
  try {
    const made = join(work, `${ask.name}.${ext}`);
    if (!resize) writeFileSync(made, bytes);
    else {
      const original = join(work, `original.${type}`);
      writeFileSync(original, bytes);
      // Scaled until it covers the asked size, then cut to it from the middle.
      const scale = Math.max(width / picture.width, height / picture.height);
      const scaled: [number, number] = [Math.max(width, Math.round(picture.width * scale)), Math.max(height, Math.round(picture.height * scale))];
      sips([...(ext !== type ? ['-s', 'format', ext] : []), '-z', String(scaled[1]), String(scaled[0]), original, '--out', made], work);
      if (scaled[0] !== width || scaled[1] !== height) sips(['-c', String(height), String(width), made], work);
      const result = existsSync(made) ? pictureOf(readFileSync(made)) : null;
      if (!result?.size) throw new StockError(`what sips left is not a picture: nothing was put in the project`);
      if (result.size[0] !== width || result.size[1] !== height) throw new StockError(`sips left a picture of ${result.size[0]}x${result.size[1]}, not a picture of ${width}x${height}: nothing was put in the project`);
    }
    mkdirSync(ask.out, { recursive: true });
    const target = join(ask.out, `${ask.name}.${ext}`);
    const replaced = existsSync(target);
    // Copied next to its place, then renamed into it: the name is never half-written, whatever runs beside it.
    const part = join(ask.out, `.${ask.name}.${ext}.${process.pid}-${randomBytes(4).toString('hex')}.part`);
    try {
      copyFileSync(made, part);
      renameSync(part, target);
    } catch (err) {
      rmSync(part, { force: true });
      throw err;
    }
    return { path: target, id, kind: picture.kind, what: picture.what, width, height, bytes: statSync(target).size, from: resize ? `${picture.width}x${picture.height}` : null, replaced };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/** The picture at a path on disk, or why it cannot be kept. */
export function pictureFromFile(path: string): Buffer {
  if (!existsSync(path) || !statSync(path).isFile()) throw new StockError(`--file ${path}: no such file`);
  const bytes = readFileSync(path);
  const seen = pictureOf(bytes);
  if (!seen) throw new StockError(`--file ${path} is not a picture: ${NOT_A_PICTURE}`);
  if (!seen.size) throw new StockError(`--file ${path}: its size cannot be read from it (a ${seen.type.toUpperCase()} whose header is not whole): nothing was kept`);
  return bytes;
}

const withPath = (dir: string, picture: StockPicture): StockPicture & { path: string } => ({ ...picture, path: join(dir, picture.file) });

/** How many columns a terminal gives the text: a Hangul or CJK letter takes two. */
const columns = (text: string): number => [...text].reduce((n, ch) => n + (/[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/.test(ch) ? 2 : 1), 0);

function renderKinds(dir: string, kinds: readonly StockKind[]): string {
  const width = Math.max(...kinds.map((k) => columns(k.kind)));
  return `${kinds.map((k) => `  ${k.kind}${' '.repeat(width - columns(k.kind))}  ${String(k.count).padStart(3)}`).join('\n')}\n  (in ${dir})`;
}

const kindList = (kinds: readonly StockKind[]): string => kinds.map((k) => `${k.kind} (${k.count})`).join(', ');

/** A picture as `find` lists it: what it is, where it is, its size and when it was kept. */
export function renderPicture(dir: string, picture: StockPicture): string {
  return [
    `${picture.id}  [${picture.kind}] ${picture.what}`,
    `  picture  ${join(dir, picture.file)}`,
    `  size     ${picture.width}x${picture.height}`,
    `  kept     ${picture.addedAt.slice(0, 10)}${picture.for ? ` (for ${picture.for})` : ''}`,
  ].join('\n');
}

/** For a kind not seen before, the kinds there are, so that a name is reused; nothing for a kind already there. */
export function newKindLine(kept: KeptPicture): string[] {
  if (!kept.newKind) return [];
  return [kept.kindsBefore.length > 0 ? `"${kept.picture.kind}" is a new kind. Kinds already kept: ${kindList(kept.kindsBefore)}. When it is the same kind of picture as one of them, give that name from the next one on.` : `"${kept.picture.kind}" is a new kind (the first in the stock).`];
}

/** What keep says: the picture's id and where it is, or which picture already holds it. */
export function renderKept(kept: KeptPicture): string[] {
  const head = kept.status === 'kept' ? `kept: ${kept.picture.id}` : `already kept: ${kept.picture.id} (the same picture, as [${kept.picture.kind}] ${kept.picture.what})`;
  return [head, `picture: ${kept.path}`, ...newKindLine(kept)];
}

/** What a make is told before codex starts, when the stock already holds pictures of its kind. */
export function reminder(pictures: readonly StockPicture[], kind: string): string | null {
  const mine = ofKind(pictures, kind);
  if (mine.length === 0) return null;
  const name = mine[0]!.kind;
  return `the stock already holds ${plural(mine.length, 'picture')} of kind "${name}": sz-eyes image find --kind "${name}" lists ${mine.length === 1 ? 'it' : 'them'}, and sz-eyes image use <id> --name <name> takes one in seconds. Going on with a new one.`;
}

const EMPTY = (dir: string): string => `nothing is kept yet in ${dir}: every picture sz-eyes image make makes is kept there, and sz-eyes image keep brings in one made before (sz-eyes help)`;

const LABELS: Record<PictureChange['field'], string> = { kind: 'kind', file: 'picture', what: 'what', prompt: 'prompt' };

/** Each change, as it was and as it is now: the picture by where it is. */
function renderChanges(dir: string, changes: readonly PictureChange[]): string[] {
  return changes.flatMap(({ field, was, now }) => {
    const said = (value: string | null): string => (value === null ? '(not said)' : field === 'file' ? join(dir, value) : value);
    return [`  ${LABELS[field].padEnd(10)}was  ${said(was)}`, `  ${''.padEnd(10)}now  ${said(now)}`];
  });
}

/** The command line as cli.ts parses it: bare words, and `--flag value` pairs (every flag given, by name). */
export interface StockArgs {
  words: string[];
  has: (flag: string) => boolean;
  one: (flag: string) => string | undefined;
  flags?: ReadonlyMap<string, unknown>;
}

const EDIT_USAGE = 'sz-eyes image edit <id> [--kind "<kind>"] [--what "<one line>"] [--prompt "<words>"] [--json]';

/** The one id an edit or a remove is about. A flag it does not take is refused rather than passed over. */
function theId(a: StockArgs, command: 'edit' | 'remove', usage: string, takes: readonly string[]): string {
  const id = a.words[0];
  if (!id) throw new StockError(`which picture: ${usage} (sz-eyes image find lists them)`);
  if (a.words.length > 1) throw new StockError(`${command} takes one id, and ${a.words.slice(1).map((word) => JSON.stringify(word)).join(' ')} is more: a value of more than one word is given in quotes (--what "smiling woman"). ${usage}`);
  const other = [...(a.flags?.keys() ?? [])].filter((flag) => !takes.includes(flag));
  if (other.includes('--file')) throw new StockError(`the picture is what an entry of the stock is: another picture is another entry (sz-eyes image remove ${id}, then sz-eyes image keep). Nothing was changed`);
  if (other.length > 0) throw new StockError(`${command} does not take ${other.join(', ')}: ${usage}`);
  return id;
}

/** `sz-eyes image find|use|keep|show|edit|remove`: what to print and the exit code. A refusal is thrown as a StockError. */
export function stockCommand(command: 'find' | 'use' | 'keep' | 'show' | 'edit' | 'remove', a: StockArgs, { dir, out }: { dir: string; out: string }): { text: string; code: number } {
  const json = a.has('--json');
  const done = (value: unknown, text: string): { text: string; code: number } => ({ text: json ? JSON.stringify(value, null, 2) : text, code: 0 });
  if (command === 'find') {
    const pictures = readStock(dir);
    const ask = { words: a.words, kind: a.one('--kind') };
    if (a.words.length === 0 && !ask.kind) {
      const kinds = stockKinds(pictures);
      return done({ dir, total: pictures.length, kinds }, pictures.length === 0 ? EMPTY(dir) : `${plural(pictures.length, 'picture')} kept, by kind:\n${renderKinds(dir, kinds)}\nsz-eyes image find <words> [--kind <kind>] looks among them`);
    }
    const matches = findPictures(pictures, ask);
    const asked = [a.words.length > 0 ? `"${a.words.join(' ')}"` : '', ask.kind ? `kind ${ask.kind}` : ''].filter(Boolean).join(', ');
    const text =
      pictures.length === 0 ? EMPTY(dir)
      : matches.length === 0 ? `nothing kept matches ${asked} (${plural(pictures.length, 'picture')} kept). Kinds: ${kindList(stockKinds(pictures))}`
      : `${plural(matches.length, 'kept picture')} ${matches.length === 1 ? 'matches' : 'match'} ${asked}:\n\n${matches.map((picture) => renderPicture(dir, picture)).join('\n\n')}\n\nsz-eyes image use <id> --name <name> [--size <WxH>] puts one in the project`;
    return done({ dir, total: pictures.length, matches: matches.map((picture) => withPath(dir, picture)) }, text);
  }
  if (command === 'use') {
    const id = a.words[0];
    if (!id) throw new StockError('which picture: sz-eyes image use <id> --name <name> [--size <WxH>] [--out <folder>] (sz-eyes image find lists them)');
    const name = pictureName(a.one('--name'));
    const size = a.one('--size') !== undefined ? askedSize(a.one('--size')!) : undefined;
    const used = usePicture(dir, id, { name, out, size });
    return done(used, `${used.path}\n${used.width}x${used.height}, ${Math.max(1, Math.round(used.bytes / 1024))} KB, from the stock: ${used.id} ([${used.kind}] ${used.what})${used.from ? `, cut to this size from ${used.from}` : ''}${used.replaced ? ` (it replaces the earlier ${basename(used.path)})` : ''}`);
  }
  if (command === 'keep') {
    const missing = [...(a.one('--file') ? [] : ['--file']), ...missingFields({ kind: a.one('--kind'), what: a.one('--what') })];
    if (missing.length > 0) throw new StockError(`${missing.join(', ')} missing: sz-eyes image keep --file <picture> --kind "<kind>" --what "<one line: what is in the picture>" [--prompt "<the words it was made from>"] [--for <project>]`);
    const bytes = pictureFromFile(resolve(a.one('--file')!));
    const kept = keepPicture(dir, bytes, { kind: a.one('--kind')!, what: a.one('--what')!, prompt: a.one('--prompt'), for: a.one('--for'), madeBy: null });
    return done({ ...kept, picture: withPath(dir, kept.picture) }, renderKept(kept).join('\n'));
  }
  if (command === 'edit') {
    const id = theId(a, 'edit', EDIT_USAGE, ['--kind', '--what', '--prompt', '--json']);
    const edit: PictureEdit = {};
    for (const key of ['kind', 'what'] as const) {
      if (!a.has(`--${key}`)) continue;
      const given = a.one(`--${key}`) ?? '';
      if (refSlug(given) === '') throw new StockError(`--${key} "${given}" has no letter or digit in it`);
      edit[key] = oneLine(given);
    }
    if (a.has('--prompt')) edit.prompt = (a.one('--prompt') ?? '').trim() || null;
    if (Object.keys(edit).length === 0) throw new StockError(`what to change: ${EDIT_USAGE}`);
    const edited = editPicture(dir, id, edit);
    const { picture, changes } = edited;
    const value = { id, changes, picture: withPath(dir, picture), newKind: edited.newKind, emptied: edited.emptied };
    if (changes.length === 0) return done(value, `nothing changed: ${id} already says that`);
    const lines = [`edited: ${id}`, ...renderChanges(dir, changes)];
    if (edited.newKind) lines.push(edited.kindsBefore.length > 0 ? `"${picture.kind}" is a new kind. Kinds already kept: ${kindList(edited.kindsBefore)}. When it is the same kind of picture as one of them, give that name: sz-eyes image edit ${id} --kind "<that name>".` : `"${picture.kind}" is a new kind (the only one in the stock).`);
    if (edited.emptied !== null) lines.push(`"${edited.emptied}" holds no picture now, and is no longer listed.`);
    return done(value, lines.join('\n'));
  }
  if (command === 'remove') {
    const removed = removePicture(dir, theId(a, 'remove', 'sz-eyes image remove <id> [--json]', ['--json']));
    const { picture } = removed;
    const lines = [
      `removed from the stock: ${picture.id} (${removed.pictureDeleted ? 'its picture there is deleted' : 'its picture was not there'}: ${join(dir, picture.file)})`,
      `  kind      ${picture.kind}`,
      `  what      ${picture.what}`,
      `  size      ${picture.width}x${picture.height}`,
      ...(picture.madeBy ? [`  made by   ${picture.madeBy}`] : []),
      ...(picture.for ? [`  for       ${picture.for}`] : []),
      `  kept      ${picture.addedAt}`,
      ...(picture.prompt ? ['', picture.prompt] : ['', '(kept without the words it was made from)']),
      '',
      `A copy put in a project with sz-eyes image use is the project's own, and stays where it is. To keep it again: sz-eyes image keep --file <such a copy> --kind ${JSON.stringify(picture.kind)} --what ${JSON.stringify(picture.what)}${picture.prompt ? ` --prompt ${JSON.stringify(picture.prompt)}` : ''}`,
      ...(removed.left === 0 ? [`"${picture.kind}" holds no picture now, and is no longer listed.`] : []),
    ];
    return done({ removed: withPath(dir, picture), pictureDeleted: removed.pictureDeleted, left: removed.left }, lines.join('\n'));
  }
  const id = a.words[0];
  if (!id) throw new StockError('which picture: sz-eyes image show <id> (sz-eyes image find lists them)');
  const pictures = readStock(dir);
  const picture = pictures.find((one) => one.id === id);
  if (!picture) throw notKept(dir, id, pictures);
  const text = [
    picture.id,
    `  kind      ${picture.kind}`,
    `  what      ${picture.what}`,
    `  size      ${picture.width}x${picture.height}`,
    ...(picture.madeBy ? [`  made by   ${picture.madeBy}`] : []),
    ...(picture.for ? [`  for       ${picture.for}`] : []),
    `  picture   ${join(dir, picture.file)}`,
    `  sha256    ${picture.sha256}`,
    `  kept      ${picture.addedAt}`,
    ...(picture.prompt ? ['', picture.prompt] : ['', '(kept without the words it was made from)']),
  ].join('\n');
  return done(withPath(dir, picture), text);
}
