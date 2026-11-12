// The anti-slop half of the audit that does not depend on a model's mood: what the reviewer is told to reject,
// what code does with its reply (traps are blockers, every trap has a patch, a trapped screen cannot score
// clean), how the verdict is graded, and that an audit nobody reviewed says so instead of passing.
//
// The screen under review throughout is the one that prompted this: a photo-masking phone app whose first screen
// was a headline, a paragraph, a static picture of a parcel and one wide button.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { devices } from 'playwright-core';
import { z } from 'zod';
import type { AuditReport, Finding, Project, Template } from '@studio-zero/protocol';
import { visualOutcome } from '../src/harness/EvalRunner.ts';
import { SLOP_FAIL, SLOP_PASS_MAX, UNREVIEWED_SCORE_CAP, gradeAudit, runDomChecks } from '../src/qa/checks.ts';
import type { DigestElement, PageDigest } from '../src/qa/collector.ts';
import type { QaBrowser } from '../src/qa/QaBrowser.ts';
import { VisionUnavailableError, type QaVisionBridge, type VisionAvailability } from '../src/qa/QaVisionBridge.ts';
import { VisualAuditor, auditViewports, renderAuditFeedback } from '../src/qa/VisualAuditor.ts';
import { CLIPART_RULE, SLOP_FLOOR_ON_TRAP, VISION_SYSTEM_PROMPT, VisionReply, WEB_LAYOUT_RULE, toScreenReview, visionContent, type VisionInput } from '../src/qa/vision.ts';
import { contract } from '@studio-zero/design';
import { quietLog, sampleProject, testDaemon } from './helpers.ts';

let n = 0;
function el(over: Partial<DigestElement>): DigestElement {
  return {
    id: `e${++n}`, tag: 'div', role: '', selector: `main > div:nth-of-type(${n})`, text: '', textLength: 0, interactive: false, inline: false,
    x: 24, y: 24 * n, w: 345, h: 24, color: [0.1, 0.1, 0.1, 1], background: [1, 1, 1, 1], backgroundIndeterminate: false, ownBackground: [0, 0, 0, 0], backgroundImage: 'none',
    fontSize: 16, fontWeight: 400, fontFamily: 'Geist', lineHeight: 1.6, letterSpacingEm: 0, uppercase: false, radius: 0, padding: [0, 0, 0, 0], margin: [0, 0, 0, 0], gap: 0,
    shadow: 'none', hasBorder: false, clipped: false, charsPerLine: 0, siblingKey: 'main|DIV', ...over,
  };
}

/** The 가림 home screen as the collector saw it: measured clean, and still nothing a designer would ship. */
const HEADLINE = el({ id: 'e1', tag: 'h1', selector: 'main > h1', text: '올리기 전에, 가릴 것부터', textLength: 13, y: 96, h: 80, fontSize: 30, fontWeight: 600, lineHeight: 1.3 });
const PITCH = el({ id: 'e2', tag: 'p', selector: 'main > p', text: '사진에서 집을 알려 주는 글자를 찾아 가려요.', textLength: 24, y: 192, h: 58, fontSize: 18 });
const PARCEL = el({ id: 'e3', selector: 'main > div.hero-art', y: 282, h: 241, radius: 12, ownBackground: [0.92, 0.96, 0.96, 1], backgroundImage: 'url("/assets/preview-label.jpg")' });
const BUTTON = el({ id: 'e4', tag: 'button', role: 'button', selector: 'footer > button.submit', text: '사진 선택', textLength: 5, interactive: true, y: 571, h: 56, fontSize: 18, fontWeight: 600, radius: 8 });
const SCREEN: PageDigest = { title: '가림', lang: 'ko', width: 393, height: 659, scrollWidth: 393, scrollHeight: 659, loadedFonts: ['Geist'], elements: [HEADLINE, PITCH, PARCEL, BUTTON] };

/** What a reviewer says about that screen. It under-rates both traps as "major": code does not leave that to it. */
const SLOP_REPLY: VisionReply = {
  archetype: 'marketing',
  slopScore: 72,
  critique: 'App resembles a static web form rather than a mobile utility. Missing tactile dropzone and bottom action bar.',
  rubric: { hierarchy: 5, whitespace: 6, typography: 6, color: 7, copy: 5, originality: 2, tactility: 3 },
  findings: [
    { category: 'stock-clipart', severity: 'major', elementId: 'e3', observation: 'Generic clip-art detected: a flat parcel picture fills the middle of the screen and cannot be tapped.', fix: 'Replace with an interactive viewfinder or live preview canvas.' },
    { category: 'web-layout-on-mobile', severity: 'major', elementId: null, observation: 'Web marketing layout detected in a mobile viewport: hero headline, pitch paragraph, one full-width button.', fix: 'Restructure into mobile app pattern (App Bar + Canvas + Action Dock).' },
    { category: 'tactility', severity: 'major', elementId: 'e4', observation: 'The only action is a blunt full-width slab with no icon and no shape.', fix: 'Make it a pill TactileButton with a leading icon in the dock.' },
    { category: 'typography', severity: 'minor', elementId: 'e1', observation: 'A 30px/600 headline over 18px/400 body: the body competes with the heading.', fix: 'Drop the hero; a text-lg font-semibold bar title over text-sm text-fg-muted hints.' },
  ],
  redesignPatches: [
    { elementId: 'e3', action: 'replace_with_viewfinder', instruction: 'Replace the static parcel image with an InteractiveDropzone: dashed canvas, camera icon badge, "가릴 사진 가져오기".' },
    { elementId: 'e4', action: 'dock_to_bottom', instruction: 'Dock the button into MobileShell.BottomDock as a pill TactileButton with backdrop blur behind it.' },
  ],
};

const at = (template: Template, viewport: VisionInput['viewport'] = 'iphone-15-pro'): Pick<VisionInput, 'viewport' | 'route' | 'template' | 'digest'> => ({ viewport, route: '/', template, digest: SCREEN });
const rules = (findings: readonly Finding[]): string[] => findings.map((f) => `${f.severity} ${f.rule}`);

test('the review brief: both traps are blockers by name, tactility and type hierarchy are judged, and a redesign plan is owed', () => {
  assert.match(VISION_SYSTEM_PROMPT, /^You are reviewing one screen/);
  assert.match(VISION_SYSTEM_PROMPT, /stock clip-art trap \(category "stock-clipart", always a blocker\)[\s\S]*Generic clip-art detected[\s\S]*interactive viewfinder or drop zone/);
  assert.match(VISION_SYSTEM_PROMPT, /landing page on mobile trap \(category "web-layout-on-mobile", always a blocker\)[\s\S]*Web marketing layout detected in a mobile viewport[\s\S]*safe-area app bar[\s\S]*bottom action dock/);
  assert.match(VISION_SYSTEM_PROMPT, /Tactility and affordances \(category "tactility"\)/);
  assert.match(VISION_SYSTEM_PROMPT, /24px\/700 title over a 14px\/500 muted label/);
  assert.match(VISION_SYSTEM_PROMPT, /Every blocker gets one\./);
  assert.match(VISION_SYSTEM_PROMPT, /a screen caught in either trap scores 60 or more/);

  const schema = z.toJSONSchema(VisionReply) as { properties: Record<string, { enum?: string[]; items?: { properties: Record<string, { enum?: string[] }> } }> };
  assert.deepEqual(schema.properties.archetype!.enum, ['mobile-app', 'web-app', 'web-dashboard', 'marketing']);
  assert.ok(schema.properties.redesignPatches!.items!.properties.action!.enum!.includes('replace_with_viewfinder'));
  assert.ok(schema.properties.redesignPatches!.items!.properties.action!.enum!.includes('dock_to_bottom'));
  assert.ok(schema.properties.findings!.items!.properties.category!.enum!.includes('stock-clipart'));
});

test('the reviewer is shown the picture as something it can point at', () => {
  const blocks = visionContent({ scope: { projectId: 'p', taskId: null }, viewport: 'iphone-15-pro', route: '/', template: 'mobile-expo', folds: [new Uint8Array([1])], digest: SCREEN, measured: [] });
  const list = blocks.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('\n');
  assert.match(list, /^Product: a mobile app \(Expo, React Native\)/);
  assert.match(list, /\ne3 <div> \[image\] "" 345x241 at \(24,282\)/, 'a box painted with an image is listed, though it has no text and is not a control');
  assert.match(list, /\ne4 <button role=button> \[control\] "사진 선택"/);
  assert.equal(blocks.filter((b) => b.type === 'image').length, 1);
});

test('measurement alone passes the sloppy screen, which is why it cannot be the judge', () => {
  const measured = runDomChecks(SCREEN, { viewport: 'iphone-15-pro', viewportWidth: 393, route: '/', touch: true, scope: 'full' }, contract);
  assert.deepEqual(measured, [], 'contrast, targets, scale and rhythm are all in order');
});

test('static clip-art and a marketing layout on a phone: both become blockers, located, each with a patch', () => {
  const review = toScreenReview(SLOP_REPLY, at('mobile-expo'));
  assert.deepEqual(rules(review.findings), [`blocker ${CLIPART_RULE}`, `blocker ${WEB_LAYOUT_RULE}`, 'major vision/tactility', 'minor vision/typography']);

  const clipart = review.findings[0]!;
  assert.equal(clipart.source, 'vlm');
  assert.equal(clipart.selector, 'main > div.hero-art', 'the reviewer names an element id; code turns it into a selector');
  assert.deepEqual(clipart.bbox, { x: 24, y: 282, w: 345, h: 241 }, 'and into the measured box, never an estimate from the image');
  assert.deepEqual([review.findings[1]!.selector, review.findings[1]!.bbox], [null, null], 'a whole-screen finding has no box');
  assert.equal(review.findings[2]!.category, 'tactility');

  assert.deepEqual(review.patches, [
    { viewport: 'iphone-15-pro', route: '/', target: 'main > div.hero-art', bbox: { x: 24, y: 282, w: 345, h: 241 }, action: 'replace_with_viewfinder', instruction: SLOP_REPLY.redesignPatches[0]!.instruction },
    { viewport: 'iphone-15-pro', route: '/', target: 'footer > button.submit', bbox: { x: 24, y: 571, w: 345, h: 56 }, action: 'dock_to_bottom', instruction: SLOP_REPLY.redesignPatches[1]!.instruction },
  ]);
  assert.deepEqual([review.archetype, review.slopScore], ['marketing', 72]);
});

test('what a lenient reviewer leaves out, code supplies: the missing blocker, the missing patches, the slop floor', () => {
  const lenient: VisionReply = {
    ...SLOP_REPLY,
    slopScore: 18,
    findings: [{ category: 'stock-clipart', severity: 'minor', elementId: 'e3', observation: 'A parcel picture decorates the screen.', fix: 'Put an InteractiveDropzone here.' }],
    redesignPatches: [],
  };
  const review = toScreenReview(lenient, at('mobile-expo'));
  assert.deepEqual(rules(review.findings), [`blocker ${WEB_LAYOUT_RULE}`, `blocker ${CLIPART_RULE}`], 'a mobile app classed as "marketing" on a phone is caught even though no finding said so');
  assert.match(review.findings[0]!.message, /^Web marketing layout detected in a mobile viewport: the reviewer classed this mobile app screen as "marketing"/);
  assert.equal(review.slopScore, SLOP_FLOOR_ON_TRAP, 'a trapped screen cannot carry a low slop score');
  assert.deepEqual(review.patches.map((p) => [p.action, p.target]), [['restructure', null], ['replace_with_viewfinder', 'main > div.hero-art']]);
  assert.equal(review.patches[1]!.instruction, 'Put an InteractiveDropzone here.');
  assert.match(review.patches[0]!.instruction, /MobileShell\.Header[\s\S]*MobileShell\.Content[\s\S]*MobileShell\.BottomDock/);

  // A web product may really be a landing page, and a tablet is not held to the phone rule: no blocker is invented there.
  const clean: VisionReply = { ...lenient, findings: [], slopScore: 18 };
  assert.deepEqual(toScreenReview(clean, at('web-vite-react')).findings, []);
  assert.deepEqual(toScreenReview(clean, at('mobile-expo', 'ipad-pro-11')).findings, []);
  assert.equal(toScreenReview(clean, at('web-vite-react')).slopScore, 18);
});

test('a reply is bounded before it is believed: scores clamped, unknown elements unlocated, lists capped', () => {
  const wild: VisionReply = {
    archetype: 'mobile-app',
    slopScore: 250,
    critique: 'x'.repeat(2000),
    rubric: { hierarchy: 14, whitespace: -3, typography: Number.NaN, color: 9, copy: 9, originality: 9, tactility: 9 },
    findings: Array.from({ length: 14 }, (_, i) => ({ category: 'copy' as const, severity: 'minor' as const, elementId: i === 0 ? 'e999' : 'e2', observation: `o${i}`, fix: 'f' })),
    redesignPatches: Array.from({ length: 9 }, () => ({ elementId: 'e4', action: 'restyle' as const, instruction: 'i' })),
  };
  const review = toScreenReview(wild, at('mobile-expo'));
  assert.deepEqual([review.rubric.hierarchy, review.rubric.whitespace, review.rubric.typography, review.slopScore], [10, 0, 0, 100]);
  assert.equal(review.critique.length, 600);
  assert.equal(review.findings.length, 10);
  assert.equal(review.findings[0]!.selector, null, 'an id that is not in the element list locates nothing');
  assert.equal(review.patches.length, 6);
});

test('the verdict: slop fails a clean screen, a trap is an F, and no review means no grade and no pass', () => {
  const taste = (score: number): Record<string, number> => ({ hierarchy: score, whitespace: score, typography: score, color: score, copy: score, originality: score, tactility: score });
  const blocker: Finding = { rule: 'contrast/text', category: 'contrast', severity: 'blocker', source: 'dom', viewport: 'iphone-15-pro', route: '/', message: 'm', selector: 'p', bbox: null, fix: 'f', file: null, line: null };

  assert.deepEqual(gradeAudit([], { rubric: taste(9), slopScore: 5 }, 85), { score: 97, passed: true, blockers: 0, majors: 0, minors: 0, grade: 'S' });
  assert.equal(gradeAudit([], { rubric: taste(8), slopScore: 20 }, 85).grade, 'A');
  assert.deepEqual([gradeAudit([], { rubric: taste(7), slopScore: SLOP_PASS_MAX }, 85).grade, gradeAudit([], { rubric: taste(7), slopScore: SLOP_PASS_MAX }, 85).passed], ['B', true]);

  const generic = gradeAudit([], { rubric: taste(9), slopScore: SLOP_PASS_MAX + 1 }, 85);
  assert.deepEqual([generic.passed, generic.grade, generic.score > 85], [false, 'C', true], 'a high number does not carry a templated screen over the line');
  assert.equal(gradeAudit([blocker], { rubric: taste(9), slopScore: 10 }, 85).grade, 'D');

  const trapped = toScreenReview(SLOP_REPLY, at('mobile-expo'));
  const slop = gradeAudit(trapped.findings, { rubric: trapped.rubric, slopScore: trapped.slopScore }, 85);
  assert.deepEqual([slop.passed, slop.grade, slop.blockers, trapped.slopScore >= SLOP_FAIL], [false, 'F', 2, true]);

  // The case that started this: a clean measurement and nobody looking.
  assert.deepEqual(gradeAudit([], null, 85), { score: UNREVIEWED_SCORE_CAP, passed: false, blockers: 0, majors: 0, minors: 0, grade: null });
  assert.deepEqual(gradeAudit([], null, 40), { score: 50, passed: false, blockers: 0, majors: 0, minors: 0, grade: null }, 'not even under a threshold the cap would clear');
  assert.equal(gradeAudit([blocker, { ...blocker, rule: 'touch/target-size', selector: 'a' }, { ...blocker, rule: 'render/blank', selector: null }, { ...blocker, rule: 'type/x', selector: 'b' }], null, 85).score, 44, 'the cap is a ceiling, not a floor');
});

// ------------------------------------------------------------------ the auditor, with the browser stood in for

const PNG = Buffer.from('89504e470d0a1a0a', 'hex');

/** A browser that "renders" one fixed screen: enough for the auditor to capture, measure and hand over for review. */
function fakeBrowser(digest: PageDigest): QaBrowser {
  const page = {
    goto: async () => ({ status: () => 200 }),
    // The auditor evaluates twice per page: once to settle fonts (no argument), once to collect the digest.
    evaluate: async (_fn: unknown, arg?: unknown) => (arg === undefined ? undefined : digest),
    screenshot: async () => PNG,
  };
  const context = { newPage: async () => page, close: async () => undefined };
  const browser = { newContext: async () => context };
  return { use: async (_project: Project, _signal: AbortSignal | undefined, fn: (session: unknown) => Promise<void>) => fn({ browser, host: 'app', devices }) } as unknown as QaBrowser;
}

const READY: VisionAvailability = { status: 'ready', paths: ['codex', 'claude-code'], reason: null };

function fakeVision(availability: VisionAvailability, review: (input: VisionInput, call: number) => VisionReply | Error): { bridge: QaVisionBridge; calls: VisionInput[] } {
  const calls: VisionInput[] = [];
  const bridge = {
    availability: async () => availability,
    review: async (input: VisionInput) => {
      calls.push(input);
      const said = review(input, calls.length);
      if (said instanceof Error) throw said;
      return { review: toScreenReview(said, input), via: 'codex' as const, model: 'codex:default' };
    },
  } as unknown as QaVisionBridge;
  return { bridge, calls };
}

async function auditWith(project: Project, vision: QaVisionBridge, digest: PageDigest = SCREEN): Promise<{ report: AuditReport; stored: AuditReport; events: { type: string; [key: string]: unknown }[] }> {
  const d = await testDaemon();
  try {
    const { store, events } = d.daemon;
    store.insertProject(project);
    const auditor = new VisualAuditor({ config: d.config, store, events, browser: fakeBrowser(digest), vision, clock: () => 1000, log: quietLog });
    const report = await auditor.audit({ project, taskId: null, port: 8081, routes: ['/'] });
    return { report, stored: store.getAudit(report.id)!, events: events.history({ projectId: project.id }, 0, 50).map((e) => e.body) };
  } finally {
    await d.cleanup();
  }
}

const garim = { ...sampleProject('garim'), template: 'mobile-expo' } as const;

test('the 가림 screen through the whole audit: grade F, a redesign plan, and feedback an engine can act on', async () => {
  const vision = fakeVision(READY, () => SLOP_REPLY);
  const { report, stored, events } = await auditWith(garim, vision.bridge);

  assert.deepEqual(vision.calls.map((c) => c.viewport), ['iphone-15-pro', 'ipad-pro-11'], 'a phone app is judged at phone and tablet size, never at desktop width');
  assert.deepEqual([...new Set(report.screenshots.map((s) => s.viewport))], ['iphone-15-pro', 'ipad-pro-11']);
  assert.equal(vision.calls[0]!.template, 'mobile-expo');

  assert.deepEqual([report.visionReviewed, report.passed, report.grade, report.archetype], [true, false, 'F', 'marketing']);
  assert.deepEqual(report.vision, { status: 'reviewed', via: 'codex', model: 'codex:default', limited: false, reviewed: 2, expected: 2, reason: null }, 'the report names who judged');
  assert.ok(report.slopScore! >= SLOP_FAIL && report.score < 85, `slop ${report.slopScore}, score ${report.score}`);
  assert.equal(report.critique, SLOP_REPLY.critique);
  assert.equal(report.rubric!.tactility, 3);
  assert.deepEqual([...new Set(report.redesignPatches.map((p) => p.action))], ['replace_with_viewfinder', 'dock_to_bottom']);
  assert.deepEqual(stored, report, 'the report reads back as it was written');
  assert.deepEqual(events.find((e) => e.type === 'audit.completed'), { type: 'audit.completed', auditId: report.id, score: report.score, passed: false, blockers: 2, majors: 1, minors: 1, visionReviewed: true, grade: 'F' });
  assert.equal(events.some((e) => e.type === 'notice'), false);

  const feedback = renderAuditFeedback(report);
  assert.match(feedback, /Design review: grade F, slop score \d+\/100 \(lower is better; above 30 does not pass\), laid out as marketing\./);
  assert.match(feedback, /Design lead: App resembles a static web form/);
  assert.match(feedback, /Redesign plan from the design review, most important first:\n1\. \[replace_with_viewfinder\] iphone-15-pro \| \/ \| selector: main > div\.hero-art\n   Replace the static parcel image with an InteractiveDropzone/);
  assert.match(feedback, /\n2\. \[dock_to_bottom\] iphone-15-pro \| \/ \| selector: footer > button\.submit\n/);
  assert.doesNotMatch(feedback, /\n3\. \[/, 'the tablet asked for the same two moves; the plan lists each once');
  assert.match(feedback, /- \[blocker\] vision\/stock-clipart \(design review\)\n  iphone-15-pro \| \/ \| selector: main > div\.hero-art \| box: x=24 y=282 345×241px/);

  // A reviewed failure is the engine's to fix.
  assert.deepEqual(visualOutcome(report, 85).unverified, undefined);
  assert.equal(visualOutcome(report, 85).passed, false);
});

test('a web product is still judged at all three sizes, and a screen that earns it passes with a grade', async () => {
  const good: VisionReply = { archetype: 'web-app', slopScore: 6, critique: 'Calm and specific.', rubric: { hierarchy: 9, whitespace: 9, typography: 9, color: 9, copy: 9, originality: 9, tactility: 9 }, findings: [], redesignPatches: [] };
  const vision = fakeVision(READY, () => good);
  const { report } = await auditWith(sampleProject(), vision.bridge);
  assert.deepEqual(vision.calls.map((c) => c.viewport), ['iphone-15-pro', 'ipad-pro-11', 'desktop-1440']);
  assert.deepEqual([report.visionReviewed, report.passed, report.grade, report.score, report.slopScore], [true, true, 'S', 96.8, 6]);
  assert.deepEqual(auditViewports('mobile-expo', ['desktop-1440']), ['desktop-1440'], 'an owner who configured only desktop still gets an audit');
});

test('truth in reporting: with nobody to ask, a measured-clean screen is capped at 50, ungraded and not passed', async () => {
  const unavailable: VisionAvailability = { status: 'unavailable', paths: [], reason: 'no model to ask: there is no Anthropic API key in the vault and the Claude Code CLI is not available' };
  const vision = fakeVision(unavailable, () => new Error('must not be called'));
  const { report, stored, events } = await auditWith(garim, vision.bridge);

  assert.equal(vision.calls.length, 0);
  assert.deepEqual(report.findings, [], 'nothing measurable is wrong with it');
  assert.deepEqual([report.visionReviewed, report.score, report.passed, report.grade, report.rubric, report.slopScore], [false, 50, false, null, null, null]);
  assert.deepEqual(report.vision, { status: 'unavailable', via: null, model: null, limited: false, reviewed: 0, expected: 2, reason: unavailable.reason });
  assert.equal(stored.visionReviewed, false);
  assert.match(String(events.find((e) => e.type === 'notice')!.message), /^Design review did not run \(no model to ask[\s\S]*The design is not verified: the audit score is capped at 50 and the audit does not pass\.$/);
  assert.deepEqual(events.find((e) => e.type === 'audit.completed'), { type: 'audit.completed', auditId: report.id, score: 50, passed: false, blockers: 0, majors: 0, minors: 0, visionReviewed: false, grade: null });
  assert.match(renderAuditFeedback(report), /Design review did not run \(no model to ask[\s\S]*The design is unverified: the score is capped at 50 and what follows is measurements only\./);

  // Not a pass, and not something to send an engine round after round: it has nothing to fix.
  // Nor something to wait for: nobody is coming back by the clock when nobody is set up.
  assert.deepEqual([visualOutcome(report, 85).passed, visualOutcome(report, 85).unverified, visualOutcome(report, 85).waitable], [false, true, undefined]);
});

test('an unreviewed screen with a measured defect is a plain failure, and the engine is told what to fix', async () => {
  const off: VisionAvailability = { status: 'off', paths: [], reason: 'the design review is switched off (audit.vision in config.json)' };
  const tiny = { ...SCREEN, elements: [...SCREEN.elements, el({ id: 'e9', tag: 'button', role: 'button', selector: 'header > button.close', text: 'x', textLength: 1, interactive: true, w: 20, h: 20, y: 40 })] };
  const { report } = await auditWith(garim, fakeVision(off, () => new Error('must not be called')).bridge, tiny);
  assert.equal(report.vision.status, 'off');
  assert.ok(report.findings.some((f) => f.rule === 'touch/target-size' && f.severity === 'blocker'));
  assert.deepEqual([report.score, report.passed], [50, false], 'measured 86 with one blocker, capped like any unreviewed audit');
  assert.deepEqual([visualOutcome(report, 85).passed, visualOutcome(report, 85).unverified], [false, undefined]);
});

test('a review that covers only some screens is said to be partial, and does not pass', async () => {
  const good: VisionReply = { ...SLOP_REPLY, archetype: 'mobile-app', slopScore: 5, findings: [], redesignPatches: [], rubric: { hierarchy: 9, whitespace: 9, typography: 9, color: 9, copy: 9, originality: 9, tactility: 9 } };
  const vision = fakeVision(READY, (_input, call) => (call === 1 ? good : new VisionUnavailableError('Claude subscription: timed out', [{ path: 'claude-code', error: 'timed out', limited: false }], false)));
  const { report, events } = await auditWith(garim, vision.bridge);
  assert.equal(vision.calls.length, 2);
  assert.deepEqual([report.visionReviewed, report.passed, report.grade, report.score], [false, false, null, 50]);
  assert.deepEqual(report.vision, { status: 'partial', via: 'codex', model: 'codex:default', limited: false, reviewed: 1, expected: 2, reason: 'Claude subscription: timed out' });
  assert.equal(report.rubric!.hierarchy, 9, 'what was reviewed is kept, as information');
  assert.match(String(events.find((e) => e.type === 'notice')!.message), /^Design review covered 1 of 2 screens/);
});

test('a refusal that cannot go differently is not asked for again on every screen', async () => {
  const vision = fakeVision(READY, () => new VisionUnavailableError('API key: denied by policy (budget.project-daily): project daily budget exhausted', [{ path: 'api', error: 'denied', limited: true }], true));
  const { report } = await auditWith(sampleProject(), vision.bridge);
  assert.equal(vision.calls.length, 1, 'three screens were captured; the wall was hit once');
  assert.deepEqual([report.vision.status, report.vision.expected, report.visionReviewed, report.vision.limited], ['failed', 3, false, true]);
  assert.match(report.vision.reason!, /budget\.project-daily/);
});

test('every reviewer at its usage limit: the audit is unreviewed for a reason that passes, so the task it belongs to can wait', async () => {
  const limit = new VisionUnavailableError('Codex subscription: You\'ve hit your usage limit; Claude subscription: Claude 구독의 사용 한도에 걸렸습니다.', [{ path: 'codex', error: 'usage limit', limited: true }, { path: 'claude-code', error: '한도', limited: true }], false);
  const vision = fakeVision(READY, () => limit);
  const { report } = await auditWith(garim, vision.bridge);
  assert.equal(vision.calls.length, 2, 'both screens were tried before giving up');
  assert.deepEqual(report.vision, { status: 'failed', via: null, model: null, limited: true, reviewed: 0, expected: 2, reason: limit.message });
  assert.deepEqual([report.score, report.passed, report.grade], [50, false, null], 'it is still not a pass while it waits');
  assert.deepEqual([visualOutcome(report, 85).passed, visualOutcome(report, 85).unverified, visualOutcome(report, 85).waitable], [false, true, true]);
});

test('an audit recorded before coverage was tracked reads back as what it was', async () => {
  const d = await testDaemon();
  try {
    const { store } = d.daemon;
    const legacy = { id: 'aud_old', projectId: 'prj_studio', taskId: null, createdAt: 1, score: 100, threshold: 85, passed: true, rubric: null, findings: [], screenshots: [] };
    store.insertAudit(legacy as unknown as AuditReport);
    const read = store.getAudit('aud_old')!;
    assert.deepEqual([read.visionReviewed, read.vision.status, read.grade, read.redesignPatches], [false, 'failed', null, []], 'a 100 with no rubric was never reviewed');
    assert.deepEqual([read.score, read.passed], [50, false], 'and reads back the way such an audit is reported now, not as the pass it was recorded as');

    store.insertAudit({ ...legacy, id: 'aud_old_reviewed', score: 91, rubric: { hierarchy: 9 } } as unknown as AuditReport);
    const reviewed = store.getAudit('aud_old_reviewed')!;
    assert.deepEqual([reviewed.visionReviewed, reviewed.score, reviewed.passed], [true, 91, true], 'one that was reviewed keeps its verdict');
  } finally {
    await d.cleanup();
  }
});
