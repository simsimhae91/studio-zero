// The house bar and the platform guidance: what engines and the reviewer are told a first screen is held to,
// the Modern Web Guidance tool (pinned, and never reporting a query to its maker), and the one thing the bar
// asks of a phone app that static lint can see.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Project } from '@studio-zero/protocol';
import { lintSources } from '@studio-zero/design';
import type { McpRegistry } from '../src/mcp/McpRegistry.ts';
import { HOUSE_BAR_MOBILE, HOUSE_BAR_WEB, WEB_GUIDANCE_VERSION } from '../src/harness/houseBar.ts';
import { MOCKUP_RULES, codingSystemPrompt, directionBrief } from '../src/harness/prompts.ts';
import { Toolbox } from '../src/harness/Toolbox.ts';
import { visionParts, type VisionInput } from '../src/qa/vision.ts';
import type { OrbStackManager } from '../src/sandbox/OrbStackManager.ts';
import { sampleProject, testDaemon } from './helpers.ts';

test('the bar is said to whoever draws or builds, and to whoever judges, in the same words', () => {
  const web = codingSystemPrompt('web-vite-react');
  const phone = codingSystemPrompt('mobile-expo');
  assert.ok(web.includes(HOUSE_BAR_WEB) && !web.includes(HOUSE_BAR_MOBILE));
  assert.ok(phone.includes(HOUSE_BAR_MOBILE) && !phone.includes(HOUSE_BAR_WEB), 'a phone app is held to the awards, not to a web page\'s bar');
  assert.match(HOUSE_BAR_WEB, /One idea from the subject, carried into the small parts/);
  assert.match(HOUSE_BAR_WEB, /The real thing is on the first screen, and it works there/);
  assert.match(HOUSE_BAR_WEB, /None of this is a look to copy/);
  assert.match(HOUSE_BAR_MOBILE, /Interaction: "intuitive interfaces and effortless controls"[\s\S]*Inclusivity: "a great experience for all"[\s\S]*Never switch font scaling off/);
  // No engine is handed a site to imitate: the bar is principles, and the sources stay in the source.
  for (const site of ['agentshot', 'kuroko', 'shapefinder', 'whatsintheirbag', 'novadeck', 'forevercomponents', 'hakonfreyr', 'braindump']) assert.ok(!web.includes(site) && !phone.includes(site));

  // The reviewer is shown the bar with a first screen, and only then.
  const input = (firstScreen: boolean, template: 'web-vite-react' | 'mobile-expo') => ({ template, viewport: 'desktop-1440', route: '/', firstScreen, mockup: false, folds: [], measured: [], digest: { width: 1440, height: 900, elements: [] } }) as unknown as VisionInput;
  assert.ok(visionParts(input(true, 'web-vite-react')).head.includes(HOUSE_BAR_WEB));
  assert.ok(visionParts(input(true, 'mobile-expo')).head.includes(HOUSE_BAR_MOBILE));
  assert.ok(!visionParts(input(false, 'web-vite-react')).head.includes('What that has looked like'));
});

test('engines are told to ask the platform first, and a mock-up may be made of the browser\'s own parts', () => {
  const web = codingSystemPrompt('web-vite-react');
  assert.match(web, /Platform first\. Before you hand-write a behaviour the browser may already have, ask web_guidance/);
  assert.match(web, /run web_guidance with action "scan" and act on what holds under its own keep and drop conditions; what it lists is provisional/);
  assert.ok(!codingSystemPrompt('mobile-expo').includes('Platform first'), 'the guidance is the web platform\'s');
  for (const brief of [MOCKUP_RULES, directionBrief({ file: 'docs/mockups/a.html', themeFile: 't', seed: 's', scene: 'sc', row: 'r', others: 'o' })]) {
    assert.match(brief, /<details name="\.\.\."> for one panel open at a time\), a popover opened by a button's popovertarget/);
    assert.match(brief, /@starting-style with transition-behavior: allow-discrete/);
    assert.match(brief, /a guide that needs a script does not apply to a mock-up/);
  }
});

test('web_guidance: a pinned package run in the sandbox with its reporting switched off, the query quoted whole', async () => {
  const d = await testDaemon();
  try {
    const { policy, events, store, studio } = d.daemon;
    const project: Project = sampleProject('guide');
    store.insertProject(project);
    const task = await studio.submitTask({ type: 'owner', via: 'desktop' }, { projectId: project.id, kind: 'build', prompt: '결제 화면' }, 'desktop');
    const ran: string[] = [];
    let reply = { exitCode: 0, stdout: '[{"id":"dialog","description":"Build a modal or non-modal dialog component"}]', stderr: '' };
    const sandboxes = { exec: async (_project: Project, script: string) => (ran.push(script), { ...reply, timedOut: false, durationMs: 1 }) } as unknown as OrbStackManager;
    const toolbox = new Toolbox({ sandboxes, policy, events, mcp: {} as McpRegistry });
    assert.ok(toolbox.definitions().some((t) => t.name === 'web_guidance'));
    const ctx = { project, taskId: task.id };

    const found = await toolbox.call(ctx, 'web_guidance', { action: 'search', query: "a dialog that won't scroll the page; rm -rf $HOME `id`" });
    assert.equal(found.isError, false);
    assert.match(found.content, /<untrusted-data[^>]*source="external-tool"[\s\S]*"id":"dialog"/, 'a third party\'s text comes back as data');
    assert.equal(ran[0], `cd /workspace && out=$(mktemp) && DISABLE_TELEMETRY=1 NO_COLOR=1 npx -y modern-web-guidance@${WEB_GUIDANCE_VERSION} search 'a dialog that won'\\''t scroll the page; rm -rf $HOME \`id\`' > "$out"; code=$?; cat "$out"; rm -f "$out"; exit $code`);
    assert.match(WEB_GUIDANCE_VERSION, /^\d+\.\d+\.\d+$/, 'a version, not "latest"');

    await toolbox.call(ctx, 'web_guidance', { action: 'retrieve', ids: ['dialog', 'animate-to-from-top-layer'] });
    assert.ok(ran[1]!.includes(` retrieve 'dialog,animate-to-from-top-layer' > "$out"`));
    await toolbox.call(ctx, 'web_guidance', { action: 'scan' });
    assert.ok(ran[2]!.includes(` legacy-scan '.' --json > "$out"`));
    assert.ok(ran.every((script) => script.includes('DISABLE_TELEMETRY=1')), 'no call reports a query');

    // What cannot be asked is refused before anything runs; what cannot be read is said, with what to do instead.
    for (const bad of [{ action: 'search' }, { action: 'retrieve' }, { action: 'retrieve', ids: ['a', 'b', 'c'] }, { action: 'retrieve', ids: ['Dialog; ls'] }, { action: 'scan', path: '../other' }, { action: 'install' }]) assert.equal((await toolbox.call(ctx, 'web_guidance', bad)).isError, true, JSON.stringify(bad));
    assert.equal(ran.length, 3);
    reply = { exitCode: 1, stdout: '', stderr: 'npm error code ENOTFOUND' };
    const down = await toolbox.call(ctx, 'web_guidance', { action: 'search', query: 'tabs' });
    assert.ok(down.isError && /could not be read \(npm error code ENOTFOUND\)\. Build it from what you know/.test(down.content));
    reply = { exitCode: 0, stdout: '[]', stderr: '' };
    assert.match((await toolbox.call(ctx, 'web_guidance', { action: 'search', query: 'no such thing' })).content, /No guide matches/);
  } finally {
    await d.cleanup();
  }
});

test('a phone app that pins its text against the system size setting is a defect', () => {
  const lint = (code: string) => lintSources([{ path: 'app/index.tsx', content: code }]).filter((f) => f.rule === 'slop/font-scaling-off');
  const off = lint('export const A = () => <Text allowFontScaling={false}>오늘 3,200걸음</Text>;\nexport const B = () => <Text maxFontSizeMultiplier={1}>합계</Text>;\n');
  assert.deepEqual(off.map((f) => [f.severity, f.line]), [['major', 1], ['major', 2]]);
  assert.deepEqual(lint('export const A = () => <Text maxFontSizeMultiplier={1.6}>오늘 3,200걸음</Text>;\nexport const B = () => <Text allowFontScaling>합계</Text>;\n'), [], 'a ceiling above 1 still follows the setting');
});
