import assert from 'node:assert/strict';
import { globSync, readFileSync } from 'node:fs';
import { test } from 'node:test';

const plugin = new URL('../../../plugin/', import.meta.url);
const skill = (name: string) => readFileSync(new URL('skills/' + name, plugin), 'utf8');

test('the prototype switches background, text colour and brand together', () => {
  const design = skill('design/SKILL.md');
  for (const token of ['--bg-bg', '--text-fg', '--bg-brand', 'data-theme', 'localStorage', '?t=<name>'])
    assert.ok(design.includes(token), token);
  assert.doesNotMatch(design, /The colour is one token/);
  for (const path of globSync(['**/*.md', 'workflows/*.js'], { cwd: plugin }))
    assert.doesNotMatch(readFileSync(new URL(path, plugin), 'utf8'), /\?c=/, path);
  const direction = design.match(/Write the top of `direction\.md`:[\s\S]+?```\n([\s\S]+?)\n```/)![1]!;
  for (const line of ['버릴 기본값:', '비워 둔 것과 정한 것:', '빌더에게 넘긴 것:', '주인이 고른 테마:'])
    assert.ok(direction.includes('\n' + line), line);

  const handover = design.split('## 7. Hand over')[1]!;
  assert.match(handover, /the chosen theme's name/);
  assert.match(handover, /theme block as it stands \(background, text colour, brand/);
});

// 2026-11-27: after the skill named white as the default to drop and gave a paper's material as the example,
// five new products in a row were drawn on cream, three of them beside a board that said its references were white.
test('the background follows the primary reference, white is not ruled out, and no material is given as an example', () => {
  const design = skill('design/SKILL.md');
  assert.match(design, /The background and the text colour are the one exception: they follow the primary reference/);
  assert.match(design, /White is a fine background/);
  const direction = design.match(/Write the top of `direction\.md`:[\s\S]+?```\n([\s\S]+?)\n```/)![1]!;
  assert.ok(direction.includes('| 색 — 바탕과 글자 |'));
  for (const gone of ['표면:', '온도:', '#FFFFFF', '#4F46E5'])
    assert.ok(!direction.includes(gone), gone);
  for (const text of [design, skill('taste/SKILL.md'), skill('taste/references/handbook-phone.md'), skill('taste/references/handbook-web.md')])
    assert.doesNotMatch(text, /영수증 종이|receipt's cream|not pure white|종이 L·hue|warmer or cooler|must not share/);

  const palette = (kind: string) => skill('taste/references/handbook-' + kind + '.md').match(/^C8\..+$/m)![0];
  assert.equal(palette('phone'), palette('web'));
  assert.match(palette('phone'), /The background is white unless the product is dark or its primary reference has a tinted one/);
});

test('with no reference tool the owner is asked once whether to connect, and the run says what the board was made with', () => {
  const design = skill('design/SKILL.md');
  assert.match(design, /ask them once before searching, "Mobbin과 Refero가 연결되어 있지 않습니다\. 연결하시겠어요\?"/);
  assert.match(design, /an agent of a run cannot ask/);
  const build = readFileSync(new URL('workflows/build.js', plugin), 'utf8');
  const when = /whenToUse: '([^\n]*)',\n/.exec(build)![1]!;
  assert.match(when, /try one search with Mobbin and one with Refero[^.]*; if neither answers, ask the owner once, in the same dialog as the questions: "Mobbin과 Refero가 연결되어 있지 않습니다\. 연결하시겠어요\?"/);
});
