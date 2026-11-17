// Pictures for a product's screens are made on the subscription the owner already pays for: the Codex CLI's own
// image generation, signed in with ChatGPT. Never through an API that bills for each image. Run through the real
// command line against a fake `codex` (SZ_CODEX_BIN) that behaves as each test asks: no real image is ever made.
// Every picture made is kept in the owner's stock, here a folder of each test's own (SZ_STOCK_DIR).
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { crc32, deflateSync } from 'node:zlib';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const CLI = join(HERE, '../src/cli.ts');
const HOOK = join(HERE, '../../../plugin/hooks/guard-paid-image.mjs');

/** A whole PNG of that size: one grey channel, every pixel black, and `extra` bytes after its end to make it its own. */
function png(width: number, height: number, extra = ''): Buffer {
  const chunk = (type: string, data: Buffer): Buffer => {
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bits per sample; colour type 0 (grey), the rest 0
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([signature, chunk('IHDR', header), chunk('IDAT', deflateSync(Buffer.alloc((width + 1) * height))), chunk('IEND', Buffer.alloc(0)), Buffer.from(extra)]);
}
const sizeOf = (bytes: Buffer): string => `${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}`;

const LIMIT = "You've hit your usage limit. Upgrade to Pro (https://chatgpt.com/explore/pro), or try again in 2 days 4 hours.";
type Mode = 'ok' | 'apikey' | 'none' | 'nothing' | 'wrong' | 'hang' | 'limit';

/**
 * A fake codex: `login status` answers as the mode says, and `exec` reads the brief on stdin and does what the
 * mode says with it (writes the asked PNG into the folder it is given, as real codex is told to, or not). Every
 * call is written down: its arguments, its folder, the names in its environment and what came on stdin.
 */
function fakeCodex(root: string, mode: Mode, delayMs = 0): { bin: string; calls: () => { args: string[]; cwd: string; env: string[]; input: string }[]; pid: string } {
  const pictures = join(root, 'pictures');
  mkdirSync(pictures, { recursive: true });
  for (const [w, h] of [[1024, 1024], [1600, 900], [512, 512]] as const) writeFileSync(join(pictures, `${w}x${h}.png`), png(w, h, `new ${mode}`));
  const record = join(root, 'calls.jsonl');
  const pid = join(root, 'codex.pid');
  const bin = join(root, 'codex.mjs');
  writeFileSync(
    bin,
    `#!${process.execPath}
import { appendFileSync, copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const MODE = ${JSON.stringify(mode)};
const args = process.argv.slice(2);
if (MODE === 'hang' && args.includes('exec')) writeFileSync(${JSON.stringify(pid)}, String(process.pid));
let input = '';
if (args.at(-1) === '-') for await (const chunk of process.stdin) input += chunk;
appendFileSync(${JSON.stringify(record)}, JSON.stringify({ args, cwd: process.cwd(), env: Object.keys(process.env), input }) + '\\n');
if (args[0] === 'login') {
  if (MODE === 'apikey') { process.stderr.write('Logged in using an API key - sk-proj-***ABCD\\n'); process.exit(0); }
  if (MODE === 'none') { process.stderr.write('Not logged in\\n'); process.exit(1); }
  process.stderr.write('Logged in using ChatGPT\\n');
  process.exit(0);
}
const say = (event) => process.stdout.write(JSON.stringify(event) + '\\n');
say({ type: 'thread.started', thread_id: 'thread-1' });
say({ type: 'turn.started' });
if (MODE === 'hang') {
  setInterval(() => {}, 1000);
  await new Promise(() => {});
}
if (MODE === 'limit') {
  say({ type: 'error', message: ${JSON.stringify(LIMIT)} });
  say({ type: 'turn.failed', error: { message: ${JSON.stringify(LIMIT)} } });
  process.exit(1);
}
await new Promise((done) => setTimeout(done, ${delayMs}));
const name = /working directory as (\\S+\\.png)/.exec(input)[1];
const [, w, h] = /exactly (\\d+)x(\\d+)/.exec(input);
const folder = args[args.indexOf('-C') + 1];
if (MODE === 'ok' || MODE === 'wrong') {
  const made = join(${JSON.stringify(pictures)}, MODE === 'ok' ? w + 'x' + h + '.png' : (w === '512' ? '1024x1024.png' : '512x512.png'));
  const generated = join(process.env.CODEX_HOME, 'generated_images', 'thread-1');
  mkdirSync(generated, { recursive: true });
  copyFileSync(made, join(generated, 'ig_1.png'));
  copyFileSync(made, join(folder, name));
}
// In every mode the model says it is done: the words are not what counts.
say({ type: 'item.completed', item: { id: 'item_1', type: 'agent_message', text: join(folder, name) } });
say({ type: 'turn.completed', usage: { input_tokens: 10, output_tokens: 5 } });
`,
  );
  chmodSync(bin, 0o755);
  return {
    bin,
    calls: () => (existsSync(record) ? readFileSync(record, 'utf8').trim().split('\n').map((line) => JSON.parse(line)) : []),
    pid,
  };
}

type Ran = { code: number | null; out: string; text: string };
interface Place {
  root: string;
  project: string;
  assets: string;
  tmp: string;
  codexHome: string;
  /** The owner's stock of pictures, for this test: not made until something is kept. */
  stock: string;
  done: () => void;
}
/** A project, the folder its pictures go to, codex's own home, a stock and a temporary folder, all the test's own. */
function place(): Place {
  const root = mkdtempSync(join(tmpdir(), 'sz-image-test-'));
  const project = join(root, 'project');
  const assets = join(project, '.sz', 'design', 'assets');
  const tmp = join(root, 'tmp');
  const codexHome = join(root, 'codex-home');
  for (const dir of [project, tmp, codexHome]) mkdirSync(dir, { recursive: true });
  return { root, project, assets, tmp, codexHome, stock: join(root, 'stock'), done: () => rmSync(root, { recursive: true, force: true }) };
}

/** `sz-eyes image ...` as its own process, with API keys set in the environment it is started with. */
const image = (p: Place, bin: string, args: string[], env: Record<string, string> = {}): Promise<Ran> =>
  new Promise((done) => {
    const child = spawn(process.execPath, [CLI, 'image', ...args], {
      cwd: p.project,
      env: { ...process.env, SZ_CODEX_BIN: bin, CODEX_HOME: p.codexHome, TMPDIR: p.tmp, SZ_STOCK_DIR: p.stock, OPENAI_API_KEY: 'sk-proj-test', CODEX_API_KEY: 'sk-codex-test', ANTHROPIC_API_KEY: 'sk-ant-test', ...env },
    });
    let out = '';
    let err = '';
    child.stdout.on('data', (chunk) => (out += chunk));
    child.stderr.on('data', (chunk) => (err += chunk));
    child.once('close', (code) => done({ code, out, text: `${out}${err}` }));
  });

const PROMPT = '한강 둔치의 저녁, 자전거를 세워 두고 쉬는 사람들, 따뜻한 역광: 산책 기록 앱 첫 화면의 큰 사진';
/** What every make says about its picture for the stock: what kind of picture, and what is in it. */
const KEPT_AS = ['--kind', 'place', '--what', 'riverside park at dusk, bicycles resting'];
/** A picture an earlier call left under the same name: a whole PNG of the asked size. */
const earlier = (p: Place, name: string, width = 1024, height = 1024): Buffer => {
  mkdirSync(p.assets, { recursive: true });
  const bytes = png(width, height, 'from an earlier call');
  writeFileSync(join(p.assets, `${name}.png`), bytes);
  return bytes;
};
const noKeys = (calls: { env: string[] }[]): void => {
  for (const call of calls) assert.deepEqual(call.env.filter((name) => /_API_KEY$/.test(name)), [], 'codex is never given an API key');
};
/** Nothing of a call is left in the temporary folder. */
const tidy = (p: Place): void => assert.deepEqual(readdirSync(p.tmp), []);

/** The stock's index, a line an entry. */
const stockLines = (p: Place): Record<string, unknown>[] =>
  existsSync(join(p.stock, 'index.jsonl'))
    ? readFileSync(join(p.stock, 'index.jsonl'), 'utf8')
        .split('\n')
        .filter((line) => line.trim() !== '')
        .map((line) => JSON.parse(line) as Record<string, unknown>)
    : [];
/** Every picture file in the stock, from its pictures folder. */
const stockFiles = (p: Place): string[] => (existsSync(join(p.stock, 'pictures')) ? readdirSync(join(p.stock, 'pictures'), { recursive: true, encoding: 'utf8' }).filter((name) => /\.\w+$/.test(name)) : []);
const sha = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');
/** Where a stock command would find codex if it ever asked for it: nowhere. */
const NO_CODEX = '/nonexistent/codex';

/** The head of a JPEG of that size: enough for what is read from it (its kind and its size), never decoded. */
const jpeg = (width: number, height: number): Buffer =>
  Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 255, width >> 8, width & 255, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01, 0xff, 0xd9]);
/** The head of an extended WebP of that size. */
const webp = (width: number, height: number): Buffer => {
  const bytes = Buffer.alloc(30);
  bytes.write('RIFF', 0, 'latin1');
  bytes.writeUInt32LE(22, 4);
  bytes.write('WEBPVP8X', 8, 'latin1');
  bytes.writeUInt32LE(10, 16);
  bytes.writeUIntLE(width - 1, 24, 3);
  bytes.writeUIntLE(height - 1, 27, 3);
  return bytes;
};

/** A picture brought into the stock with `image keep`, from a file of the test's own. */
const keep = (p: Place, bytes: Buffer, kind: string, what: string, more: string[] = []): Promise<Ran> => {
  const file = join(p.root, `in-${sha(bytes).slice(0, 12)}.bin`);
  writeFileSync(file, bytes);
  return image(p, NO_CODEX, ['keep', '--file', file, '--kind', kind, '--what', what, ...more]);
};

test('one picture is made on the ChatGPT login, checked on disk, and put in place at the size asked', async () => {
  const p = place();
  try {
    const codex = fakeCodex(p.root, 'ok');
    const old = earlier(p, 'hero', 1600, 900);
    const run = await image(p, codex.bin, ['make', '--prompt', PROMPT, '--name', 'hero', '--size', '1600x900', ...KEPT_AS]);
    assert.equal(run.code, 0, run.text);
    const file = join(p.assets, 'hero.png');
    assert.match(run.out, new RegExp(file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.match(run.out, /1600x900/);
    assert.match(run.out, /\d+s\b/);
    const made = readFileSync(file);
    assert.equal(sizeOf(made), '1600x900');
    assert.notDeepEqual(made, old, 'the new picture replaced the earlier one');
    assert.deepEqual(readdirSync(p.assets), ['hero.png'], 'nothing else is left beside it');
    tidy(p);

    const [status, exec] = codex.calls();
    assert.deepEqual(status!.args, ['login', 'status'], 'how codex is signed in is asked first, without the forced flag');
    assert.deepEqual(exec!.args.slice(0, 3), ['-c', 'forced_login_method="chatgpt"', 'exec']);
    assert.ok(exec!.args.join(' ').includes('--enable image_generation'), exec!.args.join(' '));
    const folder = exec!.args[exec!.args.indexOf('-C') + 1]!;
    assert.ok(folder.startsWith(p.tmp), `codex works in a temporary folder of its own: ${folder}`);
    assert.ok(!existsSync(folder), 'and the folder is gone after');
    assert.equal(exec!.cwd.replace(/^\/private/, ''), folder.replace(/^\/private/, ''));
    for (const words of [PROMPT, '1600x900', 'hero.png', 'Korean', 'HTML', 'Originals only', 'mascots', 'living artist', 'Reply with only']) assert.ok(exec!.input.includes(words), `the brief says ${words}:\n${exec!.input}`);
    assert.ok(exec!.input.includes(join(p.codexHome, 'generated_images')), 'the brief says where codex keeps what it makes');
    noKeys(codex.calls());

    // --json gives the same as an object; --out puts it elsewhere; the default size is 1024x1024.
    const out = join(p.root, 'elsewhere');
    const json = await image(p, codex.bin, ['make', '--prompt', PROMPT, '--name', 'square-1', '--out', out, '--json', ...KEPT_AS]);
    assert.equal(json.code, 0, json.text);
    const said = JSON.parse(json.out);
    assert.equal(said.path, join(out, 'square-1.png'));
    assert.equal(said.size, '1024x1024');
    assert.equal(said.width, 1024);
    assert.equal(said.height, 1024);
    assert.equal(typeof said.seconds, 'number');
    assert.equal(sizeOf(readFileSync(said.path)), '1024x1024');
    noKeys(codex.calls());
  } finally {
    p.done();
  }
});

test('codex not signed in with ChatGPT, or not there at all: nothing is made, codex is not run, and the owner is told what to do', async () => {
  const p = place();
  try {
    for (const [mode, says] of [
      ['apikey', /signed in with an API key/],
      ['none', /not signed in/],
    ] as const) {
      const codex = fakeCodex(join(p.root, mode), mode);
      const old = earlier(p, 'hero');
      const run = await image(p, codex.bin, ['make', '--prompt', PROMPT, '--name', 'hero', ...KEPT_AS]);
      assert.equal(run.code, 1, run.text);
      assert.match(run.text, says);
      assert.match(run.text, /`codex login`/);
      assert.match(run.text, /ChatGPT/);
      assert.match(run.text, /no image was made/);
      assert.deepEqual(codex.calls().map((call) => call.args.join(' ')), ['login status'], 'nothing but the question was asked of codex');
      noKeys(codex.calls());
      assert.deepEqual(readFileSync(join(p.assets, 'hero.png')), old);
      assert.deepEqual(readdirSync(p.assets), ['hero.png']);
      assert.deepEqual(stockLines(p), []);
    }
    const missing = await image(p, join(p.root, 'no-such-codex'), ['make', '--prompt', PROMPT, '--name', 'hero', ...KEPT_AS]);
    assert.equal(missing.code, 1, missing.text);
    assert.match(missing.text, /not installed/);
    assert.match(missing.text, /`codex login`/);
    assert.match(missing.text, /no image was made/);
    tidy(p);
  } finally {
    p.done();
  }
});

test('what the call asks is checked before codex is asked anything', async () => {
  const p = place();
  try {
    const codex = fakeCodex(p.root, 'ok');
    for (const [args, says] of [
      [['make', '--name', 'hero', ...KEPT_AS], /--prompt missing/],
      [['make', '--prompt', PROMPT, ...KEPT_AS], /--name missing/],
      [['make', '--prompt', PROMPT, '--name', 'Hero Image', ...KEPT_AS], /lower-case letters, digits and dashes/],
      [['make', '--prompt', PROMPT, '--name', 'hero', '--size', '800x600', ...KEPT_AS], /1024x1024.*1600x900/],
      // The stock is told what kind of picture it is and what is in it, every time: without them nothing starts.
      [['make', '--prompt', PROMPT, '--name', 'hero', '--what', 'riverside park at dusk'], /--kind missing/],
      [['make', '--prompt', PROMPT, '--name', 'hero', '--kind', 'place'], /--what missing/],
      [['make', '--prompt', PROMPT, '--name', 'hero'], /--kind, --what missing/],
      [['make', '--prompt', PROMPT, '--name', 'hero', '--kind', 'place', '--what', '   '], /--what missing/],
      [['make', '--prompt', PROMPT, '--name', 'hero', '--kind', '!!!', '--what', 'riverside park'], /--kind "!!!" has no letter or digit/],
      [['make', '--prompt', PROMPT, '--name', 'hero', '--no-stock'], /--kind, --what missing/],
    ] as const) {
      const run = await image(p, codex.bin, [...args]);
      assert.equal(run.code, 1, run.text);
      assert.match(run.text, says);
    }
    assert.deepEqual(codex.calls(), [], 'codex was not even asked how it is signed in');
    assert.ok(!existsSync(p.assets));
    assert.ok(!existsSync(p.stock), 'nothing was kept');
  } finally {
    p.done();
  }
});

test('the result is what is on disk: no file, or a picture of another size, is nothing made, and an earlier one is left as it was', async () => {
  const p = place();
  try {
    for (const [mode, says] of [
      ['nothing', /no hero\.png came back/],
      ['wrong', /512x512, not the 1024x1024 asked/],
    ] as const) {
      const codex = fakeCodex(join(p.root, mode), mode);
      const old = earlier(p, 'hero');
      const run = await image(p, codex.bin, ['make', '--prompt', PROMPT, '--name', 'hero', ...KEPT_AS]);
      assert.equal(run.code, 1, `${mode}: ${run.text}`);
      assert.match(run.text, says);
      assert.match(run.text, /no image was made/);
      assert.match(run.text, /hero\.png already in .* is an earlier one/, 'the earlier file is not taken for this call’s');
      assert.deepEqual(readFileSync(join(p.assets, 'hero.png')), old);
      assert.deepEqual(readdirSync(p.assets), ['hero.png']);
      assert.deepEqual(stockLines(p), [], 'a picture that was not made is not kept');
      assert.deepEqual(stockFiles(p), []);
      noKeys(codex.calls());
      tidy(p);
    }
  } finally {
    p.done();
  }
});

test('a call that runs past its time limit is stopped, codex with it', async () => {
  const p = place();
  try {
    const codex = fakeCodex(p.root, 'hang');
    const old = earlier(p, 'hero');
    const run = await image(p, codex.bin, ['make', '--prompt', PROMPT, '--name', 'hero', ...KEPT_AS], { SZ_IMAGE_TIMEOUT_MS: '4000' });
    assert.equal(run.code, 1, run.text);
    assert.match(run.text, /did not finish within/);
    assert.match(run.text, /no image was made/);
    assert.deepEqual(readFileSync(join(p.assets, 'hero.png')), old);
    assert.deepEqual(readdirSync(p.assets), ['hero.png']);
    const pid = Number(readFileSync(codex.pid, 'utf8'));
    let alive = true;
    for (let i = 0; i < 50 && alive; i++) {
      try {
        process.kill(pid, 0);
        await new Promise((done) => setTimeout(done, 50));
      } catch {
        alive = false;
      }
    }
    assert.equal(alive, false, 'codex was ended with the call');
    tidy(p);
  } finally {
    p.done();
  }
});

test('codex refusing (the subscription’s own limit reached) is passed on in its own words', async () => {
  const p = place();
  try {
    const codex = fakeCodex(p.root, 'limit');
    const old = earlier(p, 'hero');
    const run = await image(p, codex.bin, ['make', '--prompt', PROMPT, '--name', 'hero', ...KEPT_AS]);
    assert.equal(run.code, 1, run.text);
    assert.ok(run.text.includes(LIMIT), run.text);
    assert.match(run.text, /no image was made/);
    assert.deepEqual(readFileSync(join(p.assets, 'hero.png')), old);
    assert.deepEqual(readdirSync(p.assets), ['hero.png']);
    noKeys(codex.calls());
    tidy(p);
  } finally {
    p.done();
  }
});

test('several calls at once, under different names, do not get in each other’s way', async () => {
  const p = place();
  try {
    const codex = fakeCodex(p.root, 'ok', 400);
    const runs = await Promise.all([
      image(p, codex.bin, ['make', '--prompt', PROMPT, '--name', 'walk-1', ...KEPT_AS]),
      image(p, codex.bin, ['make', '--prompt', PROMPT, '--name', 'walk-2', '--size', '512x512', ...KEPT_AS]),
      image(p, codex.bin, ['make', '--prompt', PROMPT, '--name', 'walk-3', '--size', '1600x900', ...KEPT_AS]),
    ]);
    for (const run of runs) assert.equal(run.code, 0, run.text);
    assert.deepEqual(readdirSync(p.assets).sort(), ['walk-1.png', 'walk-2.png', 'walk-3.png']);
    assert.equal(stockLines(p).length, 3, 'each of the three was kept in the stock');
    assert.equal(sizeOf(readFileSync(join(p.assets, 'walk-1.png'))), '1024x1024');
    assert.equal(sizeOf(readFileSync(join(p.assets, 'walk-2.png'))), '512x512');
    assert.equal(sizeOf(readFileSync(join(p.assets, 'walk-3.png'))), '1600x900');
    const folders = codex.calls().filter((call) => call.args.includes('exec')).map((call) => call.args[call.args.indexOf('-C') + 1]);
    assert.equal(new Set(folders).size, 3, 'each call had a folder of its own');
    noKeys(codex.calls());
    tidy(p);
  } finally {
    p.done();
  }
});

test('where codex keeps what it makes cannot be written (the session’s command sandbox): codex is not started', async () => {
  const p = place();
  try {
    const codex = fakeCodex(p.root, 'ok');
    chmodSync(p.codexHome, 0o555);
    const run = await image(p, codex.bin, ['make', '--prompt', PROMPT, '--name', 'hero', ...KEPT_AS]);
    chmodSync(p.codexHome, 0o755);
    assert.notEqual(run.code, 0, run.text);
    assert.match(run.text, /cannot write there \(EACCES\)/);
    assert.match(run.text, /session's command sandbox, run it outside/);
    assert.match(run.text, /no image was made/);
    assert.deepEqual(codex.calls().map((call) => call.args.join(' ')), ['login status']);
    tidy(p);
  } finally {
    p.done();
  }
});

// The stock: every picture made is kept on the owner's machine, outside any project, and looked in before
// another is made ("저장해두죠": faces, a bathroom scale, a meal were made again for every product).

test('a picture made is left in the project, and a copy is kept in the stock with its prompt and a full index line', async () => {
  const p = place();
  try {
    const codex = fakeCodex(p.root, 'ok');
    const run = await image(p, codex.bin, ['make', '--prompt', PROMPT, '--name', 'hero', '--size', '1600x900', '--kind', '풍경', '--what', '한강 둔치의 저녁, 쉬는 자전거']);
    assert.equal(run.code, 0, run.text);
    const placed = readFileSync(join(p.assets, 'hero.png'));
    assert.equal(sizeOf(placed), '1600x900');
    assert.deepEqual(readdirSync(p.assets), ['hero.png'], 'the project gets the picture and nothing else');
    const all = stockLines(p);
    assert.equal(all.length, 1);
    const kept = all[0]!;
    assert.deepEqual(Object.keys(kept), ['id', 'kind', 'what', 'prompt', 'width', 'height', 'file', 'sha256', 'addedAt', 'madeBy', 'for']);
    assert.equal(kept.kind, '풍경');
    assert.equal(kept.what, '한강 둔치의 저녁, 쉬는 자전거');
    assert.equal(kept.prompt, PROMPT, 'the words it was made from');
    assert.deepEqual([kept.width, kept.height], [1600, 900]);
    assert.equal(kept.sha256, sha(placed));
    assert.equal(kept.file, `pictures/풍경/한강-둔치의-저녁-쉬는-자전거-${sha(placed).slice(0, 8)}.png`, 'Hangul keeps its letters in the folder and file names');
    assert.deepEqual(readFileSync(join(p.stock, kept.file as string)), placed, 'the copy is the picture placed in the project');
    assert.equal(kept.madeBy, 'codex');
    assert.equal(kept.for, basename(p.project), 'the project it was made for');
    assert.ok(Date.parse(kept.addedAt as string) > Date.now() - 600_000);
    assert.ok(run.out.includes(`kept in the stock: ${kept.id as string}`), run.out);
    assert.ok(run.out.includes(join(p.stock, kept.file as string)), 'and where');
    assert.match(run.out, /"풍경" is a new kind \(the first in the stock\)/);
    tidy(p);

    // --json says the same, with where the copy is; the kind is now there, so this one is not new.
    const json = await image(p, codex.bin, ['make', '--prompt', PROMPT, '--name', 'square', '--json', '--kind', '풍경', '--what', 'the same evening, square']);
    assert.equal(json.code, 0, json.text);
    const said = JSON.parse(json.out) as { path: string; stock: { status: string; id: string; path: string; newKind: boolean } };
    assert.equal(said.path, join(realpathSync(p.assets), 'square.png'));
    const second = stockLines(p)[1]!;
    assert.deepEqual([said.stock.status, said.stock.id, said.stock.path, said.stock.newKind], ['kept', second.id, join(p.stock, second.file as string), false]);

    // --no-stock: a picture only right for this one product is placed, and the stock is left as it was.
    const index = readFileSync(join(p.stock, 'index.jsonl'));
    const files = stockFiles(p);
    const only = await image(p, codex.bin, ['make', '--prompt', PROMPT, '--name', 'only-here', '--size', '512x512', '--no-stock', '--kind', '풍경', '--what', 'this product’s own app icon']);
    assert.equal(only.code, 0, only.text);
    assert.equal(sizeOf(readFileSync(join(p.assets, 'only-here.png'))), '512x512');
    assert.deepEqual(readFileSync(join(p.stock, 'index.jsonl')), index);
    assert.deepEqual(stockFiles(p), files);
    assert.match(only.out, /not kept in the stock \(--no-stock\)/);
    tidy(p);
  } finally {
    p.done();
  }
});

test('before codex starts, a make is told what the stock holds of its kind and goes on; a make that fails keeps nothing', async () => {
  const p = place();
  try {
    assert.equal((await keep(p, png(64, 64, 'face 1'), 'face', 'smiling woman in her thirties')).code, 0);
    assert.equal((await keep(p, png(64, 64, 'face 2'), 'face', 'older man with glasses, laughing')).code, 0);
    assert.equal((await keep(p, png(64, 64, 'meal'), 'food', 'bibimbap in a stone bowl')).code, 0);
    const index = readFileSync(join(p.stock, 'index.jsonl'));
    const codex = fakeCodex(p.root, 'limit');
    const run = await image(p, codex.bin, ['make', '--prompt', 'a friendly face for the profile screen', '--name', 'avatar', '--kind', 'Face', '--what', 'young woman, short hair']);
    assert.equal(run.code, 1, run.text);
    assert.match(run.text, /the stock already holds 2 pictures of kind "face"/, 'a kind is the same kind whatever its case');
    assert.ok(run.text.includes('sz-eyes image find --kind "face"'), run.text);
    assert.ok(run.text.includes(LIMIT), 'it went on to codex (which here refused)');
    assert.ok(run.text.indexOf('already holds') < run.text.indexOf(LIMIT), 'the reminder came first');
    assert.deepEqual(readFileSync(join(p.stock, 'index.jsonl')), index, 'a make that failed adds nothing to the stock');
    assert.equal(stockFiles(p).length, 3);
    assert.ok(!existsSync(join(p.assets, 'avatar.png')));

    // A kind the stock holds nothing of: no reminder, and a new kind lists the kinds there are.
    const ok = fakeCodex(join(p.root, 'ok'), 'ok');
    const fresh = await image(p, ok.bin, ['make', '--prompt', PROMPT, '--name', 'hero', ...KEPT_AS]);
    assert.equal(fresh.code, 0, fresh.text);
    assert.doesNotMatch(fresh.text, /already holds/);
    assert.match(fresh.out, /"place" is a new kind\. Kinds already kept: face \(2\), food \(1\)/);
    assert.equal(stockLines(p).length, 4);
  } finally {
    p.done();
  }
});

test('where the stock cannot be written, make does not start codex (unless the picture is not to be kept)', async () => {
  const p = place();
  try {
    const codex = fakeCodex(p.root, 'ok');
    mkdirSync(p.stock);
    chmodSync(p.stock, 0o555);
    const run = await image(p, codex.bin, ['make', '--prompt', PROMPT, '--name', 'hero', ...KEPT_AS]);
    const without = await image(p, codex.bin, ['make', '--prompt', PROMPT, '--name', 'hero', '--no-stock', ...KEPT_AS]);
    chmodSync(p.stock, 0o755);
    assert.equal(run.code, 1, run.text);
    assert.match(run.text, /cannot write there \(EACCES\)/);
    assert.match(run.text, /no image was made/);
    assert.equal(codex.calls().filter((call) => call.args.includes('exec')).length, 1, 'codex made one picture: the one not to be kept');
    assert.equal(without.code, 0, without.text);
    assert.ok(existsSync(join(p.assets, 'hero.png')));
    assert.deepEqual(readdirSync(p.stock), []);
  } finally {
    p.done();
  }
});

test('find: by words of what or prompt, by kind, with nothing that matches, and on an empty stock', async () => {
  const p = place();
  try {
    for (const args of [['find', 'face'], ['find'], ['find', '--kind', 'face']]) {
      const empty = await image(p, NO_CODEX, args);
      assert.equal(empty.code, 0, `an empty stock is not an error: ${empty.text}`);
      assert.match(empty.out, /nothing is kept yet in /);
    }
    assert.equal((await keep(p, png(1024, 1024, 'a'), 'face', 'smiling woman in her thirties', ['--prompt', 'portrait photograph, soft window light'])).code, 0);
    assert.equal((await keep(p, png(1600, 900, 'b'), '음식', '돌솥 비빔밥 한 그릇')).code, 0);
    assert.equal((await keep(p, jpeg(800, 600), 'object', 'bathroom scale, white, from above', ['--prompt', 'a bathroom scale on warm tiles, soft light'])).code, 0);
    const [face, food, scale] = stockLines(p) as { id: string; file: string; addedAt: string }[];

    const byWords = await image(p, NO_CODEX, ['find', 'Woman', 'WINDOW']);
    assert.equal(byWords.code, 0, byWords.text);
    assert.ok(byWords.out.includes(face!.id), 'a word of what and a word of the prompt, in any case');
    assert.ok(!byWords.out.includes(scale!.id) && !byWords.out.includes(food!.id), 'every word has to be somewhere in it');
    for (const said of [join(p.stock, face!.file), '[face]', 'smiling woman in her thirties', '1024x1024', face!.addedAt.slice(0, 10)]) assert.ok(byWords.out.includes(said), `it says ${said}:\n${byWords.out}`);
    assert.match(byWords.out, /sz-eyes image use <id> --name <name>/, 'and how to take one');

    const soft = await image(p, NO_CODEX, ['find', 'soft', 'light']);
    assert.ok(soft.out.includes(face!.id) && soft.out.includes(scale!.id) && !soft.out.includes(food!.id), soft.out);
    const byKind = await image(p, NO_CODEX, ['find', '--kind', '음식']);
    assert.ok(byKind.out.includes(food!.id) && !byKind.out.includes(face!.id), byKind.out);
    const hangul = await image(p, NO_CODEX, ['find', '비빔밥']);
    assert.ok(hangul.out.includes(food!.id), hangul.out);
    const both = await image(p, NO_CODEX, ['find', 'soft', '--kind', 'Object']);
    assert.ok(both.out.includes(scale!.id) && !both.out.includes(face!.id), both.out);
    assert.ok(both.out.includes('800x600'));

    const nothing = await image(p, NO_CODEX, ['find', 'zebra']);
    assert.equal(nothing.code, 0, nothing.text);
    assert.match(nothing.out, /nothing kept matches "zebra" \(3 pictures kept\)/);
    assert.match(nothing.out, /face \(1\)/);
    const counts = await image(p, NO_CODEX, ['find']);
    assert.equal(counts.code, 0);
    assert.match(counts.out, /3 pictures kept, by kind/);
    for (const kind of [/face\s+1/, /음식\s+1/, /object\s+1/]) assert.match(counts.out, kind);

    const json = JSON.parse((await image(p, NO_CODEX, ['find', '--kind', 'face', '--json'])).out) as { total: number; matches: { id: string; path: string; width: number; height: number }[] };
    assert.equal(json.total, 3);
    assert.deepEqual(json.matches.map((m) => [m.id, m.path, m.width, m.height]), [[face!.id, join(p.stock, face!.file), 1024, 1024]]);
  } finally {
    p.done();
  }
});

/** A folder holding a `sips` that leaves something other than the picture asked for, and exits as if it had worked. */
const brokenSips = (p: Place): string => {
  const dir = join(p.root, 'broken-sips');
  mkdirSync(dir, { recursive: true });
  const bin = join(dir, 'sips');
  writeFileSync(bin, `#!${process.execPath}\nconst args = process.argv.slice(2);\nconst i = args.indexOf('--out');\nrequire('node:fs').writeFileSync(i >= 0 ? args[i + 1] : args.at(-1), 'half a picture');\n`);
  chmodSync(bin, 0o755);
  return dir;
};

test('use: a stock picture is put in the project under the asked name, and an earlier file under that name stays as it was when that fails', async () => {
  const p = place();
  try {
    const face = png(1024, 1024, 'face');
    assert.equal((await keep(p, face, 'face', 'smiling woman in her thirties')).code, 0);
    const photo = jpeg(800, 600);
    assert.equal((await keep(p, photo, 'object', 'bathroom scale, from above')).code, 0);
    const [faceId, photoId] = stockLines(p).map((one) => one.id as string) as [string, string];

    const used = await image(p, NO_CODEX, ['use', faceId, '--name', 'avatar-1']);
    assert.equal(used.code, 0, used.text);
    assert.deepEqual(readFileSync(join(p.assets, 'avatar-1.png')), face, 'the same picture, byte for byte');
    assert.ok(used.out.includes(join(p.assets, 'avatar-1.png')), used.out);
    assert.match(used.out, /1024x1024/);
    assert.ok(used.out.includes(faceId));
    // A JPEG stays a JPEG; --out puts it elsewhere; --json says the same.
    const out = join(p.root, 'web', 'public');
    const elsewhere = JSON.parse((await image(p, NO_CODEX, ['use', photoId, '--name', 'scale.jpg', '--out', out, '--json'])).out) as { path: string; width: number; height: number };
    assert.deepEqual([elsewhere.path, elsewhere.width, elsewhere.height], [join(out, 'scale.jpg'), 800, 600]);
    assert.deepEqual(readFileSync(join(out, 'scale.jpg')), photo);
    // Again under the same name: replaced whole, and it says so.
    const again = await image(p, NO_CODEX, ['use', faceId, '--name', 'avatar-1']);
    assert.match(again.out, /replaces the earlier avatar-1\.png/);

    // Each way it can fail leaves the earlier avatar-2.png as it was, and nothing half-made beside it.
    const old = earlier(p, 'avatar-2');
    const emptyPath = join(p.root, 'no-sips-here');
    mkdirSync(emptyPath);
    rmSync(join(p.stock, stockLines(p)[1]!.file as string));
    for (const [args, says, env] of [
      [['use', 'no-such-picture', '--name', 'avatar-2'], /no picture no-such-picture is kept/, {}],
      [['use', photoId, '--name', 'avatar-2'], /its picture is not there/, {}],
      [['use', faceId, '--name', 'avatar-2', '--size', '96x96'], /sips is not on this machine/, { PATH: emptyPath }],
      [['use', faceId, '--name', 'avatar-2', '--size', '96x96'], /not a picture of 96x96|is not a picture/, { PATH: brokenSips(p) }],
      [['use', faceId, '--name', 'avatar-2', '--size', 'big'], /--size big/, {}],
      [['use', faceId, '--name', 'Avatar Two'], /lower-case letters, digits and dashes/, {}],
      [['use', faceId], /--name <name> is missing/, {}],
      [['use', '--name', 'avatar-2'], /which picture/, {}],
    ] as const) {
      const failed = await image(p, NO_CODEX, [...args], env);
      assert.equal(failed.code, 1, `${args.join(' ')}: ${failed.text}`);
      assert.match(failed.text, says);
      assert.deepEqual(readFileSync(join(p.assets, 'avatar-2.png')), old, `${args.join(' ')}: the earlier file is untouched`);
      assert.deepEqual(readdirSync(p.assets).sort(), ['avatar-1.png', 'avatar-2.png'], `${args.join(' ')}: nothing half-made is left`);
      tidy(p);
    }
  } finally {
    p.done();
  }
});

test('use --size: the copy is exactly that size, scaled to cover it and cut from the middle, never stretched', async (t) => {
  const p = place();
  try {
    assert.equal((await keep(p, png(1600, 900, 'wide'), 'place', 'riverside park at dusk')).code, 0);
    const id = stockLines(p)[0]!.id as string;
    const square = await image(p, NO_CODEX, ['use', id, '--name', 'hero-square', '--size', '512x512']);
    if (spawnSync('sips', ['--help']).error) {
      t.diagnostic('sips is not on this machine (it comes with macOS): the size of a resized copy is not checked here');
      assert.equal(square.code, 1, square.text);
      assert.match(square.text, /sips is not on this machine/);
      return;
    }
    if (square.code === 3) {
      t.diagnostic(`sips cannot write its working copy inside the session's command sandbox, so the size of a resized copy is not checked in this run: ${square.text.trim()}`);
      assert.match(square.text, /sandbox/);
      return;
    }
    assert.equal(square.code, 0, square.text);
    assert.equal(sizeOf(readFileSync(join(p.assets, 'hero-square.png'))), '512x512');
    assert.match(square.out, /512x512/);
    const og = await image(p, NO_CODEX, ['use', id, '--name', 'og', '--size', '1200x630']);
    assert.equal(og.code, 0, og.text);
    assert.equal(sizeOf(readFileSync(join(p.assets, 'og.png'))), '1200x630');
    const bigger = await image(p, NO_CODEX, ['use', id, '--name', 'story', '--size', '1080x1920']);
    assert.equal(bigger.code, 0, bigger.text);
    assert.equal(sizeOf(readFileSync(join(p.assets, 'story.png'))), '1080x1920');
    assert.deepEqual(readdirSync(p.assets).sort(), ['hero-square.png', 'og.png', 'story.png']);
    assert.equal(stockLines(p).length, 1, 'the stock is only read');
    assert.equal(sizeOf(readFileSync(join(p.stock, stockLines(p)[0]!.file as string))), '1600x900', 'and its picture is left as it was');
    tidy(p);
  } finally {
    p.done();
  }
});

test('keep: a picture on disk is brought into the stock, anything else is refused, and the same picture is kept once', async () => {
  const p = place();
  try {
    const photo = jpeg(3024, 4032);
    const kept = await keep(p, photo, 'face', 'the owner, smiling, by a window', ['--for', 'side']);
    assert.equal(kept.code, 0, kept.text);
    const entry = stockLines(p)[0]!;
    assert.deepEqual(Object.keys(entry), ['id', 'kind', 'what', 'prompt', 'width', 'height', 'file', 'sha256', 'addedAt', 'madeBy', 'for']);
    assert.deepEqual([entry.kind, entry.what, entry.prompt, entry.width, entry.height, entry.madeBy, entry.for], ['face', 'the owner, smiling, by a window', null, 3024, 4032, null, 'side'], 'what is not said is kept as nothing, not a guess');
    assert.equal(entry.file, `pictures/face/the-owner-smiling-by-a-window-${sha(photo).slice(0, 8)}.jpg`, 'its type is read from its bytes, not its name');
    assert.deepEqual(readFileSync(join(p.stock, entry.file as string)), photo);
    assert.ok(kept.out.includes(`kept: ${entry.id as string}`), kept.out);
    assert.ok(kept.out.includes(join(p.stock, entry.file as string)));

    const mug = await keep(p, webp(640, 480), 'Object', 'white mug on a wooden table', ['--prompt', 'a white mug, morning light']);
    assert.equal(mug.code, 0, mug.text);
    const second = stockLines(p)[1]!;
    assert.deepEqual([second.kind, second.prompt, second.width, second.height], ['Object', 'a white mug, morning light', 640, 480]);
    assert.match(second.file as string, /^pictures\/object\/white-mug-on-a-wooden-table-[0-9a-f]{8}\.webp$/);
    assert.match(mug.out, /"Object" is a new kind\. Kinds already kept: face \(1\)/);
    const again = await keep(p, png(32, 32, 'plate'), 'object', 'an empty plate');
    assert.equal(stockLines(p)[2]!.kind, 'Object', 'a kind is kept under the name it was first given');
    assert.doesNotMatch(again.out, /new kind/);

    for (const [bytes, says] of [
      [Buffer.from('just some words, not a picture'), /is not a picture: PNG, JPEG or WebP/],
      [Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(20)]), /is not a picture: PNG, JPEG or WebP/],
      [Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]), /size cannot be read/],
    ] as const) {
      const refused = await keep(p, bytes, 'face', 'something');
      assert.equal(refused.code, 1, refused.text);
      assert.match(refused.text, says);
    }
    const missing = await image(p, NO_CODEX, ['keep', '--file', join(p.root, 'nowhere.png'), '--kind', 'face', '--what', 'someone']);
    assert.equal(missing.code, 1);
    assert.match(missing.text, /no such file/);
    const bare = await image(p, NO_CODEX, ['keep', '--file', join(p.root, 'nowhere.png')]);
    assert.equal(bare.code, 1);
    assert.match(bare.text, /--kind, --what missing/);
    assert.equal(stockLines(p).length, 3, 'nothing refused was kept');

    const twice = await keep(p, photo, 'people', 'the same photograph under another name');
    assert.equal(twice.code, 0, twice.text);
    assert.ok(twice.out.includes(`already kept: ${entry.id as string}`), twice.out);
    assert.equal(stockLines(p).length, 3);
    assert.equal(stockFiles(p).length, 3);
    assert.equal(stockLines(p)[0]!.what, 'the owner, smiling, by a window', 'the picture kept first is left as it was');
  } finally {
    p.done();
  }
});

test('show: one picture of the stock in full', async () => {
  const p = place();
  try {
    assert.equal((await keep(p, png(1024, 1024, 'scale'), 'object', 'bathroom scale, white, from above', ['--prompt', 'a white bathroom scale on warm tiles, seen from above, soft morning light', '--for', 'weigh-in'])).code, 0);
    const entry = stockLines(p)[0]! as { id: string; file: string; sha256: string };
    const shown = await image(p, NO_CODEX, ['show', entry.id]);
    assert.equal(shown.code, 0, shown.text);
    for (const said of [entry.id, 'object', 'bathroom scale, white, from above', 'a white bathroom scale on warm tiles, seen from above, soft morning light', '1024x1024', 'weigh-in', join(p.stock, entry.file), entry.sha256]) assert.ok(shown.out.includes(said), `it says ${said}:\n${shown.out}`);
    const json = JSON.parse((await image(p, NO_CODEX, ['show', entry.id, '--json'])).out) as { id: string; path: string; prompt: string };
    assert.deepEqual([json.id, json.path], [entry.id, join(p.stock, entry.file)]);
    const unknown = await image(p, NO_CODEX, ['show', 'no-such-picture']);
    assert.equal(unknown.code, 1);
    assert.match(unknown.text, /no picture no-such-picture is kept/);
    const none = await image(p, NO_CODEX, ['show']);
    assert.equal(none.code, 1);
    assert.match(none.text, /which picture/);
  } finally {
    p.done();
  }
});

test('eight keeps at the same moment all keep their line', async () => {
  const p = place();
  try {
    const ran = await Promise.all(Array.from({ length: 8 }, (_, i) => keep(p, png(48, 48, `#${i}`), i % 2 === 0 ? 'face' : 'food', `picture number ${i + 1}`)));
    for (const one of ran) assert.equal(one.code, 0, one.text);
    const all = stockLines(p);
    assert.equal(all.length, 8, 'no line was lost');
    assert.equal(new Set(all.map((one) => one.id)).size, 8);
    assert.equal(stockFiles(p).length, 8);
    assert.ok(!existsSync(join(p.stock, 'index.jsonl.lock')), 'the lock is let go');
    assert.deepEqual(readdirSync(p.stock).filter((name) => name.endsWith('.tmp')), [], 'no half-written index is left behind');
  } finally {
    p.done();
  }
});

// Correcting and taking out: an entry kept with a line that overstates what is in it, or under the wrong kind, is
// put right with image edit, and a picture that should not be in the stock is taken out with image remove, both
// under the stock's lock, never by a hand edit of an index other agents are writing.

/** The stock's index as it is on disk, to see that a refusal changed nothing. */
const stockIndex = (p: Place): Buffer => readFileSync(join(p.stock, 'index.jsonl'));

test('image edit: the fields given change, the rest stay, the id and the picture stay, and each change is said as it was and as it is', async () => {
  const p = place();
  try {
    assert.equal((await keep(p, png(64, 64, 'a'), 'face', 'smiling woman in her thirties', ['--prompt', 'portrait photograph, soft window light', '--for', 'side'])).code, 0);
    assert.equal((await keep(p, png(64, 64, 'b'), 'food', 'bibimbap in a stone bowl')).code, 0);
    const [before, other] = stockLines(p) as [Record<string, unknown>, Record<string, unknown>];
    const id = before.id as string;
    const ran = await image(p, NO_CODEX, ['edit', id, '--what', 'smiling woman']);
    assert.equal(ran.code, 0, ran.text);
    const [after, untouched] = stockLines(p) as [Record<string, unknown>, Record<string, unknown>];
    assert.deepEqual(after, { ...before, what: 'smiling woman' }, 'only what changed: the id, the picture and every other field stay');
    assert.deepEqual(untouched, other, 'another picture is left as it was');
    assert.deepEqual(readFileSync(join(p.stock, before.file as string)), png(64, 64, 'a'));
    assert.ok(ran.out.includes(id), ran.out);
    assert.match(ran.out, /what\s+was\s+smiling woman in her thirties\n\s+now\s+smiling woman/);
    assert.doesNotMatch(ran.out, /^\s+(kind|prompt|picture)\s/m, 'a field that did not change is not listed');

    // The prompt is changed, and "" takes it out (kept without the words it was made from).
    const prompted = await image(p, NO_CODEX, ['edit', id, '--prompt', 'portrait, north light']);
    assert.equal(prompted.code, 0, prompted.text);
    assert.match(prompted.out, /prompt\s+was\s+portrait photograph, soft window light\n\s+now\s+portrait, north light/);
    assert.deepEqual(stockLines(p)[0], { ...after, prompt: 'portrait, north light' });
    const cleared = await image(p, NO_CODEX, ['edit', id, '--prompt', '']);
    assert.equal(cleared.code, 0, cleared.text);
    assert.equal(stockLines(p)[0]!.prompt, null);
    assert.match(cleared.out, /now\s+\(not said\)/);
    const json = JSON.parse((await image(p, NO_CODEX, ['edit', id, '--what', 'a smiling woman', '--json'])).out) as { picture: { id: string; what: string; path: string }; changes: { field: string; was: unknown; now: unknown }[] };
    assert.deepEqual([json.picture.id, json.picture.what, json.picture.path], [id, 'a smiling woman', join(p.stock, before.file as string)]);
    assert.deepEqual(json.changes, [{ field: 'what', was: 'smiling woman', now: 'a smiling woman' }]);

    // The same again changes nothing, and says so.
    const index = stockIndex(p);
    const same = await image(p, NO_CODEX, ['edit', id, '--what', 'a smiling woman', '--kind', 'face']);
    assert.equal(same.code, 0, same.text);
    assert.match(same.out, /nothing changed/);
    assert.deepEqual(stockIndex(p), index);

    // Nothing to change, what edit does not take, words past the id, and a kind or what with nothing in it are refused.
    const file = join(p.root, 'another.png');
    writeFileSync(file, png(64, 64, 'another'));
    for (const [args, says] of [
      [['edit', id], /what to change/],
      [['edit', '--what', 'someone'], /which picture/],
      [['edit', id, '--file', file], /another picture is another entry.*image remove/],
      [['edit', id, '--what', 'smiling', 'woman'], /one id/],
      [['edit', id, '--what', '   '], /--what .*no letter or digit/],
      [['edit', id, '--kind', '!!!'], /--kind "!!!" has no letter or digit/],
    ] as const) {
      const refused = await image(p, NO_CODEX, [...args]);
      assert.equal(refused.code, 1, `${args.join(' ')}: ${refused.text}`);
      assert.match(refused.text, says, args.join(' '));
    }
    assert.deepEqual(stockIndex(p), index, 'nothing refused changed the index');
  } finally {
    p.done();
  }
});

test('image edit --kind moves the picture into the new kind, its name and hash kept, and find --kind finds it there and not under the old', async () => {
  const p = place();
  try {
    assert.equal((await keep(p, png(64, 64, 'a'), 'face', 'smiling woman in her thirties')).code, 0);
    assert.equal((await keep(p, png(64, 64, 'b'), 'face', 'older man with glasses')).code, 0);
    assert.equal((await keep(p, png(64, 64, 'c'), 'food', 'bibimbap in a stone bowl')).code, 0);
    const [first, second, food] = stockLines(p) as { id: string; file: string; sha256: string }[];

    const ran = await image(p, NO_CODEX, ['edit', first!.id, '--kind', 'Person']);
    assert.equal(ran.code, 0, ran.text);
    const moved = stockLines(p)[0]! as { id: string; kind: string; file: string; sha256: string };
    assert.deepEqual([moved.id, moved.kind, moved.sha256], [first!.id, 'Person', first!.sha256], 'the id and the picture stay');
    assert.equal(moved.file, `pictures/person/${basename(first!.file)}`, 'the file keeps its name, and so its hash');
    assert.deepEqual(readFileSync(join(p.stock, moved.file)), png(64, 64, 'a'));
    assert.ok(!existsSync(join(p.stock, first!.file)));
    assert.equal(stockFiles(p).length, 3);
    assert.match(ran.out, /kind\s+was\s+face\n\s+now\s+Person/);
    assert.ok(ran.out.includes(join(p.stock, first!.file)) && ran.out.includes(join(p.stock, moved.file)), 'where the picture was and where it is');
    assert.match(ran.out, /"Person" is a new kind\. Kinds already kept: face \(1\), food \(1\)/);

    const underNew = await image(p, NO_CODEX, ['find', '--kind', 'person']);
    assert.ok(underNew.out.includes(first!.id), underNew.out);
    const underOld = await image(p, NO_CODEX, ['find', '--kind', 'face']);
    assert.ok(!underOld.out.includes(first!.id) && underOld.out.includes(second!.id), underOld.out);

    // A kind already kept keeps the name it was first given, whatever case it is given in; the kind left empty is gone.
    const joined = await image(p, NO_CODEX, ['edit', second!.id, '--kind', 'PERSON']);
    assert.equal(joined.code, 0, joined.text);
    assert.doesNotMatch(joined.out, /new kind/);
    assert.deepEqual([(stockLines(p)[1] as { kind: string }).kind, (stockLines(p)[1] as { file: string }).file], ['Person', `pictures/person/${basename(second!.file)}`]);
    const counts = await image(p, NO_CODEX, ['find']);
    assert.match(counts.out, /Person\s+2/);
    assert.doesNotMatch(counts.out, /face/);
    assert.deepEqual(readdirSync(join(p.stock, 'pictures')).sort(), ['food', 'person'], 'a kind’s folder left empty is taken away');
    const same = await image(p, NO_CODEX, ['edit', food!.id, '--kind', 'Food']);
    assert.equal(same.code, 0, same.text);
    assert.match(same.out, /kind\s+was\s+food\n\s+now\s+Food/, 'a kind nobody else holds takes the name given now');
    assert.equal((stockLines(p)[2] as { file: string }).file, food!.file, 'and its picture stays where it is');
  } finally {
    p.done();
  }
});

test('image remove: a line that names a file outside the stock (a line put there by hand) loses its line, and that file stays', async () => {
  const p = place();
  try {
    assert.equal((await keep(p, png(64, 64, 'face'), 'face', 'smiling woman in her thirties')).code, 0);
    const outside = join(p.root, 'not-the-stocks.png');
    writeFileSync(outside, png(64, 64, 'other'));
    const [line] = stockLines(p) as { id: string; file: string }[];
    writeFileSync(join(p.stock, 'index.jsonl'), JSON.stringify({ ...line, file: join('..', 'not-the-stocks.png') }) + '\n');

    const ran = await image(p, NO_CODEX, ['remove', line!.id]);
    assert.equal(ran.code, 0, ran.text);
    assert.deepEqual(stockLines(p), [], 'its line is out');
    assert.deepEqual(readFileSync(outside), png(64, 64, 'other'), 'a file outside the stock is not deleted');
  } finally {
    p.done();
  }
});

test('image remove: the line and the picture leave the stock, a copy put in a project stays, and show then says it is not there', async () => {
  const p = place();
  try {
    const face = png(64, 64, 'face');
    assert.equal((await keep(p, face, 'face', 'smiling woman in her thirties', ['--prompt', 'portrait photograph, soft window light'])).code, 0);
    assert.equal((await keep(p, png(64, 64, 'meal'), 'food', 'bibimbap in a stone bowl')).code, 0);
    const [gone, stays] = stockLines(p) as { id: string; file: string }[];
    assert.equal((await image(p, NO_CODEX, ['use', gone!.id, '--name', 'avatar'])).code, 0);

    const ran = await image(p, NO_CODEX, ['remove', gone!.id]);
    assert.equal(ran.code, 0, ran.text);
    for (const said of [gone!.id, 'face', 'smiling woman in her thirties', 'portrait photograph, soft window light', '64x64', 'sz-eyes image keep']) assert.ok(ran.out.includes(said), `it says ${said}:\n${ran.out}`);
    assert.deepEqual(stockLines(p).map((one) => one.id), [stays!.id]);
    assert.ok(!existsSync(join(p.stock, gone!.file)), 'its picture is deleted from the stock');
    assert.deepEqual(readFileSync(join(p.assets, 'avatar.png')), face, 'the copy in the project is the project’s, and stays');
    assert.deepEqual(readFileSync(join(p.stock, stays!.file)), png(64, 64, 'meal'), 'the other picture is left as it was');
    const counts = await image(p, NO_CODEX, ['find']);
    assert.doesNotMatch(counts.out, /face/, 'a kind left empty is no longer listed');
    const shown = await image(p, NO_CODEX, ['show', gone!.id]);
    assert.equal(shown.code, 1, shown.text);
    assert.match(shown.text, new RegExp(`no picture ${gone!.id} is kept`));

    // --json gives the whole entry that was removed; the copy in the project can be kept again.
    const json = JSON.parse((await image(p, NO_CODEX, ['remove', stays!.id, '--json'])).out) as { removed: { id: string; what: string } };
    assert.deepEqual([json.removed.id, json.removed.what], [stays!.id, 'bibimbap in a stone bowl']);
    assert.deepEqual(stockLines(p), []);
    assert.deepEqual(stockFiles(p), []);
    const again = await image(p, NO_CODEX, ['keep', '--file', join(p.assets, 'avatar.png'), '--kind', 'face', '--what', 'smiling woman in her thirties']);
    assert.equal(again.code, 0, again.text);
    assert.match(again.out, /^kept: /);
  } finally {
    p.done();
  }
});

test('image: an id that is not kept is refused with exit 1, naming the closest ids when a prefix matches, and nothing changes', async () => {
  const p = place();
  try {
    assert.equal((await keep(p, png(64, 64, 'a'), 'face', 'smiling woman')).code, 0);
    assert.equal((await keep(p, png(64, 64, 'b'), 'food', 'bibimbap')).code, 0);
    const [face, food] = stockLines(p) as { id: string }[];
    const index = stockIndex(p);
    for (const command of [['edit', '--what', 'another line'], ['remove'], ['show']]) {
      const typo = `${face!.id.slice(0, -1)}z`;
      const near = await image(p, NO_CODEX, [command[0]!, typo, ...command.slice(1)]);
      assert.equal(near.code, 1, near.text);
      assert.match(near.text, new RegExp(`no picture ${typo} is kept`));
      assert.ok(near.text.includes(face!.id) && !near.text.includes(food!.id), `the closest id, and only it: ${near.text}`);
      const prefix = await image(p, NO_CODEX, [command[0]!, 'foo', ...command.slice(1)]);
      assert.equal(prefix.code, 1, prefix.text);
      assert.ok(prefix.text.includes(food!.id) && !prefix.text.includes(face!.id), prefix.text);
      const far = await image(p, NO_CODEX, [command[0]!, 'zebra-0000', ...command.slice(1)]);
      assert.equal(far.code, 1, far.text);
      assert.match(far.text, /no picture zebra-0000 is kept/);
      assert.ok(!far.text.includes(face!.id) && !far.text.includes(food!.id), far.text);
    }
    assert.deepEqual(stockIndex(p), index);
    assert.equal(stockFiles(p).length, 2);
  } finally {
    p.done();
  }
});

test('four image edits and four image removes of different pictures at the same moment all take effect, and no line is lost', async () => {
  const p = place();
  try {
    const kept = await Promise.all(Array.from({ length: 8 }, (_, i) => keep(p, png(48, 48, `#${i + 1}`), 'face', `picture number ${i + 1}`)));
    for (const one of kept) assert.equal(one.code, 0, one.text);
    const before = stockLines(p) as { id: string; what: string; file: string }[];
    const byNumber = (n: number): { id: string; file: string } => before.find((one) => one.what === `picture number ${n}`)!;
    const ran = await Promise.all([
      image(p, NO_CODEX, ['edit', byNumber(1).id, '--what', 'edited one']),
      image(p, NO_CODEX, ['edit', byNumber(2).id, '--kind', 'person']),
      image(p, NO_CODEX, ['edit', byNumber(3).id, '--kind', 'person', '--what', 'edited three']),
      image(p, NO_CODEX, ['edit', byNumber(4).id, '--prompt', 'a face, soft light']),
      ...[5, 6, 7, 8].map((n) => image(p, NO_CODEX, ['remove', byNumber(n).id])),
    ]);
    for (const one of ran) assert.equal(one.code, 0, one.text);
    const after = stockLines(p) as { id: string; kind: string; what: string; prompt: string | null; file: string }[];
    assert.equal(after.length, 4, 'four removed, four kept');
    const find = (n: number): (typeof after)[number] => after.find((one) => one.id === byNumber(n).id)!;
    assert.equal(find(1).what, 'edited one');
    assert.equal(find(2).kind, 'person');
    assert.deepEqual([find(3).kind, find(3).what], ['person', 'edited three']);
    assert.equal(find(4).prompt, 'a face, soft light');
    for (const n of [5, 6, 7, 8]) {
      assert.ok(!after.some((one) => one.id === byNumber(n).id), `${n} is gone`);
      assert.ok(!existsSync(join(p.stock, byNumber(n).file)), `${n}'s picture is gone`);
    }
    for (const one of after) assert.ok(existsSync(join(p.stock, one.file)), `${one.id}'s picture is where its line says`);
    assert.equal(stockFiles(p).length, 4);
    assert.ok(!existsSync(join(p.stock, 'index.jsonl.lock')), 'the lock is let go');
    assert.deepEqual(readdirSync(p.stock).filter((name) => name.endsWith('.tmp')), [], 'no half-written index is left behind');
  } finally {
    p.done();
  }
});

const hook =(input: string, env: Record<string, string> = {}): { code: number | null; out: string; err: string } => {
  const base: NodeJS.ProcessEnv = { ...process.env };
  delete base.SZ_PAID_IMAGES;
  const run = spawnSync(process.execPath, [HOOK], { encoding: 'utf8', input, env: { ...base, ...env } });
  return { code: run.status, out: run.stdout, err: run.stderr };
};
const call = (cwd: string): string => JSON.stringify({ cwd, hook_event_name: 'PreToolUse', tool_name: 'mcp__openai-image__gpt_image_generate', tool_input: { prompt: 'a hero picture', size: '1536x1024' } });

test('inside a Studio Zero project, a tool that bills for each image is refused and the way on the subscription is named', () => {
  const root = mkdtempSync(join(tmpdir(), 'sz-paid-image-'));
  try {
    const project = join(root, 'product');
    mkdirSync(join(project, '.sz'), { recursive: true });
    mkdirSync(join(project, 'web', 'src'), { recursive: true });
    for (const cwd of [project, join(project, 'web', 'src')]) {
      const refused = hook(call(cwd));
      assert.equal(refused.code, 2, refused.err);
      assert.match(refused.err, /bills/);
      assert.match(refused.err, /for each image/);
      assert.match(refused.err, /subscription/);
      assert.ok(refused.err.includes('sz-eyes image find --kind face'), refused.err);
      assert.ok(refused.err.includes('sz-eyes image make --kind <kind> --what "'), refused.err);
      assert.match(refused.err, /--name/);
      assert.match(refused.err, /--size WxH/);
      assert.match(refused.err, /background/);
      assert.match(refused.err, /one to three minutes/);
    }
    // Outside such a project, or when the owner has said paid images are fine, the hook says nothing.
    const outside = join(root, 'elsewhere');
    mkdirSync(outside);
    assert.deepEqual(hook(call(outside)), { code: 0, out: '', err: '' });
    assert.deepEqual(hook(call(project), { SZ_PAID_IMAGES: '1' }), { code: 0, out: '', err: '' });
    // A hook that cannot read its call lets it through.
    assert.deepEqual(hook('not json'), { code: 0, out: '', err: '' });
    assert.deepEqual(hook(''), { code: 0, out: '', err: '' });
    assert.deepEqual(hook(JSON.stringify({ cwd: 42 })), { code: 0, out: '', err: '' });
    // It is registered for every tool of that server, before the tool runs.
    const hooks = JSON.parse(readFileSync(join(HERE, '../../../plugin/hooks/hooks.json'), 'utf8')).hooks.PreToolUse as { matcher: string; hooks: { command: string }[] }[];
    const entry = hooks.find((h) => h.matcher === 'mcp__openai-image__.*');
    assert.ok(entry, 'registered with the matcher mcp__openai-image__.*');
    assert.match(entry.hooks[0]!.command, /guard-paid-image\.mjs/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
