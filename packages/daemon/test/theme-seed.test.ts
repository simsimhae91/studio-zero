// Where a project's colours come from. A new project's theme is a placeholder that says so; an engine replaces
// it through one tool, choosing from the subject, and whatever it chooses comes out legible.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PLACEHOLDER_SOURCE, THEME_SEED_FILE, ThemeChoice, chosenTheme } from '../src/harness/themeSeed.ts';
import { codingSystemPrompt, directionBrief, IDEATION_BRIEF, MOCKUP_RULES, THEME_FILE } from '../src/harness/prompts.ts';
import { sampleProject, testDaemon } from './helpers.ts';

const OWNER = { type: 'owner', via: 'desktop' } as const;
const DIET = { hue: 48, chroma: 0.19, lightness: 0.72, neutral_hue: 80, neutral_chroma: 0.004, corners: 'round', display: 'grotesk', source: '2주 동안 매일 여는 앱이라 아침 식탁의 귤과 달걀 노른자에서 가져온 밝은 주황.' } as const;

test('a new project\'s theme is a placeholder that says so, and set_theme replaces it with a choice from the subject', async () => {
  const d = await testDaemon();
  try {
    const { store, studio, provisioner, sandboxes, toolbox } = d.daemon;
    const project = sampleProject('diet');
    store.insertProject(project);
    await provisioner.ensure(project);
    const read = async (path: string): Promise<string> => (await sandboxes.exec(project, `cat ${path}`, { timeoutSec: 20 })).stdout;
    assert.equal((JSON.parse(await read(THEME_SEED_FILE)) as { source: string }).source, PLACEHOLDER_SOURCE);
    assert.match(await read(THEME_FILE), /--sz-brand: oklch\(/, 'even the placeholder has a brand to fill with');

    const task = await studio.submitTask(OWNER, { projectId: project.id, kind: 'ideate', prompt: '2주 다이어트 매칭 앱' }, 'desktop');
    const ctx = { project, taskId: task.id };
    const set = await toolbox.call(ctx, 'set_theme', DIET);
    assert.equal(set.isError, false, set.content);
    assert.match(set.content, /Theme set\. brand oklch\(72\.00% /, 'a bright brand stays as bright as it was asked for');
    const seed = JSON.parse(await read(THEME_SEED_FILE)) as Record<string, unknown>;
    assert.deepEqual([seed.hue, seed.lightness, seed.neutralHue, seed.corners, seed.display, seed.source], [48, 0.72, 80, 'round', 'grotesk', DIET.source]);
    const css = await read(THEME_FILE);
    assert.match(css, /seed: hue 48, chroma 0\.19, brand lightness 0\.72, neutral chroma 0\.004 toward hue 80, round corners/);
    assert.match(css, /--color-brand: var\(--sz-brand\);\n\s+--color-on-brand: var\(--sz-on-brand\);\n\s+--color-brand-soft: var\(--sz-brand-soft\);/);

    // A lightness at which no text holds is moved, and the engine is told.
    const mid = await toolbox.call(ctx, 'set_theme', { ...DIET, lightness: 0.55 });
    assert.match(mid.content, /asked for at lightness 0\.55 and set at 0\.\d\d/);
    // Outside the generator's ranges nothing is written.
    const wild = await toolbox.call(ctx, 'set_theme', { ...DIET, chroma: 0.9, source: 'x' });
    assert.equal(wild.isError, true);
    assert.match(wild.content, /invalid input for set_theme/);
    assert.equal((JSON.parse(await read(THEME_SEED_FILE)) as { lightness: number }).lightness, 0.55, 'the refused call left the theme as it was');
    assert.ok(toolbox.mutates('set_theme'));
  } finally {
    await d.cleanup();
  }
});

test('the engines are told that colour is chosen from the subject, through the tool', () => {
  const prompt = codingSystemPrompt('web-vite-react');
  assert.match(prompt, /two products made here must not look alike because they were made here/);
  assert.match(prompt, /set_theme tool before you draw or build/);
  assert.match(prompt, /bg-brand with text-on-brand/);
  // Each direction has a look of its own: said in the table it is drawn from, and recorded in the page that is drawn.
  assert.match(IDEATION_BRIEF, /"theme": the palette and shape that belong to that concept, with the same fields set_theme takes/);
  assert.match(directionBrief({ file: 'docs/mockups/a.html', themeFile: '.studio-zero/themes/a.css', seed: '{}', scene: 's', row: 'r', others: 'o' }), /copy that file's custom properties into the page's :root[\s\S]*<meta name="theme-seed"/);
  assert.match(MOCKUP_RULES, /For each direction call set_theme with a palette and a shape that belong to that concept[\s\S]*<meta name="theme-seed"/, 'and the same when one engine draws them all');
  assert.match(prompt, /using the seed the page records in its theme-seed meta tag/, 'the build takes the approved page\'s look');
  assert.match(chosenTheme(DIET).json, /"source": "2주 동안/);
});

// What a real build chose on 2026-11-13 (docs/runs/2026-11-13-diet-match): hue 55 at neutral chroma 0.018, and the
// screens came out on cream paper (#fff9f5) with peach wells. The tool no longer admits paper that reads as a colour,
// and the brand it admits is a fill that is seen: clear to vivid, neither inky nor pastel.
test('the tool admits a punch colour on clean paper and nothing else', () => {
  const build = { hue: 55, chroma: 0.15, lightness: 0.72, neutral_chroma: 0.018, corners: 'soft', display: 'editorial', source: '아침 7시 부엌 창으로 들어오는 살구빛 햇살과, 같은 시각 다른 집에서도 체중계에 오르는 하루의 첫 순간에서 왔다.' } as const;
  const refused = ThemeChoice.safeParse(build);
  assert.ok(!refused.success);
  assert.deepEqual(refused.error.issues.map((i) => i.path.join('.')), ['neutral_chroma'], 'the paper is what was wrong with it');
  assert.ok(ThemeChoice.safeParse({ ...build, neutral_chroma: 0.005 }).success, 'the faintest lean is the most a paper may have');
  assert.ok(ThemeChoice.safeParse({ ...build, neutral_chroma: 0 }).success);
  for (const [field, value] of [['chroma', 0.08], ['chroma', 0.3], ['lightness', 0.3], ['lightness', 0.84]] as const) {
    const bad = ThemeChoice.safeParse({ ...build, neutral_chroma: 0, [field]: value });
    assert.ok(!bad.success && bad.error.issues.every((i) => i.path[0] === field), `${field} ${value}: a muted, inky or pastel brand is not a punch`);
  }
  // The high-contrast set the band was drawn around, in OKLCH: orange #FF5C00, cobalt #2563EB, coral #FF3B30, emerald #10B981, violet #7C3AED.
  for (const [hue, chroma, lightness] of [[41, 0.21, 0.68], [263, 0.21, 0.55], [29, 0.23, 0.65], [162, 0.15, 0.7], [293, 0.25, 0.54]] as const) {
    const choice = { ...build, hue, chroma, lightness, neutral_chroma: 0.004 };
    assert.ok(ThemeChoice.safeParse(choice).success, `hue ${hue}`);
    assert.match(chosenTheme(choice).report, /^Theme set\. brand oklch\(/);
  }
  assert.match(ThemeChoice.shape.neutral_chroma.description ?? '', /cream|peach|yellow/i, 'the engine is told which paper is off the table');
});

test('the engines are told the paper is clean, the figures tabular and Hangul set in Pretendard', () => {
  const mobile = codingSystemPrompt('mobile-expo');
  const web = codingSystemPrompt('web-vite-react');
  for (const prompt of [mobile, web]) {
    assert.match(prompt, /Pretendard/, 'the body face');
    assert.match(prompt, /pretendard package/, 'and where its files come from');
    assert.doesNotMatch(prompt, /body text is Geist/);
    assert.match(prompt, /text-2xs to text-10xl \(11, 12, 14, 16/, 'the micro step is on the scale the engine is given');
    assert.match(prompt, /tabular-nums/, 'figures that are compared line up');
  }
  assert.match(mobile, /cream, peach or yellow/, 'a phone screen\'s paper is near-white or a cool grey');
  assert.match(mobile, /bg-brand[^.]*punch/i, 'the brand is the ten percent that is seen');
  assert.match(mobile, /11|12px[^.]*timestamps?/i, 'where the micro sizes go');
  assert.doesNotMatch(MOCKUP_RULES, /Hangul falls to the reader's own system face/);
  assert.match(MOCKUP_RULES, /Pretendard/, 'the studio supplies the Hangul face with the page');
  assert.match(MOCKUP_RULES, /tabular-nums/);
});
