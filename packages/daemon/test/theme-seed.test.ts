// Where a project's colours come from. A new project's theme is a placeholder that says so; an engine replaces
// it through one tool, choosing from the subject, and whatever it chooses comes out legible.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PLACEHOLDER_SOURCE, THEME_SEED_FILE, chosenTheme } from '../src/harness/themeSeed.ts';
import { codingSystemPrompt, directionBrief, IDEATION_BRIEF, MOCKUP_RULES, THEME_FILE } from '../src/harness/prompts.ts';
import { sampleProject, testDaemon } from './helpers.ts';

const OWNER = { type: 'owner', via: 'desktop' } as const;
const DIET = { hue: 48, chroma: 0.19, lightness: 0.84, neutral_hue: 80, neutral_chroma: 0.02, corners: 'round', display: 'grotesk', source: '2주 동안 매일 여는 앱이라 아침 식탁의 귤과 달걀 노른자에서 가져온 밝은 주황.' } as const;

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
    assert.match(set.content, /Theme set\. brand oklch\(84\.00% /, 'a bright brand stays as bright as it was asked for');
    const seed = JSON.parse(await read(THEME_SEED_FILE)) as Record<string, unknown>;
    assert.deepEqual([seed.hue, seed.lightness, seed.neutralHue, seed.corners, seed.display, seed.source], [48, 0.84, 80, 'round', 'grotesk', DIET.source]);
    const css = await read(THEME_FILE);
    assert.match(css, /seed: hue 48, chroma 0\.19, brand lightness 0\.84, neutral chroma 0\.02 toward hue 80, round corners/);
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
