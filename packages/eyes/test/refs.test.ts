// The house reference library: pictures of how shipped products do a screen, each with what is seen in it,
// kept on the owner's machine so that every pull from a reference service leaves something behind. Run through
// the real command line with SZ_REFS_DIR pointing at a folder of the test's own.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const CLI = join(HERE, '../src/cli.ts');

type Ran = { code: number | null; out: string; text: string };
/** `sz-eyes refs ...` run as its own process, without stopping this one (a test may be serving it pictures). */
const refs = (lib: string, args: string[], env: Record<string, string> = {}): Promise<Ran> =>
  new Promise((done) => {
    const base: NodeJS.ProcessEnv = { ...process.env };
    // The relaxation of https is given by a test that means it, never inherited.
    delete base.SZ_REFS_ALLOW_HTTP;
    const child = spawn(process.execPath, [CLI, 'refs', ...args], { env: { ...base, SZ_REFS_DIR: lib, ...env } });
    let out = '';
    let err = '';
    child.stdout.on('data', (chunk) => (out += chunk));
    child.stderr.on('data', (chunk) => (err += chunk));
    child.once('close', (code) => done({ code, out, text: `${out}${err}` }));
  });

const serve = async (handler: (req: IncomingMessage, res: ServerResponse) => void): Promise<{ server: Server; url: string }> => {
  const server = createServer(handler);
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  return { server, url: `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}` };
};

// The smallest PNG there is, and as many different pictures as a test needs (bytes after its end make each its own).
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const picture = (n: number): Buffer => Buffer.concat([PNG, Buffer.from(`#${n}`)]);
const sha = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');

const NOTES = `Only the phone number is asked first; the terms wait in a sheet that rises after the number is in.
The field sits in the top third with the keyboard already up, so the first tap is a digit, not a focus.
The Next button rides on top of the keyboard.`;
const NOTES_KO = `휴대폰 번호 한 칸만 먼저 보여 주고, 약관 동의는 번호를 넣은 뒤 아래에서 올라오는 시트로 미룬다.
입력 칸이 화면 위 3분의 1에 있고 키보드가 이미 올라와 있어 첫 탭이 필요 없다. 다음 버튼은 키보드 바로 위에 붙어 있다.`;
const NOTES_PAY = `The amount is the largest thing on the screen and the button below it says the amount again.
The card is chosen in a row of small cards that scroll sideways; the last one used is first and already chosen.`;

/** A library that does not exist yet, a folder for what is handed to it, and a way to remove both. */
const setup = (): { lib: string; input: string; put: (name: string, body: string | Buffer) => string; done: () => void } => {
  const root = mkdtempSync(join(tmpdir(), 'refs-'));
  const input = join(root, 'input');
  mkdirSync(input);
  return {
    lib: join(root, 'library'),
    input,
    put: (name, body) => {
      writeFileSync(join(input, name), body);
      return join(input, name);
    },
    done: () => rmSync(root, { recursive: true, force: true }),
  };
};

const lines = (lib: string): Record<string, unknown>[] =>
  existsSync(join(lib, 'index.jsonl'))
    ? readFileSync(join(lib, 'index.jsonl'), 'utf8')
        .split('\n')
        .filter((line) => line.trim() !== '')
        .map((line) => JSON.parse(line) as Record<string, unknown>)
    : [];
const shots = (lib: string): string[] => (existsSync(join(lib, 'shots')) ? readdirSync(join(lib, 'shots'), { recursive: true, encoding: 'utf8' }).filter((name) => /\.\w+$/.test(name)) : []);

const add = (lib: string, put: (name: string, body: string | Buffer) => string, n: number, more: Record<string, string> = {}): Promise<Ran> => {
  const flags: Record<string, string> = { '--kind': 'Sign in', '--product': 'Toss', '--what': 'phone number first, terms later', '--link': `https://example.com/screens/${n}`, '--file': put(`shot-${n}.png`, picture(n)), '--notes': put(`notes-${n}.md`, NOTES), ...more };
  return refs(lib, ['add', ...Object.entries(flags).flatMap(([flag, value]) => [flag, value])]);
};

test('a reference added from a file is kept as a picture under its kind and as a line of the index with every field', async () => {
  const { lib, put, done } = setup();
  try {
    const ran = await add(lib, put, 1, { '--platform': 'ios', '--lang': 'ko', '--for': 'side' });
    assert.equal(ran.code, 0, ran.text);
    const all = lines(lib);
    assert.equal(all.length, 1);
    const ref = all[0]!;
    assert.deepEqual(Object.keys(ref), ['id', 'kind', 'product', 'what', 'platform', 'lang', 'link', 'file', 'sha256', 'addedAt', 'for', 'notes']);
    assert.equal(ref.kind, 'Sign in');
    assert.equal(ref.product, 'Toss');
    assert.equal(ref.what, 'phone number first, terms later');
    assert.equal(ref.platform, 'ios');
    assert.equal(ref.lang, 'ko');
    assert.equal(ref.link, 'https://example.com/screens/1');
    assert.equal(ref.for, 'side');
    assert.equal(ref.sha256, sha(picture(1)));
    assert.equal(ref.file, `shots/sign-in/toss-phone-number-first-terms-later-${sha(picture(1)).slice(0, 8)}.png`);
    assert.deepEqual(readFileSync(join(lib, ref.file as string)), picture(1), 'the picture is kept by its bytes');
    assert.equal(ref.notes, NOTES.trim(), "the notes file's text is kept in the entry");
    assert.ok(Date.parse(ref.addedAt as string) > Date.now() - 600_000);
    assert.ok(ran.out.includes(ref.id as string), 'it says the id');
    assert.ok(ran.out.includes(join(lib, ref.file as string)), 'and where the picture is');
    // What is not said is kept as nothing, not as a guess.
    const bare = await add(lib, put, 2);
    assert.equal(bare.code, 0, bare.text);
    assert.deepEqual([lines(lib)[1]!.platform, lines(lib)[1]!.lang, lines(lib)[1]!.for], [null, null, null]);
  } finally {
    done();
  }
});

test('a Hangul kind and product keep their letters in the folder and file names, and a new kind lists the kinds there are', async () => {
  const { lib, put, done } = setup();
  try {
    const first = await add(lib, put, 1, { '--kind': '로그인 화면', '--product': '토스', '--what': '휴대폰 번호 먼저, 약관은 나중에', '--notes': put('ko.md', NOTES_KO) });
    assert.equal(first.code, 0, first.text);
    const ref = lines(lib)[0]!;
    assert.equal(ref.kind, '로그인 화면');
    assert.equal(ref.file, `shots/로그인-화면/토스-휴대폰-번호-먼저-약관은-나중에-${sha(picture(1)).slice(0, 8)}.png`);
    assert.ok(existsSync(join(lib, ref.file as string)));
    assert.match(first.out, /new kind/i);
    for (let n = 2; n <= 3; n++) assert.equal((await add(lib, put, n, { '--kind': '로그인 화면', '--product': '토스' })).code, 0);
    const second = await add(lib, put, 4, { '--kind': '결제', '--product': 'Kakao Pay', '--notes': put('pay.md', NOTES_PAY) });
    assert.equal(second.code, 0, second.text);
    assert.match(second.out, /new kind/i);
    assert.match(second.out, /로그인 화면 \(3\)/, 'the kinds already kept, with how many each holds, so that a name is reused');
    const again = await add(lib, put, 5, { '--kind': '결제', '--product': 'Kakao Pay', '--notes': put('pay.md', NOTES_PAY) });
    assert.doesNotMatch(again.out, /new kind/i, 'a kind that is there is not new');
  } finally {
    done();
  }
});

test('a reference with no notes, or notes that say almost nothing, is refused and nothing is kept', async () => {
  const { lib, put, done } = setup();
  try {
    const none = await refs(lib, ['add', '--kind', 'Sign in', '--product', 'Toss', '--what', 'first screen', '--link', 'https://example.com/a', '--file', put('a.png', picture(1))]);
    assert.equal(none.code, 1, none.text);
    assert.match(none.text, /--notes/);
    const short = await refs(lib, ['add', '--kind', 'Sign in', '--product', 'Toss', '--what', 'first screen', '--link', 'https://example.com/a', '--file', put('a.png', picture(1)), '--notes', put('short.md', '로그인 화면. 깔끔함.\n')]);
    assert.equal(short.code, 1, short.text);
    assert.match(short.text, /80/);
    const missing = await refs(lib, ['add', '--kind', 'Sign in', '--product', 'Toss', '--what', 'first screen', '--link', 'https://example.com/a', '--file', put('a.png', picture(1)), '--notes', join(lib, 'nowhere.md')]);
    assert.equal(missing.code, 1, missing.text);
    assert.deepEqual(lines(lib), []);
    assert.deepEqual(shots(lib), []);
  } finally {
    done();
  }
});

test('the same link or the same picture is kept once: its notes are replaced and it says which reference holds it', async () => {
  const { lib, put, done } = setup();
  try {
    assert.equal((await add(lib, put, 1)).code, 0);
    const id = lines(lib)[0]!.id as string;
    // The same link with another picture and other notes.
    const sameLink = await add(lib, put, 2, { '--link': 'https://example.com/screens/1', '--notes': put('ko.md', NOTES_KO) });
    assert.equal(sameLink.code, 0, sameLink.text);
    assert.match(sameLink.out, new RegExp(`already kept: ${id}`));
    assert.equal(lines(lib).length, 1);
    assert.equal(lines(lib)[0]!.notes, NOTES_KO.trim());
    // The same picture from another address.
    const samePicture = await add(lib, put, 1, { '--link': 'https://elsewhere.example.com/x', '--notes': put('pay.md', NOTES_PAY) });
    assert.equal(samePicture.code, 0, samePicture.text);
    assert.match(samePicture.out, new RegExp(`already kept: ${id}`));
    assert.equal(lines(lib).length, 1);
    assert.equal(lines(lib)[0]!.notes, NOTES_PAY.trim());
    assert.equal(lines(lib)[0]!.link, 'https://example.com/screens/1', 'the reference keeps the address it was first kept from');
    assert.equal(shots(lib).length, 1, 'no second picture');
    // The same again, notes and all: nothing changes, and it says so.
    const same = await add(lib, put, 1, { '--link': 'https://example.com/screens/1', '--notes': put('pay.md', NOTES_PAY) });
    assert.match(same.out, /already kept/);
    assert.match(same.out, /unchanged/);
  } finally {
    done();
  }
});

test('find: by a word of the notes, by kind, with nothing that matches, and on an empty library', async () => {
  const { lib, put, done } = setup();
  try {
    const empty = await refs(lib, ['find', 'keyboard']);
    assert.equal(empty.code, 0, 'an empty library is not an error');
    assert.match(empty.out, /nothing/i);
    assert.equal((await refs(lib, ['find'])).code, 0);
    assert.equal((await add(lib, put, 1)).code, 0);
    assert.equal((await add(lib, put, 2, { '--kind': '결제', '--product': 'Kakao Pay', '--what': 'amount first', '--notes': put('pay.md', NOTES_PAY) })).code, 0);
    const [signIn, pay] = lines(lib) as { id: string; file: string; link: string }[];
    const byNotes = await refs(lib, ['find', 'KEYBOARD', 'next']);
    assert.equal(byNotes.code, 0, byNotes.text);
    assert.ok(byNotes.out.includes(signIn!.id));
    assert.ok(!byNotes.out.includes(pay!.id), 'every word has to be somewhere in it');
    assert.ok(byNotes.out.includes(join(lib, signIn!.file)), "the picture's whole path");
    assert.ok(byNotes.out.includes(signIn!.link));
    assert.ok(byNotes.out.includes('Only the phone number is asked first'), 'the first lines of its notes');
    assert.ok(byNotes.out.includes('The field sits in the top third'));
    assert.ok(!byNotes.out.includes('The Next button rides'), 'two lines of the notes, not all of them');
    const byKind = await refs(lib, ['find', '--kind', '결제']);
    assert.ok(byKind.out.includes(pay!.id) && !byKind.out.includes(signIn!.id), byKind.out);
    const byProduct = await refs(lib, ['find', '--product', 'kakao', '--json']);
    assert.deepEqual((JSON.parse(byProduct.out) as { matches: { id: string; path: string }[] }).matches.map((m) => [m.id, m.path]), [[pay!.id, join(lib, pay!.file)]]);
    const nothing = await refs(lib, ['find', 'zebra']);
    assert.equal(nothing.code, 0);
    assert.match(nothing.out, /nothing kept matches/i);
    const counts = await refs(lib, ['find']);
    assert.match(counts.out, /Sign in\D+1/);
    assert.match(counts.out, /결제\D+1/);
  } finally {
    done();
  }
});

test('kinds: each kind with how many references it holds, kinds being the same kind whatever their case', async () => {
  const { lib, put, done } = setup();
  try {
    assert.equal((await add(lib, put, 1)).code, 0);
    assert.equal((await add(lib, put, 2, { '--kind': 'sign in' })).code, 0);
    assert.equal((await add(lib, put, 3, { '--kind': '결제', '--notes': put('pay.md', NOTES_PAY) })).code, 0);
    assert.equal(lines(lib)[1]!.kind, 'Sign in', 'a kind is kept under the name it was first given');
    const text = await refs(lib, ['kinds']);
    assert.equal(text.code, 0, text.text);
    assert.match(text.out, /Sign in\D+2/);
    assert.match(text.out, /결제\D+1/);
    const json = JSON.parse((await refs(lib, ['kinds', '--json'])).out) as { kind: string; count: number; page: boolean }[];
    assert.deepEqual(json.map((k) => [k.kind, k.count, k.page]), [['Sign in', 2, false], ['결제', 1, false]]);
  } finally {
    done();
  }
});

test("kind --write replaces a kind's page and keeps the one before beside it", async () => {
  const { lib, put, done } = setup();
  try {
    assert.equal((await add(lib, put, 1)).code, 0);
    const id = lines(lib)[0]!.id as string;
    const first = `# Sign in\n\nAsk for one thing first (the phone number) and keep the terms for after it: Toss, ${id}.\n`;
    const second = `# Sign in\n\nOne field, keyboard already up, the button riding on the keyboard: every kept sign-in does this (${id}).\n`;
    const wrote = await refs(lib, ['kind', 'Sign in', '--write', put('page1.md', first)]);
    assert.equal(wrote.code, 0, wrote.text);
    assert.equal(readFileSync(join(lib, 'kinds', 'sign-in.md'), 'utf8'), first);
    assert.ok(!existsSync(join(lib, 'kinds', 'sign-in.prev.md')), 'nothing came before the first page');
    const rewrote = await refs(lib, ['kind', 'sign in', '--write', put('page2.md', second)]);
    assert.equal(rewrote.code, 0, rewrote.text);
    assert.equal(readFileSync(join(lib, 'kinds', 'sign-in.md'), 'utf8'), second);
    assert.equal(readFileSync(join(lib, 'kinds', 'sign-in.prev.md'), 'utf8'), first);
    const read = await refs(lib, ['kind', 'Sign in']);
    assert.equal(read.code, 0, read.text);
    assert.ok(read.out.includes('every kept sign-in does this'), 'the page');
    assert.ok(read.out.includes(id), 'and its references');
    const kinds = JSON.parse((await refs(lib, ['kinds', '--json'])).out) as { page: boolean }[];
    assert.equal(kinds[0]!.page, true);
    const unknown = await refs(lib, ['kind', 'Checkout', '--write', put('page3.md', second)]);
    assert.equal(unknown.code, 1, 'a page is written from references, and that kind has none');
  } finally {
    done();
  }
});

test('show: one reference in full, notes and all', async () => {
  const { lib, put, done } = setup();
  try {
    assert.equal((await add(lib, put, 1, { '--for': 'side' })).code, 0);
    const ref = lines(lib)[0]! as { id: string; file: string; link: string };
    const shown = await refs(lib, ['show', ref.id]);
    assert.equal(shown.code, 0, shown.text);
    assert.ok(shown.out.includes(NOTES.trim()), 'every line of the notes');
    assert.ok(shown.out.includes(join(lib, ref.file)));
    assert.ok(shown.out.includes(ref.link));
    assert.ok(shown.out.includes('side'));
    const json = JSON.parse((await refs(lib, ['show', ref.id, '--json'])).out) as { id: string; notes: string; path: string };
    assert.deepEqual([json.id, json.notes, json.path], [ref.id, NOTES.trim(), join(lib, ref.file)]);
    const unknown = await refs(lib, ['show', 'no-such-ref']);
    assert.equal(unknown.code, 1);
  } finally {
    done();
  }
});

test('--image downloads a picture over https only, an image only, 10 MB at most, and a failed download keeps nothing', async () => {
  const { lib, put, done } = setup();
  const { server, url } = await serve((req, res) => {
    if (req.url === '/shot.png') res.writeHead(200, { 'content-type': 'image/png' }).end(picture(7));
    else if (req.url === '/page.txt') res.writeHead(200, { 'content-type': 'text/plain' }).end('not a picture at all');
    else if (req.url === '/fake.png') res.writeHead(200, { 'content-type': 'image/png' }).end('<html><script>alert(1)</script></html>');
    else if (req.url === '/huge.png') res.writeHead(200, { 'content-type': 'image/png' }).end(Buffer.concat([PNG, Buffer.alloc(10 * 1024 * 1024)]));
    else res.writeHead(404).end();
  });
  // A server on this machine cannot speak https: the tests relax it through SZ_REFS_ALLOW_HTTP, and only them.
  const TESTS_ONLY = { SZ_REFS_ALLOW_HTTP: '1' };
  const image = (address: string, env: Record<string, string> = {}): Promise<Ran> => refs(lib, ['add', '--kind', 'Sign in', '--product', 'Toss', '--what', 'first screen', '--link', 'https://example.com/screens/9', '--image', address, '--notes', put('notes.md', NOTES)], env);
  try {
    const plain = await image(`${url}/shot.png`);
    assert.equal(plain.code, 1, plain.text);
    assert.match(plain.text, /https/);
    for (const [path, says] of [['/page.txt', /not a picture|image/i], ['/fake.png', /not a picture|image/i], ['/huge.png', /10 MB/], ['/missing.png', /404/]] as const) {
      const refused = await image(`${url}${path}`, TESTS_ONLY);
      assert.equal(refused.code, 1, `${path}: ${refused.text}`);
      assert.match(refused.text, says, path);
    }
    const both = await refs(lib, ['add', '--kind', 'Sign in', '--product', 'Toss', '--what', 'first screen', '--link', 'https://example.com/screens/9', '--image', `${url}/shot.png`, '--file', put('a.png', picture(1)), '--notes', put('notes.md', NOTES)], TESTS_ONLY);
    assert.equal(both.code, 1, 'a picture comes from one place');
    assert.deepEqual(lines(lib), [], 'nothing refused was kept');
    assert.deepEqual(shots(lib), []);
    const kept = await image(`${url}/shot.png`, TESTS_ONLY);
    assert.equal(kept.code, 0, kept.text);
    const ref = lines(lib)[0]!;
    assert.equal(ref.sha256, sha(picture(7)));
    assert.match(ref.file as string, /\.png$/);
    assert.deepEqual(readFileSync(join(lib, ref.file as string)), picture(7));
  } finally {
    server.close();
    done();
  }
});

test('eight agents adding at the same moment all keep their line', async () => {
  const { lib, put, done } = setup();
  try {
    const ran = await Promise.all(Array.from({ length: 8 }, (_, i) => add(lib, put, i + 1, { '--product': `Product ${i + 1}` })));
    for (const one of ran) assert.equal(one.code, 0, one.text);
    const all = lines(lib);
    assert.equal(all.length, 8, 'no line was lost');
    assert.equal(new Set(all.map((ref) => ref.id)).size, 8);
    assert.equal(shots(lib).length, 8);
    assert.ok(!existsSync(join(lib, 'index.jsonl.lock')), 'the lock is let go');
    assert.deepEqual(readdirSync(lib).filter((name) => name.endsWith('.tmp')), [], 'no half-written index is left behind');
  } finally {
    done();
  }
});
