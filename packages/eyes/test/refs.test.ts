// The house reference library: pictures of how shipped products do a screen, each with what is seen in it,
// kept on the owner's machine so that every pull from a reference service leaves something behind. Run through
// the real command line with SZ_REFS_DIR pointing at a folder of the test's own.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
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

// Correcting and taking out: on the library's first day two agents edited index.jsonl by hand, one because a
// description overstated what the screen shows, one because an entry was kept with a wrong link. Hand edits of an
// index other agents are writing at the same moment are how a library loses lines.

/** The library's index as it is on disk, to see that a refusal changed nothing. */
const indexBytes = (lib: string): Buffer => readFileSync(join(lib, 'index.jsonl'));
/** A kind's page, written through the command line (80 characters at least). */
const page = (lib: string, put: (name: string, body: string | Buffer) => string, kind: string, body: string): Promise<Ran> =>
  refs(lib, ['kind', kind, '--write', put(`page-${body.length}.md`, `# ${kind}\n\n${body}\n`)]);
const PAGE = 'Ask for one thing first and keep everything else for after it: every kept reference of this kind does that.';

test('edit: the fields given change, the rest stay, the id and the picture stay, and each change is said as it was and as it is', async () => {
  const { lib, put, done } = setup();
  try {
    assert.equal((await add(lib, put, 1, { '--platform': 'ios', '--lang': 'ko', '--for': 'side' })).code, 0);
    assert.equal((await add(lib, put, 2)).code, 0);
    const [before, other] = lines(lib) as [Record<string, unknown>, Record<string, unknown>];
    const id = before.id as string;
    const ran = await refs(lib, ['edit', id, '--what', 'phone number first']);
    assert.equal(ran.code, 0, ran.text);
    const [after, untouched] = lines(lib) as [Record<string, unknown>, Record<string, unknown>];
    assert.deepEqual(after, { ...before, what: 'phone number first' }, 'only what changed: the id, the picture and every other field stay');
    assert.deepEqual(untouched, other, 'another reference is left as it was');
    assert.deepEqual(readFileSync(join(lib, before.file as string)), picture(1));
    assert.ok(ran.out.includes(id), ran.out);
    assert.match(ran.out, /what\s+was\s+phone number first, terms later\n\s+now\s+phone number first/);
    assert.doesNotMatch(ran.out, /^\s+(kind|product|platform|lang|notes|from)\s/m, 'a field that did not change is not listed');

    // Several at once; the notes are said as replaced, with how many characters they now hold.
    const more = await refs(lib, ['edit', id, '--notes', put('ko.md', NOTES_KO), '--platform', 'web', '--lang', 'en', '--product', 'Toss Bank', '--link', 'https://example.com/screens/1b']);
    assert.equal(more.code, 0, more.text);
    assert.deepEqual(lines(lib)[0], { ...after, notes: NOTES_KO.trim(), platform: 'web', lang: 'en', product: 'Toss Bank', link: 'https://example.com/screens/1b' });
    assert.match(more.out, new RegExp(`notes\\s+replaced, ${[...NOTES_KO.trim()].length} characters`));
    assert.match(more.out, /platform\s+was\s+ios\n\s+now\s+web/);
    assert.match(more.out, /lang\s+was\s+ko\n\s+now\s+en/);
    assert.match(more.out, /product\s+was\s+Toss\n\s+now\s+Toss Bank/);
    assert.match(more.out, /from\s+was\s+https:\/\/example\.com\/screens\/1\n\s+now\s+https:\/\/example\.com\/screens\/1b/);
    const json = JSON.parse((await refs(lib, ['edit', id, '--lang', 'ja', '--json'])).out) as { ref: { id: string; lang: string; path: string }; changes: { field: string; was: unknown; now: unknown }[] };
    assert.deepEqual([json.ref.id, json.ref.lang, json.ref.path], [id, 'ja', join(lib, before.file as string)]);
    assert.deepEqual(json.changes, [{ field: 'lang', was: 'en', now: 'ja' }]);

    // The same again changes nothing, and says so.
    const index = indexBytes(lib);
    const same = await refs(lib, ['edit', id, '--platform', 'web', '--what', 'phone number first']);
    assert.equal(same.code, 0, same.text);
    assert.match(same.out, /nothing changed/);
    assert.deepEqual(indexBytes(lib), index);

    // Nothing to change, what edit does not take, and words past the id are refused, and nothing changes.
    for (const [args, says] of [
      [['edit', id], /what to change/],
      [['edit', '--what', 'a screen'], /which reference/],
      [['edit', id, '--file', put('other.png', picture(9))], /another picture is another reference.*refs remove/],
      [['edit', id, '--what', 'phone', 'number'], /one id/],
      [['edit', id, '--platform', 'tv'], /--platform is one of/],
      [['edit', id, '--lang', 'korean language'], /--lang takes a language tag/],
      [['edit', id, '--kind', '!!!'], /--kind "!!!" has no letter or digit/],
      [['edit', id, '--link', 'not an address'], /--link not an address is not an address/],
    ] as const) {
      const refused = await refs(lib, [...args]);
      assert.equal(refused.code, 1, `${args.join(' ')}: ${refused.text}`);
      assert.match(refused.text, says, args.join(' '));
    }
    assert.deepEqual(indexBytes(lib), index, 'nothing refused changed the index');
  } finally {
    done();
  }
});

test('edit --kind moves the picture into the new kind, its name and hash kept, and find --kind finds it there and not under the old', async () => {
  const { lib, put, done } = setup();
  try {
    assert.equal((await add(lib, put, 1)).code, 0);
    assert.equal((await add(lib, put, 2)).code, 0);
    assert.equal((await add(lib, put, 3, { '--kind': '결제', '--product': 'Kakao Pay', '--notes': put('pay.md', NOTES_PAY) })).code, 0);
    assert.equal((await page(lib, put, 'Sign in', PAGE)).code, 0);
    assert.equal((await page(lib, put, '결제', PAGE)).code, 0);
    const [first, second, pay] = lines(lib) as { id: string; file: string; sha256: string }[];

    // Into a kind that is kept already: both kinds' pages were written before the change, and it says so.
    const ran = await refs(lib, ['edit', first!.id, '--kind', '결제']);
    assert.equal(ran.code, 0, ran.text);
    const moved = lines(lib)[0]! as { id: string; kind: string; file: string; sha256: string };
    assert.deepEqual([moved.id, moved.kind, moved.sha256], [first!.id, '결제', first!.sha256], 'the id and the picture stay');
    assert.equal(moved.file, `shots/결제/${basename(first!.file)}`, 'the file keeps its name, and so its hash');
    assert.deepEqual(readFileSync(join(lib, moved.file)), picture(1));
    assert.ok(!existsSync(join(lib, first!.file)), 'nothing is left in the old kind’s folder');
    assert.equal(shots(lib).length, 3);
    assert.match(ran.out, /kind\s+was\s+Sign in\n\s+now\s+결제/);
    assert.ok(ran.out.includes(join(lib, first!.file)) && ran.out.includes(join(lib, moved.file)), 'where the picture was and where it is');
    assert.doesNotMatch(ran.out, /new kind/);
    for (const kind of ['Sign in', '결제']) assert.match(ran.out, new RegExp(`page of "${kind}" .*was written before this change`), kind);

    const underNew = await refs(lib, ['find', '--kind', '결제']);
    assert.ok(underNew.out.includes(first!.id) && underNew.out.includes(pay!.id), underNew.out);
    const underOld = await refs(lib, ['find', '--kind', 'sign in']);
    assert.ok(!underOld.out.includes(first!.id) && underOld.out.includes(second!.id), underOld.out);
    assert.deepEqual(JSON.parse((await refs(lib, ['kinds', '--json'])).out).map((k: { kind: string; count: number }) => [k.kind, k.count]), [['결제', 2], ['Sign in', 1]]);

    // Into a kind nobody has kept: the kinds there are are listed, as add does; a kind given in another case is the kind kept.
    const fresh = await refs(lib, ['edit', second!.id, '--kind', 'Log in']);
    assert.equal(fresh.code, 0, fresh.text);
    assert.match(fresh.out, /"Log in" is a new kind\. Kinds already kept: 결제 \(2\)/);
    assert.equal((lines(lib)[1] as { file: string }).file, `shots/log-in/${basename(second!.file)}`);
    assert.match(fresh.out, /"Sign in" holds no reference now/, 'the kind it left is empty');
    // The same kind in another case: a kind nobody else holds takes the name given now, and its picture stays where it is.
    const cased = await refs(lib, ['edit', second!.id, '--kind', 'log IN']);
    assert.equal(cased.code, 0, cased.text);
    assert.deepEqual([(lines(lib)[1] as { kind: string }).kind, (lines(lib)[1] as { file: string }).file], ['log IN', `shots/log-in/${basename(second!.file)}`]);
    assert.doesNotMatch(cased.out, /new kind/);
    // A kind others hold keeps the name it was first given, whatever case it is given in.
    const joined = await refs(lib, ['edit', second!.id, '--kind', '결제']);
    assert.equal(joined.code, 0, joined.text);
    const same = await refs(lib, ['edit', pay!.id, '--kind', '결제']);
    assert.match(same.out, /nothing changed/);
    assert.equal(shots(lib).length, 3);
    assert.deepEqual(readdirSync(join(lib, 'shots')).sort(), ['결제'], 'a kind’s folder left empty is taken away');
  } finally {
    done();
  }
});

test('edit: notes that say almost nothing are refused, as add refuses them, and nothing changes', async () => {
  const { lib, put, done } = setup();
  try {
    assert.equal((await add(lib, put, 1)).code, 0);
    const id = lines(lib)[0]!.id as string;
    const index = indexBytes(lib);
    const short = await refs(lib, ['edit', id, '--notes', put('short.md', '로그인 화면. 깔끔함.\n'), '--what', 'a better line']);
    assert.equal(short.code, 1, short.text);
    assert.match(short.text, /80/);
    const missing = await refs(lib, ['edit', id, '--notes', join(lib, 'nowhere.md')]);
    assert.equal(missing.code, 1, missing.text);
    assert.match(missing.text, /no such file/);
    assert.deepEqual(indexBytes(lib), index, 'nothing changed, not even the field given beside the notes');
  } finally {
    done();
  }
});

test('edit --link: an address another reference has is refused, however it is written', async () => {
  const { lib, put, done } = setup();
  try {
    assert.equal((await add(lib, put, 1)).code, 0);
    assert.equal((await add(lib, put, 2)).code, 0);
    const [first, second] = lines(lib) as { id: string; link: string }[];
    const index = indexBytes(lib);
    for (const link of ['https://example.com/screens/2', 'https://EXAMPLE.com/screens/2']) {
      const refused = await refs(lib, ['edit', first!.id, '--link', link]);
      assert.equal(refused.code, 1, refused.text);
      assert.ok(refused.text.includes(second!.id), `it says which reference has it: ${refused.text}`);
      assert.match(refused.text, /kept once/);
    }
    assert.deepEqual(indexBytes(lib), index);
    const own = await refs(lib, ['edit', first!.id, '--link', 'https://example.com/screens/1']);
    assert.equal(own.code, 0, own.text);
    assert.match(own.out, /nothing changed/, 'its own address is not another’s');
  } finally {
    done();
  }
});

test('remove: the line and the picture are gone, it says what was removed so it can be kept again, and show then says it is not there', async () => {
  const { lib, put, done } = setup();
  try {
    assert.equal((await add(lib, put, 1, { '--platform': 'ios' })).code, 0);
    assert.equal((await add(lib, put, 2)).code, 0);
    const [gone, stays] = lines(lib) as { id: string; file: string; link: string }[];
    const ran = await refs(lib, ['remove', gone!.id]);
    assert.equal(ran.code, 0, ran.text);
    for (const said of [gone!.id, 'Sign in', 'Toss', 'phone number first, terms later', gone!.link, NOTES.trim(), 'sz-eyes refs add']) assert.ok(ran.out.includes(said), `it says ${said}:\n${ran.out}`);
    assert.deepEqual(lines(lib).map((ref) => ref.id), [stays!.id]);
    assert.ok(!existsSync(join(lib, gone!.file)), 'its picture is deleted');
    assert.deepEqual(readFileSync(join(lib, stays!.file)), picture(2), 'the other picture is left as it was');
    assert.equal(shots(lib).length, 1);
    const shown = await refs(lib, ['show', gone!.id]);
    assert.equal(shown.code, 1, shown.text);
    assert.match(shown.text, new RegExp(`no reference ${gone!.id} is kept`));
    // --json gives the whole entry that was removed, notes and all.
    const json = JSON.parse((await refs(lib, ['remove', stays!.id, '--json'])).out) as { removed: { id: string; notes: string; link: string } };
    assert.deepEqual([json.removed.id, json.removed.notes, json.removed.link], [stays!.id, NOTES.trim(), stays!.link]);
    assert.deepEqual(lines(lib), []);
    // A link removed can be kept again.
    const again = await add(lib, put, 1);
    assert.equal(again.code, 0, again.text);
    assert.match(again.out, /^kept: /);
  } finally {
    done();
  }
});

test('a line that names a picture outside the library (a line put there by hand): remove takes the line out and leaves that file, and edit --kind does not move it', async () => {
  const { lib, input, put, done } = setup();
  try {
    assert.equal((await add(lib, put, 1)).code, 0);
    assert.equal((await add(lib, put, 2)).code, 0);
    const outside = put('not-the-librarys.png', picture(9));
    const byHand = lines(lib).map((ref, i) => ({ ...ref, file: i === 0 ? join('..', 'input', 'not-the-librarys.png') : ref.file }));
    writeFileSync(join(lib, 'index.jsonl'), byHand.map((ref) => JSON.stringify(ref)).join('\n') + '\n');
    const [astray, stays] = lines(lib) as { id: string; file: string }[];

    const moved = await refs(lib, ['edit', astray!.id, '--kind', 'Pay']);
    assert.equal(moved.code, 1, moved.text);
    assert.match(moved.text, /nothing was changed/);
    assert.deepEqual(readFileSync(outside), picture(9), 'a file outside the library is not moved');

    const ran = await refs(lib, ['remove', astray!.id]);
    assert.equal(ran.code, 0, ran.text);
    assert.deepEqual(lines(lib).map((ref) => ref.id), [stays!.id], 'its line is out');
    assert.deepEqual(readFileSync(outside), picture(9), 'a file outside the library is not deleted');
    assert.ok(existsSync(input));
  } finally {
    done();
  }
});

test('an id that is not kept is refused with exit 1, naming the closest ids when a prefix matches, and nothing changes', async () => {
  const { lib, put, done } = setup();
  try {
    assert.equal((await add(lib, put, 1)).code, 0);
    assert.equal((await add(lib, put, 2, { '--product': 'Kakao Pay' })).code, 0);
    const [toss, kakao] = lines(lib) as { id: string }[];
    const index = indexBytes(lib);
    for (const command of [['edit', '--what', 'another line'], ['remove'], ['show']]) {
      const typo = `${toss!.id.slice(0, -1)}z`;
      const near = await refs(lib, [command[0]!, typo, ...command.slice(1)]);
      assert.equal(near.code, 1, near.text);
      assert.match(near.text, new RegExp(`no reference ${typo} is kept`));
      assert.ok(near.text.includes(toss!.id) && !near.text.includes(kakao!.id), `the closest id, and only it: ${near.text}`);
      const prefix = await refs(lib, [command[0]!, 'kakao', ...command.slice(1)]);
      assert.equal(prefix.code, 1, prefix.text);
      assert.ok(prefix.text.includes(kakao!.id) && !prefix.text.includes(toss!.id), prefix.text);
      const far = await refs(lib, [command[0]!, 'zebra-0000', ...command.slice(1)]);
      assert.equal(far.code, 1, far.text);
      assert.match(far.text, /no reference zebra-0000 is kept/);
      assert.ok(!far.text.includes(toss!.id) && !far.text.includes(kakao!.id), far.text);
    }
    assert.deepEqual(indexBytes(lib), index);
    assert.equal(shots(lib).length, 2);
  } finally {
    done();
  }
});

test('a kind a remove leaves empty keeps its page, and kinds lists it with 0', async () => {
  const { lib, put, done } = setup();
  try {
    assert.equal((await add(lib, put, 1)).code, 0);
    assert.equal((await add(lib, put, 2, { '--kind': '결제', '--notes': put('pay.md', NOTES_PAY) })).code, 0);
    assert.equal((await page(lib, put, 'Sign in', PAGE)).code, 0);
    const pagePath = join(lib, 'kinds', 'sign-in.md');
    const written = readFileSync(pagePath, 'utf8');
    const [signIn, pay] = lines(lib) as { id: string }[];

    const ran = await refs(lib, ['remove', signIn!.id]);
    assert.equal(ran.code, 0, ran.text);
    assert.match(ran.out, /"Sign in" holds no reference now/);
    assert.match(ran.out, /page .*stays/);
    assert.match(ran.out, /refs kinds lists .*0/);
    assert.equal(readFileSync(pagePath, 'utf8'), written, 'the page is the owner’s writing, and stays as it was');
    const kinds = await refs(lib, ['kinds']);
    assert.equal(kinds.code, 0, kinds.text);
    assert.match(kinds.out, /Sign in\s+0/);
    assert.match(kinds.out, /결제\s+1/);
    assert.deepEqual(JSON.parse((await refs(lib, ['kinds', '--json'])).out).map((k: { kind: string; count: number; page: boolean }) => [k.kind, k.count, k.page]), [['결제', 1, false], ['Sign in', 0, true]]);
    const kind = await refs(lib, ['kind', 'Sign in']);
    assert.equal(kind.code, 0, kind.text);
    assert.ok(kind.out.includes(PAGE), `the page can still be read: ${kind.out}`);

    // A kind with no page that is left empty is no longer listed; the pages that stay are, even with nothing kept.
    const last = await refs(lib, ['remove', pay!.id]);
    assert.equal(last.code, 0, last.text);
    assert.match(last.out, /"결제" holds no reference now/);
    const none = await refs(lib, ['kinds']);
    assert.match(none.out, /Sign in\s+0/);
    assert.doesNotMatch(none.out, /결제/);
  } finally {
    done();
  }
});

test('four edits and four removes of different references at the same moment all take effect, and no line is lost', async () => {
  const { lib, put, done } = setup();
  try {
    const added = await Promise.all(Array.from({ length: 8 }, (_, i) => add(lib, put, i + 1, { '--product': `Product ${i + 1}` })));
    for (const one of added) assert.equal(one.code, 0, one.text);
    const before = lines(lib) as { id: string; product: string; file: string }[];
    const byProduct = (n: number): { id: string; file: string } => before.find((ref) => ref.product === `Product ${n}`)!;
    const ran = await Promise.all([
      refs(lib, ['edit', byProduct(1).id, '--what', 'edited one']),
      refs(lib, ['edit', byProduct(2).id, '--kind', 'Log in']),
      refs(lib, ['edit', byProduct(3).id, '--kind', 'Log in', '--what', 'edited three']),
      refs(lib, ['edit', byProduct(4).id, '--notes', put('pay.md', NOTES_PAY)]),
      ...[5, 6, 7, 8].map((n) => refs(lib, ['remove', byProduct(n).id])),
    ]);
    for (const one of ran) assert.equal(one.code, 0, one.text);
    const after = lines(lib) as { id: string; kind: string; what: string; notes: string; file: string }[];
    assert.equal(after.length, 4, 'four removed, four kept');
    const find = (n: number): (typeof after)[number] => after.find((ref) => ref.id === byProduct(n).id)!;
    assert.equal(find(1).what, 'edited one');
    assert.equal(find(2).kind, 'Log in');
    assert.deepEqual([find(3).kind, find(3).what], ['Log in', 'edited three']);
    assert.equal(find(4).notes, NOTES_PAY.trim());
    for (const n of [5, 6, 7, 8]) {
      assert.ok(!after.some((ref) => ref.id === byProduct(n).id), `${n} is gone`);
      assert.ok(!existsSync(join(lib, byProduct(n).file)), `${n}'s picture is gone`);
    }
    for (const ref of after) assert.ok(existsSync(join(lib, ref.file)), `${ref.id}'s picture is where its line says`);
    assert.equal(shots(lib).length, 4);
    assert.ok(!existsSync(join(lib, 'index.jsonl.lock')), 'the lock is let go');
    assert.deepEqual(readdirSync(lib).filter((name) => name.endsWith('.tmp')), [], 'no half-written index is left behind');
  } finally {
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
