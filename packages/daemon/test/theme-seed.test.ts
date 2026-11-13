// Where a project's colours come from. A new project's theme is a placeholder that says so; an engine replaces
// it through one tool, choosing from the subject, and whatever it chooses comes out legible.
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { THEME_GENERATOR, faceFiles, faces, seedFromName } from '@studio-zero/design';
import { FONT_DIR, fontFile } from '../src/harness/fontKit.ts';
import { PLACEHOLDER_SOURCE, THEME_SEED_FILE, ThemeChoice, chosenTheme } from '../src/harness/themeSeed.ts';
import { codingSystemPrompt, directionBrief, IDEATION_BRIEF, MOCKUP_RULES, THEME_FILE } from '../src/harness/prompts.ts';
import { sampleProject, testDaemon } from './helpers.ts';

const OWNER = { type: 'owner', via: 'desktop' } as const;
const DIET = { hue: 48, chroma: 0.19, lightness: 0.72, neutral_hue: 80, neutral_chroma: 0.004, corners: 'round', face: 'suit', source: '2주 동안 매일 여는 앱이라 아침 식탁의 귤과 달걀 노른자에서 가져온 밝은 주황.' } as const;

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
    // The face comes with the theme: its one file sits beside the sheet that points at it, byte for byte.
    const fonts = join(d.workspace, FONT_DIR);
    const placeholderFace = seedFromName(project.slug).face!;
    assert.deepEqual(readdirSync(fonts), [faceFiles[placeholderFace].file], 'a project carries the one face it is set in');
    assert.ok((await read(THEME_FILE)).includes(`src: url("./fonts/${faceFiles[placeholderFace].file}") format("woff2-variations");`));
    assert.equal((await sandboxes.exec(project, 'git status --porcelain', { timeoutSec: 20 })).stdout, '', 'and it is committed with the theme');

    const task = await studio.submitTask(OWNER, { projectId: project.id, kind: 'ideate', prompt: '2주 다이어트 매칭 앱' }, 'desktop');
    const ctx = { project, taskId: task.id };
    const set = await toolbox.call(ctx, 'set_theme', DIET);
    assert.equal(set.isError, false, set.content);
    assert.match(set.content, /Theme set\. brand oklch\(72\.00% /, 'a bright brand stays as bright as it was asked for');
    const seed = JSON.parse(await read(THEME_SEED_FILE)) as Record<string, unknown>;
    assert.deepEqual([seed.hue, seed.lightness, seed.neutralHue, seed.corners, seed.face, seed.source], [48, 0.72, 80, 'round', 'suit', DIET.source]);
    assert.ok(!('display' in seed), 'there is no title face to record');
    const css = await read(THEME_FILE);
    assert.match(css, /seed: hue 48, chroma 0\.19, brand lightness 0\.72, neutral chroma 0\.004 toward hue 80, round corners, set in SUIT Variable/);
    assert.match(css, /--font-sans: "SUIT Variable", "SUIT", -apple-system, /, 'the chosen face leads the stack');
    assert.match(set.content, /set in SUIT Variable[^.]*\.studio-zero\/fonts\/SUIT-Variable\.woff2/, 'the engine is told the face is already there, so it installs nothing');
    const written = readFileSync(join(fonts, 'SUIT-Variable.woff2'));
    assert.ok(written.length > 100_000 && written.equals(await fontFile('suit').read()), `the file arrives whole: ${written.length} bytes`);
    assert.deepEqual(readdirSync(fonts), ['SUIT-Variable.woff2'], 'the face it was set in before is taken away with the sheet that named it');
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
    // A second colour is chosen only when the product has two sides; left out, it is derived, and the engine is told which.
    assert.match(mid.content, /second oklch\([^)]+\) carries text oklch\([^)]+\)[^.]*derived[^.]*hue 215/, 'derived: for an orange brand, a sky blue');
    const sided = await toolbox.call(ctx, 'set_theme', { ...DIET, second_hue: 200 });
    assert.equal(sided.isError, false, sided.content);
    assert.match(sided.content, /second oklch\([\d.]+% [\d.]+ 200\.0\) carries text oklch\([^)]+\)[^.]*the hue you chose/);
    assert.doesNotMatch(sided.content, /derived/);
    assert.match(sided.content, /series-1 to series-6/);
    assert.equal((JSON.parse(await read(THEME_SEED_FILE)) as { secondHue: number }).secondHue, 200);
    assert.match(await read(THEME_FILE), /--sz-second: oklch\([\d.]+% [\d.]+ 200\.0\);[\s\S]*--color-second: var\(--sz-second\);[\s\S]*--color-series-6: var\(--sz-series-6\);/);
    assert.match(ThemeChoice.shape.second_hue.description ?? '', /two sides[\s\S]*leave (it )?out/i, 'the engine is told when a second colour is its to choose');
    assert.equal((await toolbox.call(ctx, 'set_theme', { ...DIET, second_hue: 400 })).isError, true);
    // A title face is no longer something to choose: a choice that still names one and no face is refused, by name.
    const { face: _face, ...faceless } = DIET;
    const old = await toolbox.call(ctx, 'set_theme', { ...faceless, display: 'serif' });
    assert.equal(old.isError, true);
    assert.match(old.content, /invalid input for set_theme[\s\S]*face/);
    assert.deepEqual(ThemeChoice.safeParse({ ...faceless, display: 'serif' }).error?.issues.map((i) => i.path.join('.')), ['face']);
    assert.ok(!('display' in ThemeChoice.shape));
    assert.match(ThemeChoice.shape.face.description ?? '', /pretendard[\s\S]*suit[\s\S]*suite/i, 'the engine is told when each face fits');
  } finally {
    await d.cleanup();
  }
});

test('every face has its file where the studio can read it, under the name the sheet points at', async () => {
  for (const face of faces) {
    const file = fontFile(face);
    assert.equal(file.name, faceFiles[face].file);
    const bytes = await file.read();
    assert.equal(bytes.subarray(0, 4).toString('latin1'), 'wOF2', `${face} is a woff2 file`);
    assert.ok(bytes.length > 400_000, `${face}: ${bytes.length} bytes`);
  }
  const { css, tokensCss, face } = chosenTheme({ ...DIET, face: 'suite' });
  assert.equal(face, 'suite');
  assert.ok(css.includes('url("./fonts/SUITE-Variable.woff2")') && !tokensCss.includes('@font-face'), 'a page that carries its own faces copies the tokens, without the pointer to a file');
  assert.ok(tokensCss.includes('--font-sans: "SUITE Variable", "SUITE", '));
});

// Review focus 1: a project made before the faces were fixed. Its seed names a title pairing and its sheet names
// Fraunces; audited as it stands it would be told its fonts are foreign, which no engine can fix by hand in a file
// it may not edit.
test('a project from before the faces were fixed has its sheet regenerated from its own seed', async () => {
  const d = await testDaemon();
  try {
    const { store, provisioner, sandboxes } = d.daemon;
    const project = sampleProject('before');
    store.insertProject(project);
    await provisioner.ensure(project);
    const read = async (path: string): Promise<string> => (await sandboxes.exec(project, `cat ${path}`, { timeoutSec: 20 })).stdout;
    const subject = async (): Promise<string> => (await sandboxes.exec(project, 'git log -1 --format=%s', { timeoutSec: 20 })).stdout.trim();
    const OLD_SEED = { hue: 55, chroma: 0.15, neutralChroma: 0.004, corners: 'soft', display: 'serif', lightness: 0.72, neutralHue: 80, secondHue: 210, source: '아침 7시 부엌 창으로 들어오는 살구빛 햇살에서 왔다.' };
    const OLD_SHEET = `/* Generated by @studio-zero/design from the design contract. Edit the seed, not this file. */\n/* seed: hue 55, chroma 0.15, soft corners, titles in Fraunces + Noto Serif KR */\n\n:root { --sz-brand: oklch(72% 0.15 55); }\n@theme inline { --font-display: "Fraunces", "Noto Serif KR", "Pretendard Variable"; }\n`;
    const rewind = async (seed: string | null, sheet: string): Promise<void> => {
      if (seed === null) await sandboxes.exec(project, `rm -f ${THEME_SEED_FILE}`, { timeoutSec: 20 });
      else await sandboxes.writeFile(project, THEME_SEED_FILE, seed);
      await sandboxes.writeFile(project, THEME_FILE, sheet);
      await sandboxes.exec(project, `rm -rf ${FONT_DIR}`, { timeoutSec: 20 });
      await sandboxes.commitAll(project, 'test: as the project was');
    };

    await rewind(`${JSON.stringify(OLD_SEED, null, 2)}\n`, OLD_SHEET);
    await provisioner.ensure(project);
    const css = await read(THEME_FILE);
    assert.equal(css.split('\n')[1], `/* generator ${THEME_GENERATOR} */`);
    assert.match(css, /seed: hue 55, chroma 0\.15, brand lightness 0\.72, neutral chroma 0\.004 toward hue 80, soft corners, set in Pretendard Variable/, 'the same colour and shape, in the face every seed without one is set in');
    assert.ok(!/Fraunces|Noto Serif/.test(css) && css.includes('--color-brand: var(--sz-brand);'));
    const seed = JSON.parse(await read(THEME_SEED_FILE)) as Record<string, unknown>;
    assert.deepEqual(seed, { hue: 55, chroma: 0.15, neutralChroma: 0.004, corners: 'soft', lightness: 0.72, neutralHue: 80, secondHue: 210, source: OLD_SEED.source }, 'every field it had but the title face');
    assert.match(css, /--sz-second: oklch\([\d.]+% [\d.]+ 210\.0\);/, 'a second colour the seed names is the one the sheet gets');
    assert.ok(readFileSync(join(d.workspace, FONT_DIR, 'PretendardVariable.woff2')).equals(await fontFile('pretendard').read()));
    assert.equal(await subject(), 'chore: add the Studio Zero theme (regenerated)');
    assert.equal((await sandboxes.exec(project, 'git status --porcelain', { timeoutSec: 20 })).stdout, '');

    // Once it is this generator's sheet it is the project's again: a second look changes nothing.
    const head = async (): Promise<string> => (await sandboxes.exec(project, 'git rev-parse HEAD', { timeoutSec: 20 })).stdout.trim();
    const regenerated = await head();
    await provisioner.ensure(project);
    assert.equal(await head(), regenerated, 'nothing more was committed');
    assert.equal(await read(THEME_FILE), css);

    // What cannot be regenerated is left as it was: a sheet with no seed beside it, and a seed that is not one.
    for (const stored of [null, '{ "hue": "orange" }\n', 'not json']) {
      await rewind(stored, OLD_SHEET);
      await provisioner.ensure(project);
      assert.equal(await read(THEME_FILE), OLD_SHEET, `seed ${stored}`);
      assert.equal(await subject(), 'test: as the project was');
      assert.ok(!existsSync(join(d.workspace, FONT_DIR)));
    }
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
  const build = { hue: 55, chroma: 0.15, lightness: 0.72, neutral_chroma: 0.018, corners: 'soft', face: 'pretendard', source: '아침 7시 부엌 창으로 들어오는 살구빛 햇살과, 같은 시각 다른 집에서도 체중계에 오르는 하루의 첫 순간에서 왔다.' } as const;
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

test('the engines are given the scale down to its micro step; what goes where on it is the handbook\'s', () => {
  for (const prompt of [codingSystemPrompt('mobile-expo'), codingSystemPrompt('web-vite-react')]) {
    assert.match(prompt, /text-2xs to text-10xl \(11, 12, 14, 16/, 'the micro step is on the scale the engine is given');
    assert.match(prompt, /tabular-nums/, 'figures that are compared line up');
    assert.doesNotMatch(prompt, /body text is Geist/);
  }
  assert.doesNotMatch(MOCKUP_RULES, /Hangul falls to the reader's own system face/);
});
