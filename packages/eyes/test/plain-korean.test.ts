// 2026-11-27: the Korean the harness wrote came out in its own English turned word for word. The owner: "AI Slop
// 문구가 너무 많습니다. 선다, 짓는다, 열린다", and of a document made the day before, "문장(판, 짓는다, 세운다)".
// One writing task given sixteen times showed where it came from and what stops it: with the plugin's wording 39 of
// these words in ten thousand Hangul characters, with the same task in plain English 14, and with one sentence
// added to either, none (the briefs and what came back: ~/.studio-zero/specimens/2026-11-27/wording-test).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { globSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = new URL('../../../', import.meta.url);
const read = (path: string): string => readFileSync(new URL(path, root), 'utf8');
const RULE =
  "The Korean you write (to the owner, in files, on a product's screens) is the plain Korean a product team uses at work. Do not write 서다/세우다 (계획이 선다, 기준을 세운다), 짓다 (제품을 짓는다), 열리다 (결과가 열린다, 화면이 열린다) or 판 (첫 판, 새 판). Write 만들다, 구현하다, 정하다, 완성되다, 나오다, 뜨다, 보이다, 버전. The owner's own words are quoted as they said them.";

test('everyone who writes Korean for the owner or a product is given the same sentence about it', () => {
  const build = read('plugin/workflows/build.js');
  assert.ok(build.includes(`const KOREAN = '${RULE.replaceAll("'", "\\'")}'`));
  // The agents of a build carry it in the text each of them begins with; those with a definition, there.
  for (const name of ['TOOLS', 'DESIGN_GROUND'])
    assert.match(build, new RegExp(`^const ${name} = .* \\+ ' ' \\+ KOREAN$`, 'm'), name);
  const agents = globSync('plugin/agents/*.md', { cwd: fileURLToPath(root) });
  assert.ok(agents.length >= 7);
  for (const path of [...agents, 'plugin/codex/skills/build/SKILL.md', 'plugin/hooks/session-start.sh'])
    assert.ok(read(path).includes(RULE), path);
});

test('a session is told at its start, and again with each request written in Korean', () => {
  const hook = (name: string): string => fileURLToPath(new URL('plugin/hooks/' + name, root));
  const route = (prompt: string): string =>
    spawnSync(process.execPath, [hook('route.mjs')], { encoding: 'utf8', input: JSON.stringify({ prompt, cwd: tmpdir() }) }).stdout;
  assert.ok(route('로그인 버튼이 안 눌려요 고쳐 주세요').includes(RULE));
  const english = route('the login button does nothing, please fix it');
  assert.match(english, /^sz: /);
  assert.ok(!english.includes('The Korean you write'), 'a request in another language is not told about Korean');
  for (const cwd of [tmpdir(), fileURLToPath(root)])
    assert.ok(spawnSync('sh', [hook('session-start.sh')], { encoding: 'utf8', cwd, env: { ...process.env, CLAUDE_PLUGIN_ROOT: fileURLToPath(new URL('plugin', root)) } }).stdout.includes(RULE), cwd);
});

test('what the harness itself says in Korean does not use those words', () => {
  const words = /짓는|짓고|지어|지은|짓기|짓습|지었|짓게|지을|짓지|선다|서 있|서지 않|세운|세우|세워|열린다|열려|열립|첫 판|새 판|이번 판/;
  // The sentence that names the words, a phrase quoted from the owner, and Safari's own menu are not the harness speaking.
  const spoken = (text: string): string =>
    text.replaceAll(RULE, '').replaceAll(RULE.replaceAll("'", "\\'"), '').replace(/"[^"\n]*"|“[^”\n]*”|'[^'\n]*열린 탭 보기[^'\n]*'/g, '');
  const pages = ['README.md', 'plugin/README.md', ...globSync(['plugin/skills/**/*.md', 'plugin/agents/*.md', 'plugin/hooks/*', 'packages/eyes/src/**/*.ts'], { cwd: fileURLToPath(root) })];
  for (const path of pages)
    for (const [n, line] of spoken(read(path)).split('\n').entries())
      assert.doesNotMatch(line, words, `${path}:${n + 1}`);
});
