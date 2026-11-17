// `sz-eyes web sweep`: every screen of a page measured in one go, in one browser, and everything it finds said
// at once. Agents measured screen after screen with one `web look` each, a browser started every time, and ran
// out of time before the last; and "nothing is cut off on any screen" was shown false again and again because
// each look tried one more place.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { planScreens, screensFrom } from '../src/sweep.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, '../src/cli.ts');

// Six screens shown by hash, one at a time: HM-02 has text cut off, HM-03 a button under 44px, the rest hold.
// A hash the page does not know shows the first screen, as a router does. HM-02's words come from the server
// 700 ms after it is shown, as a screen's data does: a sweep that measured it before it settled would find it holds.
const PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Screens</title>
<style>
body{margin:0;font:16px/1.5 system-ui,sans-serif;color:#111;background:#fff}
section{display:none;padding:24px;min-height:320px}
section.on{display:block}
button{min-width:44px;min-height:44px;font:inherit;color:#111;background:#fff;border:1px solid #111;padding:8px 16px}
.cut{width:120px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.tiny{width:30px;height:30px;min-width:0;min-height:0;padding:0}
</style></head><body>
<section data-screen="HM-01"><h1>Home</h1><p>Welcome back.</p><button>Start</button></section>
<section data-screen="HM-02"><h1>Notes</h1><p class="cut" id="note">…</p></section>
<section data-screen="HM-03"><h1>Settings</h1><p>Close the panel.</p><button class="tiny">x</button></section>
<section data-screen="HM-04"><h1>Friends</h1><p>Nobody yet.</p><button>Invite</button></section>
<section data-screen="HM-05"><h1>Shop</h1><p>Nothing for sale today.</p></section>
<section data-screen="HM-06"><h1>Profile</h1><p>Your name goes here.</p><button>Edit</button></section>
<script>
function show(){const id=decodeURIComponent(location.hash.slice(1));const all=[...document.querySelectorAll('section')];const hit=all.find((s)=>s.dataset.screen===id)??all[0];for(const s of all)s.classList.toggle('on',s===hit);
if(hit.dataset.screen==='HM-02'){const note=document.getElementById('note');note.textContent='…';fetch('/note').then((r)=>r.text()).then((t)=>{note.textContent=t})}}
addEventListener('hashchange',show);show();
</script></body></html>`;

const ABOUT = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>About</title>
<style>body{margin:0;padding:24px;min-height:320px;font:16px/1.5 system-ui,sans-serif;color:#111;background:#fff}</style></head>
<body><h1>About</h1><p>A small page that holds at every size.</p></body></html>`;

let url = '';
let pageLoads = 0;
const server = createServer((req, res) => {
  const send = (r: ServerResponse, status: number, body: string): void => void r.writeHead(status, { 'content-type': 'text/html; charset=utf-8' }).end(body);
  const path = new URL(req.url ?? '/', 'http://here').pathname;
  if (path === '/') {
    pageLoads++;
    send(res, 200, PAGE);
  } else if (path === '/about') send(res, 200, ABOUT);
  else if (path === '/note') setTimeout(() => send(res, 200, 'This sentence is far too long to fit inside its narrow box'), 700);
  else send(res, 404, '<!doctype html><title>Not found</title><h1>Not found</h1>');
});
const folders: string[] = [];
const folder = (): string => {
  const made = mkdtempSync(join(tmpdir(), 'eyes-sweep-'));
  folders.push(made);
  return made;
};

before(async () => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  url = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}/`;
});
after(() => {
  server.close();
  for (const made of folders) rmSync(made, { recursive: true, force: true });
});

/** The command line in a process of its own, not waited on: the test's own server has to keep answering it. */
const sweep = (...args: string[]): Promise<{ code: number | null; out: string; err: string }> =>
  new Promise((done, fail) => {
    const child = spawn(process.execPath, [CLI, 'web', 'sweep', ...args]);
    let out = '';
    let err = '';
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => (out += chunk));
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => (err += chunk));
    child.on('error', fail);
    child.on('close', (code) => done({ code, out, err }));
  });

/** Why no browser could be started for this test, when none could: it is skipped, and says so. */
function cannotLook(run: { code: number | null; err: string }): string | null {
  if (run.code === 3) return "the session's command sandbox stopped the browser: run the suite outside it";
  if (/Chromium distribution 'chrome' is not found|Executable doesn't exist/.test(run.err)) return 'no Chrome on this machine';
  return null;
}

/** The screens' names as the text gives them, in order: each block opens with the name and the address. */
const namesIn = (text: string): string[] => [...text.matchAll(/^(\S+) {2}(?:http|file):\S+$/gm)].map((m) => m[1]!);

/** Each screen's block of text, by name. */
function blocks(text: string): Map<string, string> {
  const found = new Map<string, string>();
  const parts = text.split(/^(?=\S+ {2}(?:http|file):\S+$)/m).slice(1);
  for (const part of parts) found.set(part.split(' ')[0]!, part.split(/\n\n/)[0]!);
  return found;
}

const lastLine = (text: string): string => text.trimEnd().split('\n').at(-1)!;

test('every screen given is measured in one go, in the order given, and each one that does not hold is said with what it found', async (t) => {
  const out = folder();
  const loadsBefore = pageLoads;
  const run = await sweep(url, '--hash', 'HM-01', '--hash', 'HM-02', '--hash', 'HM-03', '--hash', 'HM-04', '--hash', 'HM-05', '--hash', 'HM-06', '--path', '/about', '--path', '/missing', '--out', out);
  const why = cannotLook(run);
  if (why) return t.skip(why);
  assert.equal(run.code, 1, `${run.out}\n${run.err}`);
  assert.deepEqual(namesIn(run.out), ['HM-01', 'HM-02', 'HM-03', 'HM-04', 'HM-05', 'HM-06', 'about', 'missing'], run.out);

  const by = blocks(run.out);
  for (const name of ['HM-01', 'HM-04', 'HM-05', 'HM-06', 'about']) assert.match(by.get(name)!, /nothing above minor/, `${name}:\n${by.get(name)}`);
  assert.match(by.get('HM-02')!, /^ {2}- (major|blocker) responsive\/clipped-text: /m, by.get('HM-02'));
  assert.doesNotMatch(by.get('HM-02')!, /touch\/target-size/);
  assert.match(by.get('HM-03')!, /^ {2}- (major|blocker) touch\/target-size: /m, by.get('HM-03'));
  assert.doesNotMatch(by.get('HM-03')!, /clipped-text/);
  assert.match(by.get('missing')!, /could not be opened[^\n]*404/, by.get('missing'));

  // A picture of every screen that opened, named by its hash or its path; none of one that did not.
  const pictures = readdirSync(out).sort();
  assert.deepEqual(pictures, ['HM-01-phone.png', 'HM-02-phone.png', 'HM-03-phone.png', 'HM-04-phone.png', 'HM-05-phone.png', 'HM-06-phone.png', 'about-phone.png']);

  // One summary line: how many screens, how many hold, how many findings in all, and which do not hold.
  const findings = run.out.split('\n').filter((line) => /^ {2}- (blocker|major) /.test(line)).length;
  assert.equal(findings, 2, run.out);
  assert.match(lastLine(run.out), new RegExp(`^8 screens, 5 hold, ${findings} findings above minor in all; not holding: HM-02, HM-03, missing\\b`), lastLine(run.out));

  // Six screens of one page are one load of it: a hash is changed on the page that is open, not reloaded.
  assert.equal(pageLoads - loadsBefore, 1, 'the page was loaded once for its six hash screens');
});

test('a sweep in which every screen holds exits 0, and a hash that shows nothing different is no error', async (t) => {
  const out = folder();
  const run = await sweep(url, '--hash', 'HM-01', '--hash', 'HM-04', '--hash', 'nowhere', '--path', '/about', '--size', 'desktop', '--out', out);
  const why = cannotLook(run);
  if (why) return t.skip(why);
  assert.equal(run.code, 0, `${run.out}\n${run.err}`);
  assert.deepEqual(namesIn(run.out), ['HM-01', 'HM-04', 'nowhere', 'about']);
  assert.match(lastLine(run.out), /^4 screens, 4 hold, 0 findings above minor in all/);
  assert.doesNotMatch(run.out, /could not be opened/);
  assert.deepEqual(readdirSync(out).sort(), ['HM-01-desktop.png', 'HM-04-desktop.png', 'about-desktop.png', 'nowhere-desktop.png']);
});

test('screens come from a file as well, a line each, mixed with the ones given on the command line, in the order given', async (t) => {
  const out = folder();
  const list = join(out, 'screens.txt');
  writeFileSync(list, `#HM-02\n\n/about\n  #HM-01  \n/missing\n${url}#HM-05\n`);
  const run = await sweep(url, '--hash', 'HM-06', '--from', list, '--path', '/about', '--out', join(out, 'pictures'));
  const why = cannotLook(run);
  if (why) return t.skip(why);
  assert.equal(run.code, 1, `${run.out}\n${run.err}`);
  assert.deepEqual(namesIn(run.out), ['HM-06', 'HM-02', 'about', 'HM-01', 'missing', 'HM-05', 'about-2']);
  const by = blocks(run.out);
  assert.match(by.get('HM-02')!, /responsive\/clipped-text/);
  assert.match(by.get('missing')!, /could not be opened/);
  for (const name of ['HM-06', 'about', 'HM-01', 'HM-05', 'about-2']) assert.match(by.get(name)!, /nothing above minor/, name);
  assert.match(lastLine(run.out), /^7 screens, 5 hold, 1 finding above minor in all; not holding: HM-02, missing\b/);
  assert.ok(existsSync(join(out, 'pictures', 'about-2-phone.png')), 'a name given twice is kept apart, not written over');
});

test('--json gives the same as an object: for each screen its name, address, picture and findings', async (t) => {
  const out = folder();
  const run = await sweep(url, '--hash', 'HM-01', '--hash', 'HM-03', '--path', '/missing', '--json', '--out', out);
  const why = cannotLook(run);
  if (why) return t.skip(why);
  assert.equal(run.code, 1, `${run.out}\n${run.err}`);
  const swept = JSON.parse(run.out) as { screens: { name: string; address: string; picture: string | null; error: string | null; holds: boolean; findings: { rule: string; severity: string }[] }[]; holding: number; findingsAboveMinor: number; notHolding: string[] };
  assert.deepEqual(swept.screens.map((s) => [s.name, s.address, s.holds]), [['HM-01', `${url}#HM-01`, true], ['HM-03', `${url}#HM-03`, false], ['missing', `${url}missing`, false]]);
  assert.equal(swept.screens[0]!.picture, join(out, 'HM-01-phone.png'));
  assert.ok(existsSync(swept.screens[1]!.picture!));
  assert.equal(swept.screens[2]!.picture, null);
  assert.match(swept.screens[2]!.error ?? '', /404/);
  assert.ok(swept.screens[1]!.findings.some((f) => f.rule === 'touch/target-size' && f.severity !== 'minor'), JSON.stringify(swept.screens[1]!.findings));
  assert.ok(swept.screens[0]!.findings.every((f) => f.severity === 'minor'));
  assert.deepEqual([swept.holding, swept.findingsAboveMinor, swept.notHolding], [1, 1, ['HM-03', 'missing']]);
});

test('a file of screens is read a line each, and a line that is none of the three is refused with its number', () => {
  assert.deepEqual(screensFrom('#HM-01\n\n  /battle/3 \nhttp://localhost:5173/x#a\n#/deep/route\n'), [
    { kind: 'hash', id: 'HM-01' },
    { kind: 'path', path: '/battle/3' },
    { kind: 'address', address: 'http://localhost:5173/x#a' },
    { kind: 'hash', id: '/deep/route' },
  ]);
  assert.throws(() => screensFrom('#HM-01\nbattle/3\n'), /line 2/);
  assert.throws(() => screensFrom('# a note\n'), /line 1/);
  assert.deepEqual(
    planScreens('http://localhost:5173/app/#start', [{ kind: 'hash', id: 'HM-01' }, { kind: 'path', path: '/battle/3' }, { kind: 'path', path: '/' }, { kind: 'address', address: 'http://localhost:5173/app/#HM-09' }, { kind: 'hash', id: '/deep/route' }, { kind: 'hash', id: 'HM-01' }]),
    [
      { name: 'HM-01', address: 'http://localhost:5173/app/#HM-01' },
      { name: 'battle-3', address: 'http://localhost:5173/battle/3' },
      { name: 'root', address: 'http://localhost:5173/' },
      { name: 'HM-09', address: 'http://localhost:5173/app/#HM-09' },
      { name: 'deep-route', address: 'http://localhost:5173/app/#/deep/route' },
      { name: 'HM-01-2', address: 'http://localhost:5173/app/#HM-01' },
    ],
  );
});

test('the usage puts the sweep beside web look and says when to use it', () => {
  const help = spawnSync(process.execPath, [CLI, 'help'], { encoding: 'utf8' }).stdout;
  assert.match(help, /web look[\s\S]*sz-eyes web sweep <address> \(--hash <id>\.\.\. \| --path <path>\.\.\. \| --from <file>\)[\s\S]*before saying that no screen is cut off[\s\S]*sz-eyes web do/);
});
