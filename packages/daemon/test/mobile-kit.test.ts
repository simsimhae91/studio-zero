import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { lintSources } from '@studio-zero/design';
import { MOBILE_KIT_DIR, mobileKitFiles } from '../src/harness/mobileKit.ts';
import { codingSystemPrompt } from '../src/harness/prompts.ts';
import { sampleProject, testDaemon } from './helpers.ts';

const garim = { ...sampleProject('garim'), template: 'mobile-expo' } as const;

test('the mobile kit as a project receives it: complete, extensionless, native parts only, and clean under the project\'s own slop lint', async () => {
  const files = await mobileKitFiles();
  assert.deepEqual(files.map((f) => f.path), ['BottomSheet.tsx', 'InteractiveDropzone.tsx', 'MobileShell.tsx', 'README.md', 'TactileButton.tsx', 'index.ts', 'tactile.tsx', 'tokens.ts']);
  const code = files.filter((f) => !f.path.endsWith('.md'));
  for (const file of code) assert.doesNotMatch(file.content, /from\s+['"]\.{1,2}\/[^'"]+\.tsx?['"]/, file.path);

  // What the kit asks a project to have installed: an Expo app's own stack and nothing more.
  const imported = new Set(code.flatMap((f) => [...f.content.matchAll(/from\s+['"]([^.'"][^'"]*)['"]/g)].map((m) => m[1]!)));
  assert.deepEqual([...imported].sort(), ['expo-haptics', 'react', 'react-native', 'react-native-safe-area-context']);

  // A phone screen made of web elements runs on the web target and nowhere else.
  for (const file of code) assert.doesNotMatch(file.content, /<(div|span|button|img|section|header|footer|main|input)\b/, `${file.path} uses an HTML element`);

  // The kit is held to the gate the projects it goes into are held to: theme tokens only, no arbitrary values, no emoji.
  assert.deepEqual(lintSources(files.map((f) => ({ path: `${MOBILE_KIT_DIR}/${f.path}`, content: f.content }))), []);

  const index = files.find((f) => f.path === 'index.ts')!.content;
  for (const part of ['MobileShell', 'InteractiveDropzone', 'BottomSheet', 'TactileButton', 'Tactile', 'mobileTokens']) assert.match(index, new RegExp(`\\b${part}\\b`), part);
  const shell = files.find((f) => f.path === 'MobileShell.tsx')!.content;
  assert.match(shell, /Object\.assign\(Frame, \{ Header, Action, Content, BottomDock \}\)/);
  assert.match(shell, /useSafeAreaInsets/);
  assert.match(files.find((f) => f.path === 'tactile.tsx')!.content, /Animated\.spring\(scale/);
  assert.match(files.find((f) => f.path === 'BottomSheet.tsx')!.content, /Animated\.spring\(offset[\s\S]*PanResponder\.create/);
});

test('a mobile project is told to build from the kit; a web project is not handed a phone mandate', () => {
  const mobile = codingSystemPrompt('mobile-expo');
  const web = codingSystemPrompt('web-vite-react');
  assert.match(mobile, /<mobile_design_mandate>[\s\S]*1\. Never put a generic or static illustration under a headline[\s\S]*2\. Every screen has three zones[\s\S]*MobileShell\.Header[\s\S]*MobileShell\.Content[\s\S]*MobileShell\.BottomDock[\s\S]*3\. Paper, structure, punch[\s\S]*never paint a region cream, peach or yellow as paper[\s\S]*4\. Everything that can be pressed answers the press[\s\S]*5\. Type is a hierarchy[\s\S]*text-2xs or text-xs \(11 and 12px\) for timestamps[\s\S]*6\. Microcopy is short and human[\s\S]*"가릴 사진 가져오기"[\s\S]*<\/mobile_design_mandate>/);
  assert.match(mobile, /Those parts are already in \.studio-zero\/mobile-kit \(read its README\.md first/);
  assert.match(mobile, /renders each route at iPhone 15 Pro and iPad sizes,/);
  assert.match(mobile, /It is not judged at desktop width, so do not design a desktop layout for it/);
  assert.doesNotMatch(web, /mobile_design_mandate|mobile-kit/);
  assert.match(web, /renders each route at iPhone 15 Pro, iPad and desktop sizes,/);
  for (const prompt of [mobile, web]) assert.match(prompt, /fails a screen outright for filling space with a generic or static illustration/);
});

test('a mobile project gets the kit in its first commit, keeps its own copy, and a project that predates the kit gets it on the branch a task runs on', async () => {
  const d = await testDaemon();
  await d.daemon.start();
  try {
    const { store, provisioner, sandboxes } = d.daemon;
    store.insertProject(garim);
    await provisioner.ensure(garim);
    const kit = join(d.workspace, MOBILE_KIT_DIR);
    for (const path of ['index.ts', 'tokens.ts', 'MobileShell.tsx', 'README.md']) assert.ok(existsSync(join(kit, path)), path);
    assert.match(readFileSync(join(kit, 'index.ts'), 'utf8'), /from '\.\/MobileShell';/);
    const log = async (): Promise<string> => (await sandboxes.exec(garim, 'git log --format=%s')).stdout.trim();
    assert.match(await log(), /^chore: add Studio Zero theme, project file, AX kit and mobile kit\n/);
    assert.equal((await sandboxes.exec(garim, 'git status --porcelain')).stdout, '');

    // The project changes its copy; provisioning again leaves it alone.
    writeFileSync(join(kit, 'tokens.ts'), '// ours now\n');
    await sandboxes.commitAll(garim, 'feat: adapt the kit');
    await provisioner.ensure(garim);
    assert.equal(readFileSync(join(kit, 'tokens.ts'), 'utf8'), '// ours now\n');

    // A project from before the kit existed: its branches do not have it. The next provisioning adds it where the work is.
    await sandboxes.exec(garim, `git rm -r -q ${MOBILE_KIT_DIR} && git -c user.name=t -c user.email=t@t commit -q -m "as it was before the kit"`);
    await sandboxes.startBranch(garim, 'sz/tsk_next', 'main');
    assert.equal(existsSync(join(kit, 'index.ts')), false);
    await provisioner.ensure(garim);
    assert.ok(existsSync(join(kit, 'index.ts')));
    assert.match(await log(), /^chore: add the Studio Zero mobile kit\n/);
    assert.equal((await sandboxes.exec(garim, 'git rev-parse --abbrev-ref HEAD')).stdout.trim(), 'sz/tsk_next', 'on the task branch, not on main');
  } finally {
    await d.cleanup();
  }
});

test('a web project is not given the mobile kit', async () => {
  const d = await testDaemon();
  await d.daemon.start();
  try {
    const project = sampleProject();
    d.daemon.store.insertProject(project);
    await d.daemon.provisioner.ensure(project);
    assert.equal(existsSync(join(d.workspace, MOBILE_KIT_DIR)), false);
    assert.match((await d.daemon.sandboxes.exec(project, 'git log --format=%s')).stdout, /^chore: add Studio Zero theme, project file and AX kit\n/);
  } finally {
    await d.cleanup();
  }
});
