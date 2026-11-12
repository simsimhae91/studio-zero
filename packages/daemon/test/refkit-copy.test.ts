// Two readings of a page that are kept apart from everything else: a reference, which is somebody else's page
// and is measured for principles, and the product's own copy, which is lifted out of its rendering and read as words.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { contract } from '@studio-zero/design';
import type { Finding } from '@studio-zero/protocol';
import { auditCopy, copyBlock, summariseCopy } from '../src/harness/TextSlopAuditor.ts';
import { isPrivateAddress, isPublicHost, parseReferenceUrl } from '../src/policy/PolicyEngine.ts';
import { COPY_RULE_PREFIX, gradeAudit, measureAccess, runDomChecks } from '../src/qa/checks.ts';
import type { DigestElement, PageDigest } from '../src/qa/collector.ts';
import type { QaBrowser } from '../src/qa/QaBrowser.ts';
import { RefKit, summariseReference } from '../src/qa/RefKit.ts';
import { LIVING_VISUAL_RULE, toScreenReview, visionContent, type VisionReply } from '../src/qa/vision.ts';
import { ConflictError } from '../src/app/errors.ts';
import { quietLog, sampleProject, testDaemon } from './helpers.ts';

let n = 0;
function el(over: Partial<DigestElement>): DigestElement {
  n += 1;
  return {
    id: `e${n}`, tag: 'p', role: '', selector: `main > *:nth-child(${n})`, text: '', textLength: over.text?.length ?? 0, interactive: false, inline: false,
    x: 24, y: 40 * n, w: 600, h: 28, color: [0.1, 0.1, 0.1, 1], background: [1, 1, 1, 1], backgroundIndeterminate: false, ownBackground: [0, 0, 0, 0], backgroundImage: 'none',
    fontSize: 16, fontWeight: 400, fontFamily: 'Geist', lineHeight: 1.6, letterSpacingEm: 0, uppercase: false, radius: 0, padding: [0, 0, 0, 0], margin: [0, 0, 0, 0], gap: 0,
    shadow: 'none', hasBorder: false, clipped: false, charsPerLine: 0, siblingKey: 'main|P', ...over,
  };
}
const page = (elements: DigestElement[], over: Partial<PageDigest> = {}): PageDigest => ({ title: 't', lang: 'ko', width: 1440, height: 900, scrollWidth: 1440, scrollHeight: 2400, loadedFonts: ['Geist'], elements, ...over });
const desktop = { viewport: 'desktop-1440', route: '/' } as const;

test('a reference must be a public https page: nothing that could be an address inside this Mac or its network', () => {
  assert.deepEqual(parseReferenceUrl(' https://agentshot.example/work?tab=1#hero '), { ok: false, reason: 'agentshot.example is not a public host name' }, 'reserved names are not public');
  assert.deepEqual(parseReferenceUrl('https://usekuroko.com/pricing?x=1#top'), { ok: true, url: 'https://usekuroko.com/pricing?x=1', host: 'usekuroko.com' });
  for (const [url, reason] of [
    ['http://usekuroko.com/', /only https/],
    ['https://user:pw@usekuroko.com/', /embedded credentials/],
    ['https://usekuroko.com:8443/', /default https port/],
    ['https://localhost/', /not a public host name/],
    ['https://sz-ledger/', /not a public host name/],
    ['https://host.docker.internal/', /not a public host name/],
    ['https://192.168.0.10/', /not a public host name/],
    ['https://[::1]/', /not a public host name/],
    ['https://printer.local/', /not a public host name/],
    ['file:///etc/passwd', /only https/],
    ['not a url', /not a valid URL/],
  ] as const) {
    const parsed = parseReferenceUrl(url);
    assert.ok(!parsed.ok && reason.test(parsed.reason), `${url}: ${JSON.stringify(parsed)}`);
  }
  assert.ok(isPublicHost('cdn.usekuroko.com') && !isPublicHost('sz-qa-browser') && !isPublicHost('10.0.0.1'));
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.20.0.2', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:10.0.0.1']) assert.ok(isPrivateAddress(ip), ip);
  for (const ip of ['93.184.216.34', '8.8.8.8', '172.32.0.1', '2606:4700::1111']) assert.ok(!isPrivateAddress(ip), ip);
});

test('a task with a reference that cannot be opened is refused when it is submitted; the capture reports what it could not open', async () => {
  const d = await testDaemon();
  const { studio, policy, store, events } = d.daemon;
  try {
    const project = studio.createProject({ type: 'owner', via: 'desktop' }, { name: 'Refill', slug: 'refill', template: 'web-vite-react' });
    await assert.rejects(studio.submitTask({ type: 'owner', via: 'desktop' }, { projectId: project.id, kind: 'build', prompt: 'x', references: ['https://192.168.0.1/admin'] }, 'desktop'), ConflictError);
    const task = await studio.submitTask({ type: 'owner', via: 'desktop' }, { projectId: project.id, kind: 'build', prompt: 'x', track: 'fast', references: ['https://usekuroko.com/#hero'], reviewer: 'codex' }, 'desktop');
    assert.deepEqual([task.references, task.reviewerPref], [['https://usekuroko.com/'], 'codex'], 'stored as checked, with the owner\'s choice of reviewer');
    d.daemon.queue.cancel(task.id);

    await assert.rejects(policy.authorize({ type: 'agent', taskId: task.id }, { kind: 'reference.capture', projectId: project.id, url: 'https://usekuroko.com/' }), /agents do not choose which pages the studio opens/);
    await assert.rejects(policy.authorize({ type: 'system' }, { kind: 'reference.capture', projectId: project.id, url: 'https://sz-refill/' }), /not a public host name/);

    // The browser container is not there in this test: the capture says so per page and does not throw.
    const kit = new RefKit({ config: d.config, store, events, policy, browser: { use: async () => { throw new Error('QA browser did not become ready: connect ECONNREFUSED'); } } as unknown as QaBrowser, clock: Date.now, log: quietLog });
    const captures = await kit.capture(project, null, ['https://usekuroko.com/', 'http://plain.example.org/', 'https://wiki.intranet/', 'https://fourth.example.net/']);
    assert.deepEqual(captures.map((c) => [c.url, c.ok, c.error]).sort(), [
      ['http://plain.example.org/', false, 'only https:// pages can be used as a reference'],
      ['https://usekuroko.com/', false, 'QA browser did not become ready: connect ECONNREFUSED'],
      ['https://wiki.intranet/', false, 'wiki.intranet is not a public host name'],
    ], 'three at most, each with its own reason');
    assert.deepEqual(events.history({ projectId: project.id }, 0, 100).flatMap((e) => (e.body.type === 'reference.captured' ? [e.body.ok] : [])), [false, false, false]);
  } finally {
    await d.cleanup();
  }
});

test('a reference is summarised as observations: sizes, leading, curves, colours, motion, and what its first screen is made of', () => {
  const summary = summariseReference(
    page([
      el({ tag: 'h1', text: 'Shoot the shot', textLength: 14, fontSize: 132, fontWeight: 600, lineHeight: 0.95, letterSpacingEm: -0.03, fontFamily: 'Fraunces', y: 120, w: 900, h: 260 }),
      el({ text: 'A long paragraph of running text that explains very little but is long enough to count as body copy here.', fontSize: 20, lineHeight: 1.5, charsPerLine: 62, y: 420 }),
      el({ tag: 'button', text: 'Open the viewfinder', interactive: true, w: 220, h: 56, radius: 28, ownBackground: [0.05, 0.05, 0.05, 1], y: 520 }),
      el({ tag: 'div', text: '', w: 1200, h: 700, radius: 30, ownBackground: [0.96, 0.94, 0.9, 1], y: 60 }),
      el({ tag: 'canvas', text: '', w: 640, h: 480, y: 200 }),
    ]),
    ['0.6s', '810ms', '0.2s', '810ms'],
  );
  assert.match(summary, /largest text: 132px, weight 600, line-height 0\.95, letter-spacing -0\.030em, set in Fraunces: "Shoot the shot"/);
  assert.match(summary, /running text: 20px, line-height 1\.50, about 62 characters a line; the headline is 6\.6 times it/);
  assert.match(summary, /corner radii: 30px, and full pills/);
  assert.match(summary, /fills by area: #f5f0e6, #0d0d0d/);
  assert.match(summary, /motion durations declared: 200, 600, 810ms/);
  assert.match(summary, /first screenful: 1 picture\(s\), 1 control\(s\); its largest element is a <div> of 1200x700px/);
});

test('copy is read apart from its rendering: reading order, roles, findings located on the element, one habit counted once', () => {
  const digest = page([
    el({ tag: 'button', text: '시작하기', interactive: true, w: 160, h: 48, y: 520 }),
    el({ tag: 'h1', text: '더 나은 협업의 미래', fontSize: 48, y: 100, selector: 'main > h1' }),
    el({ text: '팀이 함께 토론하고 문서를 고칩니다.', y: 200, selector: 'main > p.lead' }),
    el({ text: 'pnpm install && pnpm dev', fontFamily: 'Geist Mono', y: 300 }),
    el({ tag: 'span', text: '무료', y: 400 }),
    ...[0, 320, 640].map((x) => el({ tag: 'div', text: '', w: 300, h: 200, x, y: 700, siblingKey: 'main > section|DIV' })),
  ]);
  const audit = auditCopy(digest, desktop, contract);
  assert.deepEqual(audit.texts, [
    { route: '/', role: 'title', text: '더 나은 협업의 미래' },
    { route: '/', role: 'body', text: '팀이 함께 토론하고 문서를 고칩니다.' },
    { route: '/', role: 'label', text: '무료' },
    { route: '/', role: 'cta', text: '시작하기' },
  ], 'top to bottom, with code left out');
  const rules = (findings: readonly Finding[]): string[] => findings.map((f) => `${f.severity} ${f.rule}`).sort();
  assert.deepEqual(rules(audit.findings), ['major copy/empty-slogan-title', 'major copy/feature-list-dumping', 'major copy/generic-cta', 'minor copy/uniform-card-grid']);
  const listing = audit.findings.find((f) => f.rule === 'copy/feature-list-dumping')!;
  assert.deepEqual([listing.selector, listing.source, listing.category, listing.fix], ['main > p.lead', 'dom', 'copy', '기능 나열 대신 구체적인 단 하나의 장면(누가, 어떤 순간에)으로 교체하라.']);
  assert.ok(audit.findings.every((f) => f.rule.startsWith(COPY_RULE_PREFIX)));

  // The same screen at a narrower size, where the label is hidden: one report, the fuller text, each habit once.
  const narrow = auditCopy(page(digest.elements.filter((e) => e.text !== '무료')), { viewport: 'iphone-15-pro', route: '/' }, contract);
  const report = summariseCopy([narrow, audit]);
  assert.deepEqual([report.texts.length, report.habits, report.slopScore], [4, 4, 68]);
  assert.equal(copyBlock(report.texts), '[/]\n# 더 나은 협업의 미래\n  팀이 함께 토론하고 문서를 고칩니다.\n· 무료\n> 시작하기');

  // Those findings fail the audit on their own, whatever a reviewer made of the picture.
  const judged = gradeAudit(audit.findings, { rubric: { hierarchy: 10, copy: 10 }, slopScore: 0 }, 85);
  assert.deepEqual([judged.passed, judged.grade, judged.score > 85], [false, 'C', true]);
});

test('display type is admitted in proportion; pass rates are counted from the same elements the checks read', () => {
  const body = el({ text: 'Running text that is long enough to be measured as the body of this page.', fontSize: 20, textLength: 74 });
  const hero = (size: number): Finding[] => runDomChecks(page([el({ tag: 'h1', text: 'Shoot', fontSize: size, lineHeight: 0.95, h: size }), body]), { ...desktop, viewportWidth: 1440, touch: false, scope: 'full' }, contract).filter((f) => f.category === 'typography');
  assert.deepEqual(hero(132), [], 'a 132px headline over 20px body is 6.6 times: display type, on contract');
  assert.deepEqual(hero(87.5), [], 'fluid display sizes need not sit on a step');
  assert.deepEqual(hero(160).map((f) => f.rule), ['type/display-ratio'], '160px over 20px is eight times');
  assert.match(hero(160)[0]!.message, /The headline is 160px over 20px body text \(8 times\)/);
  assert.deepEqual(hero(200).map((f) => f.rule).sort(), ['type/display-ratio', 'type/off-scale'], 'past the ceiling it is off the scale as well');

  const measured = measureAccess(
    page([body, el({ text: 'Faint', color: [0.7, 0.7, 0.7, 1] }), el({ tag: 'button', text: 'Go', interactive: true, w: 120, h: 44 }), el({ tag: 'button', text: 'x', interactive: true, w: 20, h: 20 })]),
    { touch: true },
    contract,
  );
  assert.deepEqual(measured, { contrast: { passed: 3, total: 4 }, touchTargets: { passed: 1, total: 2 } });
});

test('the empty first screen is a trap on the first screen and an observation elsewhere', () => {
  const digest = page([el({ tag: 'h1', text: '리필 스테이션', fontSize: 48, selector: 'main > h1' })]);
  const reply: VisionReply = {
    archetype: 'marketing', slopScore: 20, critique: '글과 선뿐입니다.', rubric: { hierarchy: 7, whitespace: 7, typography: 7, color: 7, copy: 7, originality: 5, tactility: 5 },
    findings: [{ category: 'no-living-visual', severity: 'minor', elementId: null, observation: 'Nothing to look at on the first screen.', fix: '가게 12곳의 단가로 움직이는 계산 캔버스를 첫 화면에 두세요.' }],
    redesignPatches: [],
  };
  const first = toScreenReview(reply, { viewport: 'desktop-1440', route: '/', template: 'web-vite-react', digest, firstScreen: true });
  assert.deepEqual(first.findings.map((f) => [f.rule, f.severity]), [[LIVING_VISUAL_RULE, 'blocker']], 'a blocker whatever the reviewer called it');
  assert.equal(first.slopScore, 60, 'and the screen cannot carry a low slop score');
  assert.deepEqual(first.patches.map((p) => [p.action, p.instruction]), [['replace_with_viewfinder', '가게 12곳의 단가로 움직이는 계산 캔버스를 첫 화면에 두세요.']], 'with a prescription written from the fix');
  assert.equal(gradeAudit(first.findings, { rubric: first.rubric, slopScore: first.slopScore }, 85).grade, 'F');

  const deeper = toScreenReview({ ...reply, findings: [{ ...reply.findings[0]!, severity: 'blocker' }] }, { viewport: 'desktop-1440', route: '/settings', template: 'web-vite-react', digest });
  assert.deepEqual([deeper.findings[0]!.severity, deeper.slopScore, deeper.patches.length], ['major', 20, 0], 'a settings page may be all text');

  const head = (firstScreen: boolean): string => (visionContent({ scope: { projectId: 'p', taskId: null }, viewport: 'desktop-1440', route: '/', template: 'web-vite-react', firstScreen, folds: [], digest, measured: [] })[0] as { text: string }).text;
  assert.match(head(true), /Route: \/\. This is the product's first screen: what a person sees before doing anything\. 0 screenshot/);
  assert.match(head(false), /Route: \/\. 0 screenshot/);
});
