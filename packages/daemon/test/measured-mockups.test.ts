// A design task's mock-ups, measured: the screen spec they are drawn from, the walk through its core flow on a
// page that is operated with scripts off, the pictures and faces a page is given so that what is measured is
// what is shown, and the same audit a built screen gets. Chrome is real; the sandbox and the reviewer are scripted.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import { chromium, devices, type Browser } from 'playwright-core';
import type { AuditReport, Project } from '@studio-zero/protocol';
import { walkFlow, walkProblems } from '../src/qa/FlowWalker.ts';
import { SUPPLIED_FACES, withFaces } from '../src/qa/mockupFaces.ts';
import { MOCKUP_ASSET_DIR, MOCKUP_DIR, MockupRenderer } from '../src/qa/MockupRenderer.ts';
import type { QaBrowser, QaSession } from '../src/qa/QaBrowser.ts';
import type { QaVisionBridge } from '../src/qa/QaVisionBridge.ts';
import { walkApp } from '../src/qa/SmokeTester.ts';
import { toScreenReview, visionParts, type VisionInput, type VisionReply } from '../src/qa/vision.ts';
import { VisualAuditor } from '../src/qa/VisualAuditor.ts';
import type { OrbStackManager } from '../src/sandbox/OrbStackManager.ts';
import { SCREEN_SPEC_FILE, checkScreenSpec, readScreenSpec, renderScreenSpec } from '../src/scratch/ScreenSpec.ts';
import { COVERED, DEAD, FLOW_TASKS, FROZEN, OPERABLE, SCREEN_SPEC } from './fixtures-mockup.ts';
import { quietLog, sampleProject, testDaemon } from './helpers.ts';

async function launch(): Promise<Browser | null> {
  try {
    return await chromium.launch({ channel: 'chrome', headless: true, timeout: 15_000 });
  } catch {
    return null;
  }
}
const localBrowser = (browser: Browser): QaBrowser => ({ use: async <T>(_project: Project, _signal: AbortSignal | undefined, fn: (session: QaSession) => Promise<T>) => fn({ browser, host: '127.0.0.1', devices }) }) as unknown as QaBrowser;
/** A sandbox whose workspace holds exactly these files; a picture is held as the base64 the exec channel would carry. */
const sandboxWith = (files: Record<string, string>): { sandboxes: OrbStackManager; scripts: string[] } => {
  const scripts: string[] = [];
  const sandboxes = {
    exec: async (_project: Project, script: string) => {
      scripts.push(script);
      const file = Object.keys(files).find((name) => script.includes(`${name} ]`));
      return file ? { exitCode: 0, stdout: files[file]!, stderr: '', timedOut: false, durationMs: 1 } : { exitCode: 1, stdout: '', stderr: '', timedOut: false, durationMs: 1 };
    },
  } as unknown as OrbStackManager;
  return { sandboxes, scripts };
};
const phoneProject = { ...sampleProject('chores'), template: 'mobile-expo' } as const;

test('the screen spec check: a spec that holds, and what each miss says', () => {
  assert.deepEqual(checkScreenSpec(SCREEN_SPEC), []);
  assert.deepEqual(readScreenSpec(JSON.stringify(SCREEN_SPEC)), { ok: true, spec: SCREEN_SPEC });
  assert.deepEqual(readScreenSpec('{ not json'), { ok: false, problems: [`${SCREEN_SPEC_FILE} is not valid JSON.`] });
  assert.match((readScreenSpec({ coreMoment: 'x' }) as { problems: string[] }).problems.join('\n'), /screens: /, 'a missing part is named by its path');

  const problems = (change: (spec: typeof SCREEN_SPEC) => void): string => {
    const spec = structuredClone(SCREEN_SPEC);
    change(spec);
    return checkScreenSpec(spec).join('\n');
  };
  assert.match(problems((s) => void (s.coreMoment = '')), /coreMoment is empty/);
  assert.match(problems((s) => void (s.screens[0]!.id = 'home')), /screen home: the id must be one to three capital letters, a hyphen and two digits/);
  assert.match(problems((s) => void (s.screens[1]!.id = 'H-01')), /screen H-01: this id is used twice/);
  assert.match(problems((s) => void (s.screens[0]!.entry = [])), /screen H-01: entry is empty/);
  assert.match(problems((s) => void (s.screens[0]!.entry = ['S-01'])), /no screen can be reached from outside the product/);
  assert.match(problems((s) => void (s.screens[1]!.entry = ['Z-09'])), /screen S-01: entry names Z-09, which is not a screen in this spec/);
  assert.match(problems((s) => void (s.screens[0]!.elements[0]!.rule = '누름')), /screen H-01, element 1 \(집안일 줄\): rule is empty or a label/);
  assert.match(problems((s) => void (s.screens[0]!.elements[2]!.goesTo = 'S-02')), /element 3 \(집안일 고치기\): goesTo names S-02/);
  // The screen the product exists for is the one whose other states get forgotten.
  assert.match(problems((s) => void (s.screens[0]!.states = [])), /screen H-01: the core flow happens here, so say what it shows when the usual case does not hold/);
  assert.equal(problems((s) => void (s.screens[1]!.states = [])), '', 'a screen off the core flow may have only its usual state');
  assert.match(problems((s) => void (s.tasks = [])), /tasks is empty: state the core flow/);
  assert.match(problems((s) => void (s.tasks[0]!.id = 'Log')), /task Log: the id must be a short lowercase word/);
  assert.match(problems((s) => void (s.tasks[1]!.outcome = '없음')), /task undo: outcome is empty: say what is true on the screen once it is done/);
  assert.match(problems((s) => void (s.tasks[0]!.screen = 'S-01', (s.screens[1] as { later?: boolean }).later = true)), /task log: it happens on S-01, which is marked "later"/);
  assert.match(problems((s) => void (s.events = [])), /events is empty/);
  assert.match(problems((s) => void (s.events[0]!.name = 'choreLogged')), /event choreLogged: the name must be snake_case/);

  const text = renderScreenSpec(SCREEN_SPEC);
  assert.match(text, /^Core moment: 지우가 설거지를 끝내고 3초 안에 20분을 적는다\.\n\nCore flow:\n {2}1\. \[log\] on H-01: 설거지 20분을 적는다 → 오늘 칸에 지우의 기록이 남는다/);
  assert.match(text, /H-01 오늘 장부: 방금 한 집안일을 한 번 눌러 적는다\.\n {2}entry: 앱 실행 · 알림\n {2}1\. 집안일 줄: 누르면 오늘 칸에/);
  assert.match(text, /state "저장 실패": 적지 못했어요/);
  assert.match(text, /Events:\n {2}chore_logged: 기록이 저장될 때 \(measures 주간 기록 수\)/);
});

test('a mock-up page is given what it points at: its pictures from the asset folder and the theme faces it names, and nothing else', async () => {
  assert.deepEqual(SUPPLIED_FACES, ['Geist', 'Fraunces', 'Instrument Serif', 'Bricolage Grotesque']);
  const titled = withFaces('<!doctype html><html><head><title>t</title><style>h1{font-family:Fraunces,"Noto Serif KR",serif}body{font-family:Geist,sans-serif}</style></head><body></body></html>');
  assert.match(titled, /^<!doctype html><html><head><style data-studio-faces>@font-face\{font-family:"Geist";[^}]*src:url\(data:font\/woff2;base64,[A-Za-z0-9+/=]{1000,}\) format\("woff2"\)\}@font-face\{font-family:"Fraunces";/, 'the faces go in after <head>, where they cannot change how the page is parsed');
  assert.ok(!titled.includes('Instrument Serif') && !titled.includes('Bricolage'), 'a face the page does not name is not added');
  assert.equal(withFaces('<p>system-ui only</p>'), '<p>system-ui only</p>');
  assert.match(withFaces('<!DOCTYPE html><p style="font-family:Geist">x</p>'), /^<!DOCTYPE html><style data-studio-faces>/, 'with no <head>, after the doctype: never before it');

  const d = await testDaemon();
  try {
    const project = sampleProject('tide');
    const jpeg = Buffer.from('ffd8ffe000104a46494600', 'hex').toString('base64');
    const html = `<!doctype html><html><head><style>.hero{background:url('assets/bowl.jpg')}</style></head><body><img src="assets/bowl.jpg" alt="비빔밥"><img src="./assets/table.png" alt="식탁"><img src="assets/../../secret.png" alt=""><img src="https://example.com/assets/x.jpg" alt=""><img src="assets/missing.webp" alt=""></body></html>`;
    const fake = sandboxWith({ [`${MOCKUP_DIR}/a.html`]: html, [`${MOCKUP_ASSET_DIR}/bowl.jpg`]: jpeg, [`${MOCKUP_ASSET_DIR}/table.png`]: jpeg });
    const renderer = new MockupRenderer({ config: d.config, store: d.daemon.store, clock: Date.now, log: quietLog, browser: {} as QaBrowser, sandboxes: fake.sandboxes });
    const page = await renderer.page(project, `${MOCKUP_DIR}/a.html`);
    assert.ok(page);
    assert.equal(page.html.split(`data:image/jpeg;base64,${jpeg}`).length - 1, 2, 'the same picture, in the stylesheet and in the markup');
    assert.ok(page.html.includes(`<img src="data:image/png;base64,${jpeg}" alt="식탁">`));
    assert.ok(page.html.includes('src="assets/../../secret.png"') && page.html.includes('src="https://example.com/assets/x.jpg"') && page.html.includes('src="assets/missing.webp"'), 'a path out of the folder, an address elsewhere and a missing file are left as written');
    const read = fake.scripts.filter((s) => s.includes('base64'));
    assert.deepEqual(read.map((s) => /\[ -f (\S+) \]/.exec(s)![1]), [`${MOCKUP_ASSET_DIR}/bowl.jpg`, `${MOCKUP_ASSET_DIR}/table.png`, `${MOCKUP_ASSET_DIR}/missing.webp`], 'only plain names in the mock-ups\' own asset folder are ever read');
    assert.equal(await renderer.page(project, 'docs/prd.md'), null, 'only the three mock-up pages are served this way');
    assert.equal(await renderer.page(project, `${MOCKUP_DIR}/c.html`), null);
  } finally {
    await d.cleanup();
  }
});

test('the walk: a page with scripts off is operated through the core flow, and what it took is counted', async (t) => {
  const browser = await launch();
  if (!browser) return t.skip('headless Chrome cannot be launched here');
  const walkOn = async (html: string) => {
    const context = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, javaScriptEnabled: false, offline: true });
    try {
      const page = await context.newPage();
      await page.setContent(html, { waitUntil: 'load' });
      return await walkFlow(page, FLOW_TASKS, { touch: true });
    } finally {
      await context.close();
    }
  };
  try {
    const works = await walkOn(OPERABLE);
    assert.deepEqual(works.tasks, [
      { id: 'log', reached: true, stopped: null, stoppedAtStep: null, presses: 1, typed: 0, scrolls: 0, smallestTargetPx: 56, answered: 1, responseMs: 320 },
      { id: 'undo', reached: true, stopped: null, stoppedAtStep: null, presses: 1, typed: 0, scrolls: 0, smallestTargetPx: 56, answered: 1, responseMs: null },
    ], 'one press each; the stamp\'s 320ms arrival is what the first press set off');
    assert.deepEqual(works.frames.map((f) => [f.task, f.step]), [[null, null], [0, 1], [1, 1]], 'the screen at rest, then after each press');
    assert.ok(works.frames.every((f) => f.jpeg.subarray(0, 2).equals(Buffer.from([0xff, 0xd8]))), 'the film is pictures');
    assert.deepEqual(walkProblems(works, FLOW_TASKS, { touch: true }), []);

    // The mock-ups the studio used to get: one frozen moment, after the fact.
    const frozen = await walkOn(FROZEN);
    assert.deepEqual(frozen.tasks.map((task) => [task.id, task.reached, task.stopped, task.presses]), [['log', false, 'already-done', 0]], 'a flow is a sequence: nothing after a task that did not finish is walked');
    assert.match(walkProblems(frozen, FLOW_TASKS, { touch: true }).join('\n'), /task "log" \(설거지 20분을 적는다\): the page opens with \[data-done="log"\] already showing[\s\S]*task "undo" \(방금 적은 것을 되돌린다\) was not reached/);

    const covered = await walkOn(COVERED);
    assert.deepEqual(covered.tasks.map((task) => [task.stopped, task.stoppedAtStep, task.presses]), [['covered', 1, 0]]);
    assert.match(walkProblems(covered, FLOW_TASKS, { touch: true })[0]!, /the control for step 1 \(data-step="log:1"\) lies under another element at its centre/);

    const dead = await walkOn(DEAD);
    assert.deepEqual(dead.tasks.map((task) => [task.stopped, task.presses, task.answered, task.smallestTargetPx]), [['outcome-not-shown', 1, 0, 28]]);
    const said = walkProblems(dead, FLOW_TASKS, { touch: true });
    assert.match(said[0]!, /all 1 marked step\(s\) were pressed and nothing carrying data-done="log" became visible/);
    assert.match(said[1]!, /a control in it is 28px on its shorter side; a thumb needs 44px/);
    assert.match(said[2]!, /1 of its 1 control\(s\) look the same while held down as at rest/);
    assert.ok(!walkProblems(dead, FLOW_TASKS, { touch: false }).some((line) => line.includes('thumb')), 'target size is a touch-screen measure');

    // A field among the steps is typed into, and a page with none of the marks cannot be started.
    const typed = await walkOn(OPERABLE.replace('<label class="btn" for="s-logged" data-step="log:1">설거지 20분 적기</label>', '<input class="btn quiet" placeholder="분" data-step="log:1" data-sample="20"><label class="btn" for="s-logged" data-step="log:2">적기</label>'));
    assert.deepEqual(typed.tasks.map((task) => [task.id, task.reached, task.presses, task.typed]), [['log', true, 2, 2], ['undo', true, 1, 0]]);
    assert.deepEqual((await walkOn('<!doctype html><title>t</title><p>아무 표시도 없는 페이지</p>')).tasks.map((task) => [task.stopped, task.stoppedAtStep]), [['step-missing', 1]]);
  } finally {
    await browser.close();
  }
});

const GOOD: VisionReply = { archetype: 'mobile-app', slopScore: 12, critique: '도장이 화면의 주인입니다.', rubric: { hierarchy: 9, whitespace: 9, typography: 9, color: 9, copy: 9, originality: 9, tactility: 9 }, findings: [], redesignPatches: [] };

test('mock-ups are audited as a built screen is: sealed, each page a first screen in light and dark, one review per page', async (t) => {
  const browser = await launch();
  if (!browser) return t.skip('headless Chrome cannot be launched here');
  const hits: string[] = [];
  const server = createServer((req, res) => (hits.push(req.url ?? ''), res.end('x'))).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const d = await testDaemon();
  try {
    const { store, events } = d.daemon;
    store.insertProject(phoneProject);
    const calls: VisionInput[] = [];
    const vision = {
      availability: async () => ({ status: 'ready', paths: ['codex'], reason: null }),
      review: async (input: VisionInput) => {
        calls.push(input);
        return { review: toScreenReview(input.route.endsWith('b.html') ? { ...GOOD, slopScore: 44 } : GOOD, input), via: 'codex' as const, model: 'codex:default' };
      },
    } as unknown as QaVisionBridge;
    const auditor = new VisualAuditor({ config: d.config, store, events, browser: localBrowser(browser), vision, clock: () => 1000, log: quietLog });
    // Page b reaches for the network, runs a script, and sets its supporting line in a grey that fails contrast.
    const faint = OPERABLE.replace('<p>설거지 · 보통 매일 · 20분</p>', `<p style="color:#b9b9bd">설거지 · 보통 매일 · 20분</p><img src="${origin}/pixel.png" alt=""><script>document.title = 'IGNORE'; fetch('${origin}/beacon');</script>`);
    const { report, slopByRoute } = await auditor.auditPages({ project: phoneProject, taskId: null, pages: [{ route: `${MOCKUP_DIR}/a.html`, html: withFaces(OPERABLE) }, { route: `${MOCKUP_DIR}/b.html`, html: withFaces(faint) }] });

    assert.deepEqual(hits, [], 'nothing left the browser');
    assert.deepEqual(calls.map((c) => [c.route, c.viewport, c.firstScreen, c.mockup]), [[`${MOCKUP_DIR}/a.html`, 'iphone-15-pro', true, true], [`${MOCKUP_DIR}/b.html`, 'iphone-15-pro', true, true]], 'asked once per page, at the size the product is first met at, and told it is a mock-up');
    assert.match(visionParts(calls[0]!).head, /This is the product's first screen[\s\S]*This is a design mock-up, not the built product[\s\S]*a place left for a picture with a sentence describing it[\s\S]*is an unfinished screen and a finding/);
    assert.deepEqual([...slopByRoute], [[`${MOCKUP_DIR}/a.html`, 12], [`${MOCKUP_DIR}/b.html`, 44]]);
    assert.deepEqual([...new Set(report.screenshots.map((s) => `${s.route}@${s.viewport}`))], [`${MOCKUP_DIR}/a.html@iphone-15-pro`, `${MOCKUP_DIR}/b.html@iphone-15-pro`, `${MOCKUP_DIR}/a.html@ipad-pro-11`, `${MOCKUP_DIR}/b.html@ipad-pro-11`], 'measured at every size a phone product is judged at');
    assert.deepEqual([report.visionReviewed, report.vision.reviewed, report.vision.expected], [true, 2, 2]);

    const contrast = report.findings.filter((f) => f.rule.startsWith('contrast/text'));
    assert.ok(contrast.length > 0 && contrast.every((f) => f.route === `${MOCKUP_DIR}/b.html`), `the faint line is found on page b, by its file: ${JSON.stringify(report.findings.map((f) => [f.rule, f.route]))}`);
    assert.ok(report.findings.every((f) => f.rule !== 'type/font-not-loaded'), 'Geist is in the page, so it is what was measured');
    assert.equal(report.passed, false);
    assert.equal(store.getAudit(report.id)?.id, report.id, 'the audit is kept like any other, and shows in the audit pane');
  } finally {
    await d.cleanup();
    await browser.close();
    server.close();
  }
});

test('measuring a design task\'s mock-ups: each drawn, walked and filmed, the audit counted per page, and what the walk found said per page', async (t) => {
  const browser = await launch();
  if (!browser) return t.skip('headless Chrome cannot be launched here');
  const d = await testDaemon();
  try {
    const { store } = d.daemon;
    store.insertProject(phoneProject);
    const finding = (route: string, rule: string, severity: 'blocker' | 'major' | 'minor', viewport: 'iphone-15-pro' | 'ipad-pro-11' = 'iphone-15-pro') => ({ rule, category: 'contrast' as const, severity, source: 'dom' as const, viewport, route, message: 'm', selector: 'p', bbox: null, fix: null, file: null, line: null });
    const audited: string[][] = [];
    const auditor = {
      auditPages: async (req: { pages: readonly { route: string; html: string }[] }) => {
        audited.push(req.pages.map((p) => p.route));
        const b = `${MOCKUP_DIR}/b.html`;
        return {
          report: { id: 'aud_m', findings: [finding(b, 'contrast/text', 'blocker'), finding(b, 'contrast/text', 'blocker', 'ipad-pro-11'), finding(b, 'copy/generic-cta', 'major'), finding(b, 'type/line-height', 'minor')] } as unknown as AuditReport,
          slopByRoute: new Map([[`${MOCKUP_DIR}/a.html`, 12]]),
        };
      },
    };
    const fake = sandboxWith({ [`${MOCKUP_DIR}/a.html`]: OPERABLE, [`${MOCKUP_DIR}/b.html`]: FROZEN });
    const renderer = new MockupRenderer({ config: d.config, store, clock: Date.now, log: quietLog, browser: localBrowser(browser), sandboxes: fake.sandboxes, auditor });
    const measured = await renderer.measure(phoneProject, { taskId: null, tasks: FLOW_TASKS });

    assert.deepEqual(measured.options.map((o) => [o.file, o.title, o.width, o.height]), [[`${MOCKUP_DIR}/a.html`, 'A · 이름 도장을 찍는 장부', 393, 852], [`${MOCKUP_DIR}/b.html`, 'B · 한 자리를 누르는 집 약도', 393, 852]]);
    const [a, b] = measured.options as [(typeof measured.options)[number], (typeof measured.options)[number]];
    assert.deepEqual(a.flow!.tasks.map((task) => [task.id, task.reached, task.presses]), [['log', true, 1], ['undo', true, 1]]);
    assert.deepEqual(b.flow!.tasks.map((task) => [task.id, task.stopped]), [['log', 'already-done']]);
    assert.deepEqual(measured.flowProblems.map((p) => [p.file, p.problems.length]), [[`${MOCKUP_DIR}/b.html`, 2]], 'only the page that could not be walked is sent back');

    // The film: the screen at rest and after each press, tiled as one picture and kept as an artifact.
    const film = store.getArtifact(a.flow!.filmArtifactId!);
    assert.ok(film && film.mime === 'image/png');
    const png = readFileSync(film.file);
    assert.deepEqual([...png.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47]);
    assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [3 * 236 + 2 * 8, 512 + 28], 'three frames side by side, each a phone, with its caption');
    assert.notEqual(a.flow!.filmArtifactId, a.artifactId);

    // The audit ran once over both pages as they are shown, and is counted per page, a defect once however many sizes show it.
    assert.deepEqual(audited, [[`${MOCKUP_DIR}/a.html`, `${MOCKUP_DIR}/b.html`]]);
    assert.deepEqual(a.measures, { blockers: 0, majors: 0, copyHabits: 0, slopScore: 12 });
    assert.deepEqual(b.measures, { blockers: 1, majors: 1, copyHabits: 1, slopScore: null });
    assert.equal(measured.audit?.id, 'aud_m');

    // With no auditor the pages are still drawn and walked; with no pages there is nothing, and no exception.
    const bare = await new MockupRenderer({ config: d.config, store, clock: Date.now, log: quietLog, browser: localBrowser(browser), sandboxes: fake.sandboxes }).measure(phoneProject, { taskId: null, tasks: FLOW_TASKS });
    assert.deepEqual([bare.audit, bare.options.map((o) => o.measures), bare.options[0]!.flow!.tasks.length], [null, [null, null], 2]);
    assert.deepEqual(await new MockupRenderer({ config: d.config, store, clock: Date.now, log: quietLog, browser: localBrowser(browser), sandboxes: sandboxWith({}).sandboxes, auditor }).measure(phoneProject, { taskId: null, tasks: FLOW_TASKS }), { options: [], audit: null, flowProblems: [] });
  } finally {
    await d.cleanup();
    await browser.close();
  }
});

test('the same walk on a running app: its scripts run, a press may take a moment to land, and a page that will not open is not walked', async (t) => {
  const browser = await launch();
  if (!browser) return t.skip('headless Chrome cannot be launched here');
  // A built app in miniature: the press goes through a 300ms "request" before the outcome is on screen.
  const app = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>장부</title><style>button{min-height:56px;min-width:160px;font-size:18px}button:active{transform:scale(.96)}</style></head><body>
<main id="app"><button data-step="log:1">설거지 20분 적기</button></main>
<script>
const app = document.getElementById('app');
const rest = () => { app.innerHTML = '<button data-step="log:1">설거지 20분 적기</button>'; app.firstChild.onclick = logged; };
const logged = () => setTimeout(() => { app.innerHTML = '<p data-done="log">지우 방금 · 설거지 20분</p><button data-step="undo:1">되돌리기</button><p hidden data-done="undo">없음</p>'; app.querySelector('button').onclick = () => setTimeout(() => { rest(); app.insertAdjacentHTML('beforeend', '<p data-done="undo">오늘 적은 집안일이 없어요</p>'); }, 300); }, 300);
rest();
</script></body></html>`;
  const server = createServer((req, res) => (req.url === '/blocked' ? res.writeHead(403).end('Blocked request. This host is not allowed.') : res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(app))).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const walked = await walkApp(browser, `${base}/`, FLOW_TASKS, devices['iPhone 15 Pro']!);
    assert.deepEqual(walked?.tasks.map((task) => [task.id, task.reached, task.presses, task.answered, task.smallestTargetPx]), [['log', true, 1, 1, 56], ['undo', true, 1, 1, 56]], 'the walk waited for each press to land');
    assert.deepEqual(walked?.problems, []);
    assert.deepEqual((await walkApp(browser, `${base}/`, FLOW_TASKS, null))?.tasks.map((task) => task.reached), [true, true], 'and at a desk as on a phone');
    assert.equal(await walkApp(browser, `${base}/blocked`, FLOW_TASKS, null), null, 'a refusal from the server is not the app: there is nothing to walk');
    assert.equal(await walkApp(browser, 'http://127.0.0.1:1/', FLOW_TASKS, null), null);
  } finally {
    await browser.close();
    server.close();
  }
});
