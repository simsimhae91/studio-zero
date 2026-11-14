import { ProductMap, type ProductFeature } from '@studio-zero/protocol';

export const PRODUCT_MAP_FILE = 'docs/product.json';
export const PRODUCT_DOC_FILE = 'docs/product.md';

/** A product, not a prototype: fewer features than this is what the map exists to stop. */
export const MIN_FEATURES = 6;
export const MAX_FEATURES = 40;
export const MIN_MILESTONES = 3;
export const MAX_MILESTONES = 12;
/** What one engine finishes in one sitting, each feature built whole and walked. */
export const MAX_FEATURES_PER_MILESTONE = 4;
const ID = /^[a-z][a-z0-9]*(?:-[a-z0-9]+){0,3}$/;

const blank = (text: string | null | undefined): boolean => (text ?? '').trim() === '';

/**
 * Whether a model's product map holds as one a product can be built from. A check by rule, no judgement: each
 * problem names the feature or milestone it is about and says what would make it hold, so that the map can be
 * sent back once with the list.
 *
 * What it cannot check is whether the features are the right ones. That is the planner's work and the owner's
 * reading; what is checked here is that there are enough of them to be a product, that each says what a person
 * does with it, that every one of them is built in some milestone, and that a milestone is a slice an engine
 * finishes.
 */
export function readProductMap(input: unknown): { ok: true; map: ProductMap } | { ok: false; problems: string[] } {
  const parsed = ProductMap.safeParse(input);
  if (!parsed.success) return { ok: false, problems: parsed.error.issues.slice(0, 12).map((issue) => `${issue.path.join('.') || 'the map'}: ${issue.message}`) };
  const map = parsed.data;
  const problems: string[] = [];

  if (blank(map.pitch)) problems.push('pitch is empty: say in one sentence what the product is and for whom.');
  if (blank(map.category)) problems.push('category is empty: say what kind of product this is and which real products it sits beside.');
  if (map.pillars.filter((pillar) => !blank(pillar)).length < 2) problems.push('pillars: name at least two things this product has to be good at.');

  if (map.features.length < MIN_FEATURES) problems.push(`features has ${map.features.length} entries; a product of this kind has at least ${MIN_FEATURES}. Besides what the owner named, give what a person who installs it expects to find (getting started, their own record and history, their profile and settings, what brings them back).`);
  if (map.features.length > MAX_FEATURES) problems.push(`features has ${map.features.length} entries; ${MAX_FEATURES} is the most. Fold the smallest into the feature they belong to.`);
  const ids = new Set<string>();
  for (const feature of map.features) {
    const at = `feature "${feature.id}"`;
    if (!ID.test(feature.id)) problems.push(`${at}: its id must be a short lowercase word, or a few joined by hyphens ("matching", "meal-photo").`);
    if (ids.has(feature.id)) problems.push(`${at}: the id is used twice.`);
    ids.add(feature.id);
    if (blank(feature.name)) problems.push(`${at}: name is empty.`);
    if (blank(feature.why)) problems.push(`${at}: why is empty. Say what a person gets from it.`);
    if (feature.does.filter((line) => !blank(line) && line.trim().length >= 8).length < 2) problems.push(`${at}: does needs at least two lines, each something a person can do with it or sees ("찍은 사진에서 음식과 칼로리를 읽어 한 끼로 저장한다"). A name is not a behaviour.`);
    if (feature.screens.filter((screen) => !blank(screen)).length === 0) problems.push(`${at}: screens is empty. Name the screens it needs; a feature with no screen is not something a person meets.`);
    if (feature.inPreview !== 'real' && blank(feature.simulation)) problems.push(`${at}: it is ${feature.inPreview} in the preview and simulation is empty. Say what stands in for the missing part there, and what the owner connects or builds to make it real.`);
    if (feature.inPreview === 'real' && feature.needs.device.some((device) => /health|push|notification/i.test(device))) problems.push(`${at}: it needs ${feature.needs.device.join(', ')} and says it is real in the preview. The preview is a browser: health data and push do not exist there. Make it simulated or device-only and say what stands in.`);
  }

  if (map.milestones.length < MIN_MILESTONES) problems.push(`milestones has ${map.milestones.length} entries; give at least ${MIN_MILESTONES}. A product built in one or two steps is built too wide to be walked.`);
  if (map.milestones.length > MAX_MILESTONES) problems.push(`milestones has ${map.milestones.length} entries; ${MAX_MILESTONES} is the most.`);
  const placed = new Map<string, string>();
  const milestoneIds = new Set<string>();
  for (const [i, milestone] of map.milestones.entries()) {
    const at = `milestone ${i + 1} "${milestone.id}"`;
    if (!ID.test(milestone.id)) problems.push(`${at}: its id must be a short lowercase word ("m1", "matching").`);
    if (milestoneIds.has(milestone.id)) problems.push(`${at}: the id is used twice.`);
    milestoneIds.add(milestone.id);
    if (blank(milestone.name)) problems.push(`${at}: name is empty.`);
    if (blank(milestone.goal)) problems.push(`${at}: goal is empty. Say what a person can do once it is built that they could not before.`);
    if (milestone.features.length === 0) problems.push(`${at}: it builds no feature.`);
    if (milestone.features.length > MAX_FEATURES_PER_MILESTONE) problems.push(`${at}: it builds ${milestone.features.length} features; ${MAX_FEATURES_PER_MILESTONE} is the most one milestone builds whole. Split it.`);
    if (milestone.acceptance.filter((line) => !blank(line) && line.trim().length >= 12).length === 0) problems.push(`${at}: acceptance is empty. Say what a new person does and then sees when it is done.`);
    for (const id of milestone.features) {
      if (!ids.has(id)) problems.push(`${at}: it names feature "${id}", which is not in features.`);
      else if (placed.has(id)) problems.push(`${at}: feature "${id}" is already built in milestone "${placed.get(id)}". Every feature is built in exactly one.`);
      else placed.set(id, milestone.id);
    }
  }
  for (const feature of map.features) if (!placed.has(feature.id)) problems.push(`feature "${feature.id}" is in no milestone. Everything in the map is built; put it in one, or take it out.`);
  const first = map.milestones[0];
  if (first && !first.features.some((id) => map.features.find((feature) => feature.id === id)?.tier === 'core')) problems.push(`milestone 1 "${first.id}" builds no core feature. The first thing built is the thing the product exists for, with getting in.`);

  return problems.length > 0 ? { ok: false, problems } : { ok: true, map };
}

const STANDING: Record<ProductFeature['inPreview'], string> = { real: '프리뷰에서 실제로 동작', simulated: '프리뷰에서는 예시', 'device-only': '기기에서만' };
const TIER: Record<ProductFeature['tier'], string> = { core: '핵심', expected: '기본', delight: '매력' };

/**
 * The map as the owner reads it. Daemon code, not a model: the same map is always the same text. Every word of
 * a feature is the planner's, shown as text.
 */
export function renderProductMap(map: ProductMap): string {
  const line = (text: string): string => text.replace(/\s+/g, ' ').trim();
  const byId = new Map(map.features.map((feature) => [feature.id, feature]));
  const out = [`# 제품 지도`, '', line(map.pitch), '', `**어떤 제품인가.** ${line(map.category)}`, '', '**잘해야 하는 것**', '', ...map.pillars.map((pillar) => `- ${line(pillar)}`)];
  out.push('', `기능 ${map.features.length}개를 마일스톤 ${map.milestones.length}개로 짓는다.`);
  for (const [i, milestone] of map.milestones.entries()) {
    out.push('', `## ${i + 1}. ${line(milestone.name)}`, '', line(milestone.goal));
    for (const id of milestone.features) {
      const feature = byId.get(id);
      if (!feature) continue;
      out.push('', `### ${line(feature.name)} (${TIER[feature.tier]}, ${STANDING[feature.inPreview]})`, '', line(feature.why), '', ...feature.does.map((does) => `- ${line(does)}`));
      out.push('', `화면: ${feature.screens.map(line).join(', ')}`);
      const needs = [feature.needs.data.length > 0 ? `데이터 ${feature.needs.data.join(', ')}` : '', feature.needs.device.length > 0 ? `기기 ${feature.needs.device.join(', ')}` : '', feature.needs.ai ? '모델' : '', feature.needs.external.length > 0 ? `외부 ${feature.needs.external.join(', ')}` : ''].filter(Boolean);
      if (needs.length > 0) out.push('', `필요한 것: ${needs.join(' · ')}`);
      if (feature.simulation) out.push('', `프리뷰에서: ${line(feature.simulation)}`);
    }
    out.push('', '다 지어지면:', '', ...milestone.acceptance.map((accept) => `- ${line(accept)}`));
  }
  return `${out.join('\n')}\n`;
}

/** What a map leaves for the owner to connect or build before everything in it is real: one line a feature. */
export function notYetReal(map: ProductMap): string[] {
  return map.features.filter((feature) => feature.inPreview !== 'real').map((feature) => `${feature.name.trim()} (${STANDING[feature.inPreview]}): ${(feature.simulation ?? '').replace(/\s+/g, ' ').trim()}`);
}
