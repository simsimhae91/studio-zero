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
import { MOCKUP_ASSET_DIR, MOCKUP_DIR, MockupRenderer, renderMockupCheck } from '../src/qa/MockupRenderer.ts';
import type { QaBrowser, QaSession } from '../src/qa/QaBrowser.ts';
import type { QaVisionBridge } from '../src/qa/QaVisionBridge.ts';
import { walkApp } from '../src/qa/SmokeTester.ts';
import { toScreenReview, visionParts, type VisionInput, type VisionReply } from '../src/qa/vision.ts';
import { VisualAuditor } from '../src/qa/VisualAuditor.ts';
import type { OrbStackManager } from '../src/sandbox/OrbStackManager.ts';
import { SCREEN_SPEC_FILE, checkScreenSpec, coreStates, readScreenSpec, renderScreenSpec, stateLabel } from '../src/scratch/ScreenSpec.ts';
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
    readFile: async (_project: Project, path: string) => {
      if (files[path] === undefined) throw new Error(`no such file: ${path}`);
      return { content: files[path], truncated: false };
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

  // What a build owes a way to look at: the states of the screens its core flow happens on, and no others.
  assert.deepEqual(coreStates(SCREEN_SPEC).map(stateLabel), ['H-01 기록 없음', 'H-01 저장 실패']);
  assert.deepEqual(coreStates({ ...SCREEN_SPEC, tasks: [] }), []);

  const text = renderScreenSpec(SCREEN_SPEC);
  assert.match(text, /^Core moment: 지우가 설거지를 끝내고 3초 안에 20분을 적는다\.\n\nCore flow:\n {2}1\. \[log\] on H-01: 설거지 20분을 적는다 → 오늘 칸에 지우의 기록이 남는다/);
  assert.match(text, /H-01 오늘 장부: 방금 한 집안일을 한 번 눌러 적는다\.\n {2}entry: 앱 실행 · 알림\n {2}1\. 집안일 줄: 누르면 오늘 칸에/);
  assert.match(text, /state "저장 실패": 적지 못했어요/);
  assert.match(text, /Events:\n {2}chore_logged: 기록이 저장될 때 \(measures 주간 기록 수\)/);
});

test('a mock-up page is given what it points at: its pictures from the asset folder and the theme faces it names, and nothing else', async () => {
  assert.deepEqual(SUPPLIED_FACES, ['Pretendard Variable', 'SUIT Variable', 'SUITE Variable']);
  // SUIT and SUITE go in whole, each under the family name the page uses, with the weights its variable file covers.
  const whole = (html: string): [string, string, number][] => [...html.matchAll(/@font-face\{font-family:"([^"]+)";font-style:normal;font-weight:([\d ]+);font-display:block;src:url\(data:font\/woff2;base64,([A-Za-z0-9+/=]+)\) format\("woff2-variations"\)\}/g)].map((m) => [m[1]!, m[2]!, m[3]!.length]);
  const suite = withFaces('<!doctype html><html><head><title>t</title><style>:root{--font-sans:"SUITE Variable","SUITE",-apple-system,sans-serif}body{font-family:var(--font-sans)}</style></head><body><p>A suit of cards</p></body></html>');
  assert.match(suite, /^<!doctype html><html><head><style data-studio-faces>@font-face\{font-family:"SUITE Variable";/, 'the faces go in after <head>, where they cannot change how the page is parsed');
  const [carried] = whole(suite);
  assert.equal(whole(suite).length, 1, 'one rule, for the one face the page names: SUITE is not SUIT, and a word in the text is not a font');
  assert.deepEqual(carried!.slice(0, 2), ['SUITE Variable', '300 900']);
  assert.ok(carried![2] > 100_000, `the whole file is in the page: ${carried![2]} base64 characters`);
  assert.ok(!suite.includes('font-family:"SUIT Variable"') && !suite.includes('font-family:"Pretendard'), 'a face the page does not name is not added');
  assert.deepEqual(whole(withFaces('<!DOCTYPE html><p style="font-family:SUIT, sans-serif">x</p>')).map((rule) => rule.slice(0, 2)), [['SUIT', '100 900']], 'under the family name the page uses');
  assert.match(withFaces('<!DOCTYPE html><p style="font-family:SUIT">x</p>'), /^<!DOCTYPE html><style data-studio-faces>/, 'with no <head>, after the doctype: never before it');
  assert.deepEqual(whole(withFaces('<svg><text font-family="SUIT Variable">72.4</text></svg>')).map((rule) => rule[0]), ['SUIT Variable'], 'a drawn instrument names its face in an attribute');
  // What the studio no longer supplies is no longer put in, and what only reads like a face is left alone.
  const serif = '<!doctype html><html><head><title>t</title><style>h1{font-family:Fraunces,"Noto Serif KR",serif}body{font-family:Geist,sans-serif}</style></head><body></body></html>';
  assert.equal(withFaces(serif), serif, 'Fraunces and Geist are not faces of the studio any more');
  assert.equal(withFaces('<p>system-ui only</p>'), '<p>system-ui only</p>');
  for (const prose of ['<p class="suite">Suite 301, a suit of armour</p>', '<style>.suit-row{gap:8px}.suite{margin:0}#suit{padding:0}</style><p>x</p>']) assert.equal(withFaces(prose), prose);

  // The Hangul face is too large to carry whole (2 MB), so a page gets the pieces its own characters need: the
  // file is split by code point range, and only the ranges the page uses go in, with the range on each rule.
  const covers = (html: string, codePoint: number): boolean =>
    [...html.matchAll(/@font-face\{font-family:"Pretendard(?: Variable)?";[^}]*unicode-range:([^;}]+)/g)].some(([, ranges]) =>
      ranges!.split(',').some((r) => {
        const [from, to] = r.trim().replace(/^U\+/i, '').split('-').map((h) => parseInt(h, 16));
        return codePoint >= from! && codePoint <= (to ?? from!);
      }),
    );
  const korean = withFaces('<!doctype html><html lang="ko"><head><style>body{font-family:"Pretendard Variable",Pretendard,sans-serif}</style></head><body><h1>오늘 64점 차</h1><p>체중 72.4kg</p></body></html>');
  const rules = korean.match(/@font-face\{font-family:"Pretendard Variable";/g) ?? [];
  assert.ok(rules.length >= 2 && rules.length <= 12, `the Latin piece and the few Hangul pieces this text needs, not all of them: ${rules.length}`);
  for (const ch of '오늘점차체중kg64') assert.ok(covers(korean, ch.codePointAt(0)!), `${ch} is drawn in Pretendard`);
  assert.ok(!covers(korean, '뷁'.codePointAt(0)!), 'a syllable the page never uses is not carried');
  assert.match(korean, /font-family:"Pretendard Variable";font-style:normal;font-weight:45 920;font-display:block;src:url\(data:font\/woff2;base64,[A-Za-z0-9+/=]{100,}\) format\("woff2-variations"\);unicode-range:U\+/);
  assert.ok(korean.length < 1_200_000, `a short page stays small: ${korean.length} bytes`);
  // The Latin piece carries a dozen of the most frequent syllables with it (가, 이, 하 …), so the syllable looked for is one it lacks.
  const latin = withFaces('<p style="font-family:Pretendard" title="Weight">Weight 72.4 kg</p>');
  assert.equal((latin.match(/@font-face/g) ?? []).length, 1, 'a page with no Hangul carries the Latin piece alone: the markup\'s own brackets pull nothing in');
  assert.ok(covers(latin, 'W'.codePointAt(0)!) && !covers(latin, '오'.codePointAt(0)!));
  assert.ok(latin.includes('font-family:"Pretendard";') && !latin.includes('Pretendard Variable'), 'under the family name the page uses');
  assert.ok(covers(withFaces('<p style="font-family:Pretendard"><img alt="비빔밥"></p>'), '빔'.codePointAt(0)!), 'what an attribute shows is drawn too');

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

    // What a real model's page did, which is why the answer is also read from the pixels around the control: the
    // press is answered by the row the control sits in, and an undo countdown runs for five seconds beside it.
    const inRow = await walkOn(
      OPERABLE.replace('.btn:active{transform:scale(.96);background:#143526}', 'section:has(.btn:active){background:#e4e2da}').replace('.quiet:active{background:#ecebe6}', '@keyframes drain{from{width:100%}to{width:0}}.stamp::after{content:"";display:block;height:4px;background:var(--brand);animation:drain 5000ms linear both}'),
    );
    assert.deepEqual(inRow.tasks.map((task) => [task.id, task.reached, task.answered, task.responseMs]), [['log', true, 1, 320], ['undo', true, 1, null]], 'answered in the row counts; the countdown is not the response');

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
    assert.ok(report.findings.every((f) => f.rule !== 'type/font-not-loaded'), 'Pretendard is in the page, so it is what was measured');
    assert.equal(report.passed, false);
    assert.equal(store.getAudit(report.id)?.id, report.id, 'the audit is kept like any other, and shows in the audit pane');
    // Each page was also tried by hand, at the phone's size: its one button held down, with nothing clicked.
    assert.deepEqual([report.measures?.pressAnswer, report.measures?.focusVisible, report.measures?.layoutShift], [{ passed: 2, total: 2 }, { passed: 0, total: 0 }, null], 'a sealed page has nothing arriving late, so no shift is measured on it');
    assert.ok(report.findings.every((f) => f.rule !== 'touch/no-press-answer'));
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

test('a mock-up made of the browser\'s own parts is walked with scripts off: a popover opened by its button, one panel open at a time', async (t) => {
  const browser = await launch();
  if (!browser) return t.skip('headless Chrome cannot be launched here');
  // What the brief now offers beside checked inputs: popovertarget, <details name>, and an entrance by @starting-style.
  const NATIVE = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>D · 서랍</title><style>
body{margin:0;font:16px/1.5 system-ui;padding:24px}button,summary{min-height:48px;min-width:48px;font:inherit;padding:0 16px}button:active,summary:active{transform:scale(.97);background:#123;color:#fff}
[popover]{inset:auto 0 0 0;margin:0;width:100%;border:0;border-top:1px solid #333;padding:24px;transition:translate 200ms ease-out, display 200ms allow-discrete, overlay 200ms allow-discrete;translate:0 0}
@starting-style{[popover]:popover-open{translate:0 100%}}
details{border-bottom:1px solid #999}
</style></head><body>
<h1>망원동 집 장부</h1>
<details name="chore"><summary data-step="log:1">설거지</summary><button popovertarget="sheet" data-step="log:2">20분 적기</button></details>
<details name="chore"><summary>빨래</summary><p>40분</p></details>
<div id="sheet" popover><p data-done="log">지우 방금 · 설거지 20분</p></div>
</body></html>`;
  try {
    const context = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, javaScriptEnabled: false, offline: true });
    const page = await context.newPage();
    await page.setContent(NATIVE, { waitUntil: 'load' });
    const walk = await walkFlow(page, [{ id: 'log', goal: '설거지 20분을 적는다', outcome: '방금 적은 줄이 서랍에 보인다' }], { touch: true });
    assert.deepEqual(walk.tasks.map((task) => [task.id, task.reached, task.stopped, task.presses, task.answered]), [['log', true, null, 2, 2]], 'the summary opened its panel, the button opened the popover, and both answered the press');
    assert.deepEqual(walkProblems(walk, [{ id: 'log', goal: '설거지 20분을 적는다', outcome: '방금 적은 줄이 서랍에 보인다' }], { touch: true }), []);
    assert.equal(await page.locator('#sheet').evaluate((el) => el.matches(':popover-open')), true);
    await context.close();
  } finally {
    await browser.close();
  }
});

test('an engine checks its own page: the studio measures it as it will be judged, asks no reviewer, records no audit, and shows the owner what it drew', async (t) => {
  const browser = await launch();
  if (!browser) return t.skip('headless Chrome cannot be launched here');
  const d = await testDaemon();
  try {
    const { store, events, toolbox, studio } = d.daemon;
    const project = studio.createProject({ type: 'owner', via: 'desktop' }, { name: 'Chores', slug: 'chores-check', template: 'mobile-expo' });
    const task = await studio.submitTask({ type: 'owner', via: 'desktop' }, { projectId: project.id, kind: 'ideate', prompt: '집안일 기록' }, 'desktop');
    let asked = 0;
    const vision = { availability: async () => ((asked += 1), { status: 'ready', paths: ['codex'], reason: null }), review: async () => ((asked += 1), Promise.reject(new Error('no reviewer is asked by a check'))) } as unknown as QaVisionBridge;
    const auditor = new VisualAuditor({ config: d.config, store, events, browser: localBrowser(browser), vision, clock: () => 1000, log: quietLog });
    const faint = OPERABLE.replace('<p>설거지 · 보통 매일 · 20분</p>', '<p style="color:#b9b9bd">설거지 · 보통 매일 · 20분</p>');
    const fake = sandboxWith({ [`${MOCKUP_DIR}/a.html`]: OPERABLE, [`${MOCKUP_DIR}/b.html`]: faint, [`${MOCKUP_DIR}/c.html`]: FROZEN, [SCREEN_SPEC_FILE]: JSON.stringify(SCREEN_SPEC) });
    const renderer = new MockupRenderer({ config: d.config, store, clock: Date.now, log: quietLog, browser: localBrowser(browser), sandboxes: fake.sandboxes, auditor });

    const a = await renderer.check(project, `${MOCKUP_DIR}/a.html`);
    assert.equal(a.status, 'measured');
    if (a.status !== 'measured') return;
    assert.deepEqual([a.specProblems, a.flowProblems], [[], []]);
    assert.deepEqual(a.option.flow!.tasks.map((walked) => [walked.id, walked.reached]), [['log', true], ['undo', true]], 'the flow walked is the one the screen spec in the workspace states');
    assert.deepEqual(a.viewports, ['iphone-15-pro', 'ipad-pro-11']);
    assert.deepEqual(a.findings!.filter((f) => f.severity !== 'minor').map((f) => f.rule), []);
    assert.deepEqual(a.option.measures, { blockers: 0, majors: 0, copyHabits: 0, slopScore: null }, 'no reviewer saw it, so there is no score');
    const clean = renderMockupCheck(a.option.file, a);
    assert.match(clean, /^docs\/mockups\/a\.html as the studio shows and measures it: scripts off, network off, at iphone-15-pro, ipad-pro-11, in light and in dark\./);
    assert.match(clean, /Core flow: every task was carried out to its outcome \(log: 1 press; undo: 1 press\)\./);
    assert.match(clean, /Nothing here holds the page back\.[\s\S]*a design reviewer looks at the page once, after you stop\.$/);

    const b = await renderer.check(project, `${MOCKUP_DIR}/b.html`);
    assert.ok(b.status === 'measured' && b.findings!.some((f) => f.rule.startsWith('contrast/text') && f.severity === 'blocker'));
    if (b.status !== 'measured') return;
    assert.equal(b.findings!.filter((f) => f.rule.startsWith('contrast/text') && !f.rule.endsWith('@dark')).length, 1, 'one defect, however many sizes show it');
    const said = renderMockupCheck(b.option.file, b);
    assert.match(said, /Measured: 2 blocker, \d+ major, \d+ minor\.\n- \[blocker\] contrast\/text[^\n]* \(measured\)\n  [^\n]*selector: [^\n]+\n/);
    assert.match(said, /Fix these in the page itself and check it again\./);

    const c = await renderer.check(project, `${MOCKUP_DIR}/c.html`);
    assert.ok(c.status === 'measured' && c.flowProblems.length === 2, 'a page frozen after the act cannot be walked, and is told so');
    if (c.status === 'measured') assert.match(renderMockupCheck(c.option.file, c), /Core flow: 0 of 1 task\(s\) could be carried out to their outcome\.\n- /);

    assert.equal(asked, 0, 'no reviewer was asked, or even looked for');
    assert.deepEqual(store.listAudits(project.id, 10), [], 'a check is not an audit of the project');

    // The same check as the tool an engine calls: the text comes back as data, and the owner is shown the page.
    toolbox.useMockups(renderer);
    const out = await toolbox.call({ project, taskId: task.id, lane: 'b' }, 'check_mockup', { file: `${MOCKUP_DIR}/b.html` });
    assert.equal(out.isError, false);
    assert.match(out.content, /<untrusted-data[^>]*source="browser-page"[\s\S]*\[blocker\] contrast\/text/);
    const seen = store.listEvents({ taskId: task.id }, 0, 50).map((e) => e.body);
    const call = seen.find((e) => e.type === 'tool.call');
    assert.deepEqual(call?.type === 'tool.call' ? [call.tool, call.input, call.lane] : null, ['check_mockup', `${MOCKUP_DIR}/b.html`, 'b']);
    const drafted = seen.find((e) => e.type === 'mockups.drafted');
    assert.ok(drafted?.type === 'mockups.drafted' && drafted.option.file === `${MOCKUP_DIR}/b.html` && drafted.option.title === 'A · 이름 도장을 찍는 장부' && drafted.option.measures?.blockers === 2 && store.getArtifact(drafted.option.artifactId));

    // A page that is not there, a path that is not a mock-up, and a studio without a browser.
    assert.match((await toolbox.call({ project, taskId: task.id }, 'check_mockup', { file: `${MOCKUP_DIR}/a.html` })).content, /Nothing here holds the page back/);
    assert.equal((await toolbox.call({ project, taskId: task.id }, 'check_mockup', { file: 'docs/prd.md' })).isError, true);
    toolbox.useMockups(new MockupRenderer({ config: d.config, store, clock: Date.now, log: quietLog, browser: localBrowser(browser), sandboxes: sandboxWith({}).sandboxes, auditor }));
    const none = await toolbox.call({ project, taskId: task.id }, 'check_mockup', { file: `${MOCKUP_DIR}/c.html` });
    assert.ok(none.isError && /does not exist/.test(none.content));
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
