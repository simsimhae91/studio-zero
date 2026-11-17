// Pictures for a product's screens are made on the subscription the owner already pays for: the Codex CLI's own
// image generation, signed in with ChatGPT. Never through an API that bills for each image. Run through the real
// command line against a fake `codex` (SZ_CODEX_BIN) that behaves as each test asks: no real image is ever made.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
  done: () => void;
}
/** A project, the folder its pictures go to, codex's own home and a temporary folder, all the test's own. */
function place(): Place {
  const root = mkdtempSync(join(tmpdir(), 'sz-image-test-'));
  const project = join(root, 'project');
  const assets = join(project, '.sz', 'design', 'assets');
  const tmp = join(root, 'tmp');
  const codexHome = join(root, 'codex-home');
  for (const dir of [project, tmp, codexHome]) mkdirSync(dir, { recursive: true });
  return { root, project, assets, tmp, codexHome, done: () => rmSync(root, { recursive: true, force: true }) };
}

/** `sz-eyes image ...` as its own process, with API keys set in the environment it is started with. */
const image = (p: Place, bin: string, args: string[], env: Record<string, string> = {}): Promise<Ran> =>
  new Promise((done) => {
    const child = spawn(process.execPath, [CLI, 'image', ...args], {
      cwd: p.project,
      env: { ...process.env, SZ_CODEX_BIN: bin, CODEX_HOME: p.codexHome, TMPDIR: p.tmp, OPENAI_API_KEY: 'sk-proj-test', CODEX_API_KEY: 'sk-codex-test', ANTHROPIC_API_KEY: 'sk-ant-test', ...env },
    });
    let out = '';
    let err = '';
    child.stdout.on('data', (chunk) => (out += chunk));
    child.stderr.on('data', (chunk) => (err += chunk));
    child.once('close', (code) => done({ code, out, text: `${out}${err}` }));
  });

const PROMPT = '한강 둔치의 저녁, 자전거를 세워 두고 쉬는 사람들, 따뜻한 역광: 산책 기록 앱 첫 화면의 큰 사진';
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

test('one picture is made on the ChatGPT login, checked on disk, and put in place at the size asked', async () => {
  const p = place();
  try {
    const codex = fakeCodex(p.root, 'ok');
    const old = earlier(p, 'hero', 1600, 900);
    const run = await image(p, codex.bin, ['make', '--prompt', PROMPT, '--name', 'hero', '--size', '1600x900']);
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
    const json = await image(p, codex.bin, ['make', '--prompt', PROMPT, '--name', 'square-1', '--out', out, '--json']);
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
      const run = await image(p, codex.bin, ['make', '--prompt', PROMPT, '--name', 'hero']);
      assert.equal(run.code, 1, run.text);
      assert.match(run.text, says);
      assert.match(run.text, /`codex login`/);
      assert.match(run.text, /ChatGPT/);
      assert.match(run.text, /no image was made/);
      assert.deepEqual(codex.calls().map((call) => call.args.join(' ')), ['login status'], 'nothing but the question was asked of codex');
      noKeys(codex.calls());
      assert.deepEqual(readFileSync(join(p.assets, 'hero.png')), old);
      assert.deepEqual(readdirSync(p.assets), ['hero.png']);
    }
    const missing = await image(p, join(p.root, 'no-such-codex'), ['make', '--prompt', PROMPT, '--name', 'hero']);
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
      [['make', '--name', 'hero'], /--prompt/],
      [['make', '--prompt', PROMPT], /--name/],
      [['make', '--prompt', PROMPT, '--name', 'Hero Image'], /lower-case letters, digits and dashes/],
      [['make', '--prompt', PROMPT, '--name', 'hero', '--size', '800x600'], /1024x1024.*1600x900/],
    ] as const) {
      const run = await image(p, codex.bin, [...args]);
      assert.equal(run.code, 1, run.text);
      assert.match(run.text, says);
    }
    assert.deepEqual(codex.calls(), []);
    assert.ok(!existsSync(p.assets));
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
      const run = await image(p, codex.bin, ['make', '--prompt', PROMPT, '--name', 'hero']);
      assert.equal(run.code, 1, `${mode}: ${run.text}`);
      assert.match(run.text, says);
      assert.match(run.text, /no image was made/);
      assert.match(run.text, /hero\.png already in .* is an earlier one/, 'the earlier file is not taken for this call’s');
      assert.deepEqual(readFileSync(join(p.assets, 'hero.png')), old);
      assert.deepEqual(readdirSync(p.assets), ['hero.png']);
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
    const run = await image(p, codex.bin, ['make', '--prompt', PROMPT, '--name', 'hero'], { SZ_IMAGE_TIMEOUT_MS: '4000' });
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
    const run = await image(p, codex.bin, ['make', '--prompt', PROMPT, '--name', 'hero']);
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
      image(p, codex.bin, ['make', '--prompt', PROMPT, '--name', 'walk-1']),
      image(p, codex.bin, ['make', '--prompt', PROMPT, '--name', 'walk-2', '--size', '512x512']),
      image(p, codex.bin, ['make', '--prompt', PROMPT, '--name', 'walk-3', '--size', '1600x900']),
    ]);
    for (const run of runs) assert.equal(run.code, 0, run.text);
    assert.deepEqual(readdirSync(p.assets).sort(), ['walk-1.png', 'walk-2.png', 'walk-3.png']);
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
    const run = await image(p, codex.bin, ['make', '--prompt', PROMPT, '--name', 'hero']);
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

const hook = (input: string, env: Record<string, string> = {}): { code: number | null; out: string; err: string } => {
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
      assert.ok(refused.err.includes('sz-eyes image make --prompt "'), refused.err);
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
