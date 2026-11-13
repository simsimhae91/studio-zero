// The design lab's blind review: every measured page under a neutral id, in a shuffled order, with nothing in
// its name or its folder that says which source tree drew it; and each direction's two pages as an unlabelled
// pair. The key that maps ids back to arms is written beside them and is not shown to a reviewer.
//
//   node review-prep.mjs <labDir>
//   reads  <labDir>/metrics/<arm>-<brief>-<row>.json and its screenshots, <labDir>/briefs/<brief>/…
//   writes <labDir>/review/{items.json,pairs.json,key.json,items/*.png,pairs/*.png}
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const lab = process.argv[2];
const out = join(lab, 'review');
rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, 'items'), { recursive: true });
mkdirSync(join(out, 'pairs'), { recursive: true });

// A fixed shuffle: the same order every time the lab is prepared, and no clock or dice in it.
let state = 20261113;
const next = () => ((state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 2 ** 32);
const shuffled = (list) => {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

const pages = readdirSync(join(lab, 'metrics'))
  .filter((name) => name.endsWith('.json'))
  .map((name) => {
    const [, arm, brief, row] = /^([a-z0-9]+)-([a-z]+)-([abc])\.json$/.exec(name) ?? [];
    // A first draft is measured for the record and is not put to a reviewer.
    return arm && ['baseline', 'production', 'treatment', 'treatment2'].includes(arm) ? { arm, brief, row, prefix: join(lab, 'metrics', name.replace(/\.json$/, '')) } : null;
  })
  .filter(Boolean);

const briefOf = (brief) => {
  const template = readFileSync(join(lab, 'briefs', brief, 'template.txt'), 'utf8').trim();
  const table = JSON.parse(readFileSync(join(lab, 'briefs', brief, 'docs', 'mockups', 'directions.json'), 'utf8'));
  return { template, scene: table.scene, concept: Object.fromEntries(table.directions.map((d) => [d.id, d.concept])) };
};
const briefs = Object.fromEntries([...new Set(pages.map((p) => p.brief))].map((b) => [b, briefOf(b)]));
const shotsFor = (page) => (briefs[page.brief].template === 'mobile-expo' ? ['phone', 'phone-full'] : ['desktop', 'desktop-full', 'phone']).filter((kind) => existsSync(`${page.prefix}-${kind}.png`));

const key = { items: {}, pairs: {} };
const items = shuffled(pages).map((page, i) => {
  const id = `p${String(i + 1).padStart(2, '0')}`;
  const images = shotsFor(page).map((kind) => {
    const file = join(out, 'items', `${id}-${kind}.png`);
    copyFileSync(`${page.prefix}-${kind}.png`, file);
    return { kind, file };
  });
  key.items[id] = { arm: page.arm, brief: page.brief, row: page.row };
  const b = briefs[page.brief];
  return { id, product: b.template === 'mobile-expo' ? 'a phone app' : 'a web product', template: b.template, scene: b.scene, concept: b.concept[page.row], images };
});

// Each direction drawn twice: once from each tree. Which is A and which is B is decided by the shuffle.
const AGAINST = { baseline: 'treatment', production: 'treatment2' };
const pairs = [];
for (const page of pages) {
  const otherArm = AGAINST[page.arm];
  const other = otherArm && pages.find((p) => p.arm === otherArm && p.brief === page.brief && p.row === page.row);
  if (!other) continue;
  const id = `q${String(pairs.length + 1).padStart(2, '0')}`;
  const [a, b] = next() < 0.5 ? [page, other] : [other, page];
  const kind = briefs[page.brief].template === 'mobile-expo' ? 'phone' : 'desktop';
  const files = {};
  for (const [side, p] of [['A', a], ['B', b]]) {
    files[side] = [];
    for (const k of briefs[page.brief].template === 'mobile-expo' ? ['phone', 'phone-full'] : ['desktop', 'phone']) {
      if (!existsSync(`${p.prefix}-${k}.png`)) continue;
      const file = join(out, 'pairs', `${id}-${side}-${k}.png`);
      copyFileSync(`${p.prefix}-${k}.png`, file);
      files[side].push({ kind: k, file });
    }
  }
  key.pairs[id] = { brief: page.brief, row: page.row, A: a.arm, B: b.arm };
  const br = briefs[page.brief];
  pairs.push({ id, product: br.template === 'mobile-expo' ? 'a phone app' : 'a web product', template: br.template, scene: br.scene, concept: br.concept[page.row], mainView: kind, A: files.A, B: files.B });
}

writeFileSync(join(out, 'items.json'), JSON.stringify(items, null, 1));
writeFileSync(join(out, 'pairs.json'), JSON.stringify(shuffled(pairs), null, 1));
writeFileSync(join(out, 'key.json'), JSON.stringify(key, null, 1));
process.stdout.write(`${items.length} items, ${pairs.length} pairs in ${out}\n`);
