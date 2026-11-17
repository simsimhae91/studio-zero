import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, readSync, closeSync, renameSync, rmSync, rmdirSync, statSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { PICTURE_NAME, StockError, checkFields, checkWritable, keepPicture, missingFields, newKindLine, readStock, reminder, stockCommand, stockDir, type StockPicture } from './stock.ts';

/**
 * Pictures for a product's screens, made on the subscription the owner already pays for: the Codex CLI's own
 * image generation, run without a person at it and signed in with ChatGPT. Never through an API that bills for
 * each image (on 2026-11-17 four designer agents made 23 pictures with a tool that billed the owner's OpenAI key
 * for every one). The method is the one the owner's War Room has used since 2026-10-27, carried over with their
 * approval:
 *
 *   - codex is asked how it is signed in first (`codex login status`), and run only on "Logged in using ChatGPT";
 *   - every run carries `-c forced_login_method="chatgpt"`, so a key kept in codex's own auth.json is never billed;
 *   - every API key is taken out of the environment codex is given;
 *   - codex works in a temporary folder of its own and is told to copy the PNG it made there under the asked name;
 *   - the result is what is on disk (a PNG whose header says the asked size), never what the model says it did.
 *
 * Nothing here makes a picture any other way, and nothing falls back to anything else.
 */
export class ImageError extends Error {
  /** The session's command sandbox stopped it: says nothing about codex or the picture. */
  readonly sandboxed: boolean;
  constructor(message: string, sandboxed = false) {
    super(message);
    this.sandboxed = sandboxed;
  }
}

/** The sizes a picture can be made at (the War Room's list); 1024x1024 when none is asked. */
export const IMAGE_SIZES = ['1024x1024', '1600x900', '1200x630', '1080x1350', '1080x1920', '512x512'] as const;
/** What each size is for. */
export const IMAGE_SIZE_USES = 'hero 1600x900, square 1024x1024 (the default), OG 1200x630, share card 1080x1350, story 1080x1920, favicon or app icon 512x512';
/** The two rules every picture is made under: the same sentences the War Room's designer works by. */
export const ART_RULES = [
  'No text inside the image (Korean lettering comes out wrong): leave room for the words, which are set in HTML.',
  "Originals only: no trademarked characters, logos, other products' mascots or a living artist's signature style.",
] as const;
/** Where pictures go in a project when no folder is given. */
export const IMAGE_ASSETS_DIR = join('.sz', 'design', 'assets');
/** One picture takes one to three minutes; a run is stopped at five. */
export const IMAGE_TIMEOUT_MS = 300_000;
const LOGIN_TIMEOUT_MS = 10_000;
const MAX_PROMPT = 4000;
/** The end of codex's output is kept: its last words are there. */
const OUTPUT_LIMIT = 60_000;

/**
 * The switch that makes codex take the ChatGPT login or refuse. Never given to `codex login status`: with it, an
 * API key login reads "Not logged in" and the reason is lost. And never given to a run over an API key login:
 * codex then signs out and deletes ~/.codex/auth.json (measured in the War Room), so the login is asked first.
 */
export const CODEX_FORCED = ['-c', 'forced_login_method="chatgpt"'] as const;
/** What codex says when the ChatGPT login is missing. */
const CODEX_LOGIN_RE = /not logged in|chatgpt login is required/i;

/** `$SZ_CODEX_BIN`, or `codex` on the PATH. */
export const codexBin = (env: NodeJS.ProcessEnv = process.env): string => env.SZ_CODEX_BIN || 'codex';
/** Where codex keeps its login and what it makes: `$CODEX_HOME`, or ~/.codex. */
export const codexHome = (env: NodeJS.ProcessEnv = process.env): string => (env.CODEX_HOME ? resolve(env.CODEX_HOME) : join(env.HOME || homedir(), '.codex'));

// Credentials, by the words of their names: codex needs none of them (it signs in on its own), and an API key in
// its environment is a login that `codex login status` never shows. A count of tokens is a setting, not a key.
const CREDENTIAL = [
  /(^|_)(KEYS?|APIKEYS?|TOKENS?|SECRETS?|PASSWORD|PASSWD|PASSPHRASE|CREDENTIALS?)(_|$)/i,
  /^(\w+_)?DATABASE_URL$/,
  /^(PGPASSWORD|MYSQL_PWD|REDIS_URL|MONGO(DB)?_UR[IL])$/,
];
const TOKEN_COUNT = /(^|_)MAX_(\w+_)?TOKENS$/;

/** The environment codex is given: this one without any API key or other credential. */
export function withoutKeys(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(env).filter(([name]) => TOKEN_COUNT.test(name) || !CREDENTIAL.some((re) => re.test(name))));
}

export interface ImageSpec {
  prompt: string;
  name: string;
  width: number;
  height: number;
}

/** What a call asks, checked before codex is asked anything. */
export function imageSpec(ask: { prompt?: string | undefined; name?: string | undefined; size?: string | undefined }): ImageSpec {
  const prompt = (ask.prompt ?? '').trim();
  if (prompt === '') throw new ImageError('--prompt "<what it shows and what it is for>" is missing');
  if (prompt.length > MAX_PROMPT) throw new ImageError(`--prompt is ${prompt.length} characters; ${MAX_PROMPT} at most`);
  const name = (ask.name ?? '').trim().replace(/\.png$/i, '');
  if (name === '') throw new ImageError('--name <name> is missing: the picture is written as <name>.png');
  if (!PICTURE_NAME.test(name)) throw new ImageError(`--name ${name}: lower-case letters, digits and dashes, 61 at most (the picture is written as <name>.png)`);
  const size = (ask.size ?? '1024x1024').trim().toLowerCase().replace('×', 'x');
  if (!(IMAGE_SIZES as readonly string[]).includes(size)) throw new ImageError(`--size ${ask.size}: one of ${IMAGE_SIZES.join(', ')} (${IMAGE_SIZE_USES})`);
  const [width, height] = size.split('x').map(Number) as [number, number];
  return { prompt, name, width, height };
}

/** What codex is told: one original picture, the two rules, where to leave it, and to answer with its path only. */
export function imageBrief(spec: ImageSpec, home: string): string {
  const { name, width, height } = spec;
  return [
    `Generate ONE original image, ${width}x${height} pixels: ${spec.prompt}`,
    `Rules: ${ART_RULES.join(' ')}`,
    "Make it with codex's own image generation only: do not call any MCP tool, connector or API for it.",
    `When it is generated, copy the PNG file codex wrote (under ${join(home, 'generated_images')}/) into the current working directory as ${name}.png, then make it exactly ${width}x${height} (sips -z ${height} ${width} ${name}.png on macOS). Do not create any other file.`,
    `Reply with only the absolute path of ${name}.png.`,
  ].join('\n');
}

/** A PNG's width and height from its header, or null for anything that is not a PNG. */
export function pngSize(file: string): [number, number] | null {
  try {
    const fd = openSync(file, 'r');
    try {
      const head = Buffer.alloc(24);
      if (readSync(fd, head, 0, 24, 0) < 24 || head.toString('latin1', 1, 4) !== 'PNG' || head.toString('latin1', 12, 16) !== 'IHDR') return null;
      return [head.readUInt32BE(16), head.readUInt32BE(20)];
    } finally {
      closeSync(fd);
    }
  } catch {
    return null;
  }
}

export type LoginMethod = 'chatgpt' | 'apikey' | 'none' | 'missing' | 'unknown';

/** What `codex login status` printed (it prints on stderr) → how codex is signed in. */
export function readLoginStatus(text: string, code: number | null): LoginMethod {
  if (/logged in using chatgpt/i.test(text) && code === 0) return 'chatgpt';
  if (/logged in using an api key/i.test(text)) return 'apikey';
  if (/not logged in/i.test(text)) return 'none';
  return 'unknown';
}

/**
 * How codex is signed in, asked fresh before every run (a `codex login` between two calls counts from the next).
 * Asked of codex itself, not read from auth.json: codex may keep its login in the keychain. Anything but a clear
 * "Logged in using ChatGPT" is not ChatGPT: the forced flag never meets a login it was not shown.
 */
export function codexLogin(bin: string, env: NodeJS.ProcessEnv): Promise<{ method: LoginMethod; text: string }> {
  return new Promise((done) => {
    let out = '';
    let settled = false;
    let child: ChildProcess | undefined;
    const finish = (result: { method: LoginMethod; text: string }): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (child && child.exitCode === null) child.kill('SIGKILL');
      done(result);
    };
    const timer = setTimeout(() => finish({ method: 'unknown', text: `codex login status gave no answer in ${LOGIN_TIMEOUT_MS / 1000}s` }), LOGIN_TIMEOUT_MS);
    const failed = (err: NodeJS.ErrnoException): void => finish({ method: err.code === 'ENOENT' ? 'missing' : 'unknown', text: err.message });
    try {
      child = spawn(bin, ['login', 'status'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      failed(err as NodeJS.ErrnoException);
      return;
    }
    const add = (chunk: Buffer): void => {
      if (out.length < 4000) out += chunk.toString('utf8');
    };
    child.stdout!.on('data', add);
    child.stderr!.on('data', add);
    child.once('error', failed);
    child.once('close', (code) => finish({ method: readLoginStatus(out, code), text: out.trim() }));
  });
}

/** Why no picture was made when codex is not signed in with ChatGPT, and what the owner does about it. */
export function loginRefusal(bin: string, login: { method: LoginMethod; text: string }): string {
  const signIn = 'The owner signs in with `codex login` and chooses ChatGPT (the subscription they pay for), then this can be run again.';
  switch (login.method) {
    case 'missing':
      return `the Codex CLI is not installed here (there is no \`${bin}\` to run): no image was made. Pictures are made only through it, on the owner's ChatGPT subscription: install it (npm install -g @openai/codex), then \`codex login\` with ChatGPT.`;
    case 'none':
      return `codex is not signed in: no image was made. ${signIn}`;
    case 'apikey':
      return `codex is signed in with an API key, which bills for each image: no image was made, and codex was not started, so its login is left as it is. ${signIn}`;
    default:
      return `how codex is signed in could not be told (\`codex login status\` said: ${JSON.stringify(login.text.replace(/\s+/g, ' ').trim().slice(0, 200))}): no image was made. Pictures are made only on the ChatGPT login: the owner looks at \`codex login status\` and, if it is not ChatGPT, signs in with \`codex login\` and chooses ChatGPT.`;
  }
}

/**
 * What codex last said, from its --json stream: the error it ended on (its own limit reached, a refusal) when the
 * turn failed, else the model's last message, else the end of whatever it printed that was not an event.
 */
export function codexWords(out: string): string {
  let failed = '';
  let error = '';
  let said = '';
  let completed = false;
  const loose: string[] = [];
  for (const line of out.split('\n')) {
    if (line.trim() === '') continue;
    let event: { type?: unknown; message?: unknown; error?: { message?: unknown }; item?: { type?: unknown; text?: unknown } } | null = null;
    try {
      const parsed: unknown = JSON.parse(line);
      if (typeof parsed === 'object' && parsed !== null) event = parsed;
    } catch {
      // Not an event: codex's own words on stderr.
    }
    if (!event) loose.push(line);
    else if (event.type === 'turn.failed') failed = String(event.error?.message ?? 'the turn failed');
    else if (event.type === 'error') error = String(event.message ?? '');
    else if (event.type === 'turn.completed') completed = true;
    else if (event.type === 'item.completed' && event.item?.type === 'agent_message' && String(event.item.text ?? '').trim() !== '') said = String(event.item.text);
  }
  return (failed || (!completed && error) || said || loose.join('\n').slice(-600)).trim();
}

interface Ran {
  code: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  out: string;
}

/** What ends each codex run still going in this process, and removes what it left. */
const running = new Set<() => void>();
const STOPS: NodeJS.Signals[] = ['SIGINT', 'SIGTERM', 'SIGHUP'];
/** This process told to stop: every run it started is ended first, then it exits as told. */
const stopAll = (signal: NodeJS.Signals): void => {
  for (const end of running) end();
  process.exit(signal === 'SIGINT' ? 130 : 143);
};

/**
 * One codex run, in a process group of its own so that the time limit ends everything it started. When this
 * process is told to stop (a background task ended, ctrl-c), codex is ended with it rather than left running on
 * the owner's subscription; `cleanup` then runs, and this process exits.
 */
function runCodex(bin: string, argv: string[], { cwd, input, env, timeoutMs, cleanup }: { cwd: string; input: string; env: NodeJS.ProcessEnv; timeoutMs: number; cleanup: () => void }): Promise<Ran> {
  return new Promise((done) => {
    let out = '';
    let settled = false;
    let child: ChildProcess;
    const killTree = (): void => {
      try {
        process.kill(-child.pid!, 'SIGKILL');
      } catch {
        try {
          child.kill('SIGKILL');
        } catch {
          // Gone already.
        }
      }
    };
    const end = (): void => {
      killTree();
      cleanup();
    };
    const finish = (ran: Omit<Ran, 'out'>): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      running.delete(end);
      if (running.size === 0) for (const signal of STOPS) process.off(signal, stopAll);
      killTree();
      done({ ...ran, out });
    };
    try {
      child = spawn(bin, argv, { cwd, env, detached: true, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (err) {
      out = (err as Error).message;
      done({ code: null, signal: null, timedOut: false, out });
      return;
    }
    if (running.size === 0) for (const signal of STOPS) process.on(signal, stopAll);
    running.add(end);
    const timer = setTimeout(() => finish({ code: null, signal: null, timedOut: true }), timeoutMs);
    // Decoded per stream: a Korean character split across two chunks stays one character.
    child.stdout!.setEncoding('utf8');
    child.stderr!.setEncoding('utf8');
    const add = (chunk: string): void => {
      out += chunk;
      if (out.length > OUTPUT_LIMIT) out = out.slice(-OUTPUT_LIMIT);
    };
    child.stdout!.on('data', add);
    child.stderr!.on('data', add);
    child.once('error', (err) => {
      out += err.message;
      finish({ code: null, signal: null, timedOut: false });
    });
    child.once('close', (code, signal) => finish({ code, signal, timedOut: false }));
    child.stdin!.on('error', () => {});
    child.stdin!.end(input);
  });
}

export interface MadeImage {
  path: string;
  size: string;
  width: number;
  height: number;
  bytes: number;
  seconds: number;
  /** A picture an earlier call left under the same name was replaced by this one. */
  replaced: boolean;
}

const timeLimit = (env: NodeJS.ProcessEnv): number => {
  const given = Number(env.SZ_IMAGE_TIMEOUT_MS);
  return Number.isInteger(given) && given > 0 ? given : IMAGE_TIMEOUT_MS;
};

/**
 * One picture: codex makes it in a folder of its own, and it is moved to `<out>/<name>.png` only when a PNG of
 * exactly the asked size is there. Several calls may run at once: each has its own folder. A file an earlier call
 * left under the same name is never taken for this call's, and is left as it was when this call fails.
 */
export async function makeImage(ask: { prompt?: string | undefined; name?: string | undefined; size?: string | undefined; out: string }, env: NodeJS.ProcessEnv = process.env): Promise<MadeImage> {
  const spec = imageSpec(ask);
  const bin = codexBin(env);
  const runEnv = withoutKeys(env);
  const target = join(ask.out, `${spec.name}.png`);
  const earlier = (): string => (existsSync(target) ? ` (the ${spec.name}.png already in ${ask.out} is an earlier one, and was left as it was)` : '');

  const login = await codexLogin(bin, runEnv);
  if (login.method !== 'chatgpt') throw new ImageError(loginRefusal(bin, login));

  // codex keeps what it makes in its own home. Where that cannot be written (the session's command sandbox lets a
  // command write only in its project and its temporary folder), a run would spend the subscription on a picture
  // that cannot be saved: so it is not started.
  const home = codexHome(runEnv);
  try {
    rmdirSync(mkdtempSync(join(home, '.sz-image-')));
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT') {
      const sandboxed = code === 'EPERM';
      throw new ImageError(
        `codex keeps what it makes in ${home}, and this command cannot write there (${code ?? (err as Error).message}): no image was made, and codex was not started. ${sandboxed ? 'Run it outside the session\'s command sandbox (dangerouslyDisableSandbox: true on the Bash call).' : `When it runs inside the session's command sandbox, run it outside (dangerouslyDisableSandbox: true on the Bash call); otherwise ${home} has to be writable by this user.`}`,
        sandboxed,
      );
    }
  }

  mkdirSync(ask.out, { recursive: true });
  const work = mkdtempSync(join(tmpdir(), 'sz-image-'));
  const cleanup = (): void => rmSync(work, { recursive: true, force: true });
  const made = join(work, `${spec.name}.png`);
  const started = Date.now();
  const limit = timeLimit(env);
  let ran: Ran;
  let size: [number, number] | null;
  let there: boolean;
  try {
    ran = await runCodex(bin, [...CODEX_FORCED, 'exec', '--json', '--skip-git-repo-check', '--enable', 'image_generation', '-s', 'workspace-write', '-C', work, '-'], { cwd: work, input: imageBrief(spec, home), env: runEnv, timeoutMs: limit, cleanup });
    there = existsSync(made);
    size = pngSize(made);
    if (size && size[0] === spec.width && size[1] === spec.height) {
      const replaced = existsSync(target);
      // Copied next to its place, then renamed into it: the name is never half-written, whatever runs beside it.
      const part = join(ask.out, `.${spec.name}.png.${process.pid}-${randomBytes(4).toString('hex')}.part`);
      try {
        copyFileSync(made, part);
        renameSync(part, target);
      } catch (err) {
        rmSync(part, { force: true });
        throw err;
      }
      return { path: target, size: `${spec.width}x${spec.height}`, width: spec.width, height: spec.height, bytes: statSync(target).size, seconds: Math.round((Date.now() - started) / 1000), replaced };
    }
  } finally {
    cleanup();
  }
  const seconds = Math.round((Date.now() - started) / 1000);
  const words = codexWords(ran.out);
  const said = words ? ` codex said:\n${words}` : '';
  const loginHint = CODEX_LOGIN_RE.test(ran.out) ? '\nPictures are made only on the ChatGPT login: the owner signs in with `codex login` and chooses ChatGPT.' : '';
  if (ran.timedOut) throw new ImageError(`codex did not finish within ${Math.round(limit / 1000)}s and was stopped: no image was made${earlier()}.${said}`);
  if (ran.code !== 0) throw new ImageError(`codex ended without a picture (${ran.code === null ? (ran.signal ?? 'no exit code') : `exit ${ran.code}`}, ${seconds}s): no image was made${earlier()}.${said}${loginHint}`);
  if (!there) throw new ImageError(`no ${spec.name}.png came back from codex (${seconds}s): no image was made${earlier()}. What it says it did does not count; only the file does.${said}`);
  if (!size) throw new ImageError(`what codex left as ${spec.name}.png is not a PNG (${seconds}s): no image was made${earlier()}.${said}`);
  throw new ImageError(`codex brought back a picture of ${size[0]}x${size[1]}, not the ${spec.width}x${spec.height} asked (${seconds}s): no image was made${earlier()}.${said}`);
}

/** The command line as cli.ts parses it: bare words, and `--flag value` pairs (every flag given, by name). */
export interface ImageArgs {
  words: string[];
  has: (flag: string) => boolean;
  one: (flag: string) => string | undefined;
  flags?: ReadonlyMap<string, unknown>;
}

const MAKE_USAGE = 'sz-eyes image make --prompt "<what it shows and what it is for>" --name <name> --kind "<face, food, object, place, ...>" --what "<one line: what is in the picture>" [--size <WxH>] [--out <folder>] [--no-stock] (sz-eyes help)';

/** What became of the stock's copy of a picture made. */
export type StockOutcome =
  | { status: 'kept' | 'already kept'; id: string; path: string; newKind: boolean }
  | { status: 'left out' }
  | { status: 'not kept'; error: string };

/**
 * `image make`: what the call asks is checked whole before codex is asked anything, the caller is told what the
 * stock already holds of the kind (and the work goes on), and the picture made is kept in the stock with its prompt
 * unless --no-stock. Where the stock cannot be written, codex is not started: the picture could not be kept.
 */
async function makeCommand(a: ImageArgs, { project, out, dir }: { project: string; out: string; dir: string }, env: NodeJS.ProcessEnv, say: (line: string) => void): Promise<{ text: string; code: number }> {
  const keep = !a.has('--no-stock');
  const missing = [...(['--prompt', '--name'] as const).filter((flag) => (a.one(flag) ?? '').trim() === ''), ...missingFields({ kind: a.one('--kind'), what: a.one('--what') })];
  if (missing.length > 0) throw new ImageError(`${missing.join(', ')} missing: ${MAKE_USAGE}`);
  const ask = { prompt: a.one('--prompt'), name: a.one('--name'), size: a.one('--size'), out };
  const spec = imageSpec(ask);
  const fields = checkFields({ kind: a.one('--kind')!, what: a.one('--what')!, prompt: spec.prompt, for: basename(project) });
  let held: StockPicture[] = [];
  try {
    held = readStock(dir);
  } catch (err) {
    if (keep) throw new ImageError(`${(err as Error).message}. No image was made, and codex was not started: the picture could not be kept (--no-stock makes one that is not kept)`);
  }
  if (keep) checkWritable(dir, 'no image was made, and codex was not started, since the picture could not be kept (--no-stock makes one that is not kept)');
  const told = reminder(held, fields.kind);
  if (told) say(told);

  const made = await makeImage(ask, env);
  let stock: StockOutcome = { status: 'left out' };
  const lines = [made.path, `${made.size}, ${Math.round(made.bytes / 1024)} KB, made in ${made.seconds}s${made.replaced ? ` (it replaces the earlier ${basename(made.path)})` : ''}`];
  if (!keep) lines.push('not kept in the stock (--no-stock)');
  else {
    try {
      const kept = keepPicture(dir, readFileSync(made.path), { kind: fields.kind, what: fields.what, prompt: fields.prompt ?? undefined, for: fields.for ?? undefined, madeBy: 'codex' });
      stock = { status: kept.status, id: kept.picture.id, path: kept.path, newKind: kept.newKind };
      lines.push(`${kept.status === 'kept' ? 'kept in the stock' : 'already in the stock'}: ${kept.picture.id} (${kept.path})`, ...newKindLine(kept));
    } catch (err) {
      // The picture is made and in place: what failed is only its copy, and the command that keeps it is given.
      const error = err instanceof Error ? err.message : String(err);
      stock = { status: 'not kept', error };
      lines.push(`not kept in the stock: ${error}. The picture is made and in place; keep it with sz-eyes image keep --file ${JSON.stringify(made.path)} --kind ${JSON.stringify(fields.kind)} --what ${JSON.stringify(fields.what)} --prompt <the same prompt>`);
    }
  }
  if (a.has('--json')) return { text: JSON.stringify({ ...made, stock }, null, 2), code: 0 };
  return { text: lines.join('\n'), code: 0 };
}

/**
 * `sz-eyes image <command>`: what to print and the exit code. A refusal is thrown as an ImageError. `say` prints
 * what is to be read while the command is still working (before codex starts); stdout keeps the result alone.
 */
export async function imageCommand(command: string | undefined, a: ImageArgs, env: NodeJS.ProcessEnv = process.env, say: (line: string) => void = (line) => void process.stderr.write(`${line}\n`)): Promise<{ text: string; code: number }> {
  const project = resolve(a.one('--dir') ?? '.');
  const out = a.one('--out') ? resolve(a.one('--out')!) : join(project, IMAGE_ASSETS_DIR);
  const dir = stockDir(env);
  try {
    if (command === 'make') return await makeCommand(a, { project, out, dir }, env, say);
    if (command === 'find' || command === 'use' || command === 'keep' || command === 'show' || command === 'edit' || command === 'remove') return stockCommand(command, a, { dir, out });
  } catch (err) {
    if (err instanceof StockError) throw new ImageError(err.message, err.sandboxed);
    throw err;
  }
  throw new ImageError('sz-eyes image make|find|use|keep|show|edit|remove (sz-eyes help)');
}
