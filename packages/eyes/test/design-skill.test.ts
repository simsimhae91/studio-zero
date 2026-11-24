import assert from 'node:assert/strict';
import { globSync, readFileSync } from 'node:fs';
import { test } from 'node:test';

const plugin = new URL('../../../plugin/', import.meta.url);
const skill = (name: string) => readFileSync(new URL('skills/' + name, plugin), 'utf8');

test('the prototype switches paper, ink and brand together and both handbooks name the same stock palette', () => {
  const design = skill('design/SKILL.md');
  for (const token of ['--bg-bg', '--text-fg', '--bg-brand', 'data-theme', 'localStorage', '?t=<name>'])
    assert.ok(design.includes(token), token);
  assert.doesNotMatch(design, /The colour is one token/);
  for (const path of globSync(['**/*.md', 'workflows/*.js'], { cwd: plugin }))
    assert.doesNotMatch(readFileSync(new URL(path, plugin), 'utf8'), /\?c=/, path);
  const direction = design.match(/Write the top of `direction\.md`:[\s\S]+?```\n([\s\S]+?)\n```/)![1]!;
  for (const line of ['표면:', '온도:', '버릴 기본값:', '비워 둔 것과 정한 것:', '빌더에게 넘긴 것:', '주인이 고른 테마:'])
    assert.ok(direction.includes('\n' + line), line);

  const handover = design.split('## 7. Hand over')[1]!;
  assert.match(handover, /the chosen theme's name/);
  assert.match(handover, /theme block as it stands \(paper, ink, brand/);

  const palette = (kind: string) => skill('taste/references/handbook-' + kind + '.md').match(/^C8\..+$/m)![0];
  assert.equal(palette('phone'), palette('web'));
  assert.match(palette('phone'), /not pure white/);
  for (const colour of ['#4F46E5', '#2563EB', '#8B5CF6', '#10B981']) {
    assert.ok(direction.includes(colour), colour);
    assert.ok(palette('phone').includes(colour), colour);
  }
});
