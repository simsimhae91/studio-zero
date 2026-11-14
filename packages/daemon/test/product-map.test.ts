// The product map: what a whole product is made of, checked by rule before anything is built from it.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ProductMap } from '@studio-zero/protocol';
import { notYetReal, readProductMap, renderProductMap } from '../src/product/ProductMap.ts';

type Feature = ProductMap['features'][number];
const feature = (id: string, over: Partial<Feature> = {}): Feature => ({
  id,
  name: `${id} 기능`,
  why: '상대와 겨루는 재미로 기록을 이어 가게 한다.',
  tier: 'expected',
  does: ['오늘 먹은 것을 한 끼씩 적는다', '적은 끼니가 오늘의 점수에 바로 더해진다'],
  screens: ['오늘'],
  needs: { data: ['meals'], device: [], ai: false, external: [] },
  inPreview: 'real',
  simulation: null,
  ...over,
});

/** A map that holds: seven features in three milestones, one of them standing in for a model nobody connected. */
export const SOUND: ProductMap = {
  pitch: '비슷한 체급의 상대와 2주 동안 겨루며 식단을 기록하는 다이어트 앱.',
  category: '습관 기록과 대결을 묶은 건강 앱. 눔, 챌린저스 옆에 놓인다.',
  pillars: ['공정한 매칭', '기록이 30초 안에 끝남', '지는 쪽도 다시 하고 싶음'],
  features: [
    feature('onboarding', { tier: 'core' }),
    feature('meal-log', { tier: 'core' }),
    feature('matching'),
    feature('ranking'),
    feature('meal-photo', { needs: { data: ['meals'], device: ['camera'], ai: true, external: [] }, inPreview: 'simulated', simulation: '음식표에서 고른 예시 추정이 대신한다. 사진을 읽는 모델을 외부 API로 연결하면 실제가 된다.' }),
    feature('health-sync', { needs: { data: ['activity'], device: ['health'], ai: false, external: [] }, inPreview: 'device-only', simulation: '걸음 수는 예시 기록으로 채운다. 기기 빌드에서 헬스키트 어댑터가 읽는다.' }),
    feature('result', { tier: 'delight' }),
  ],
  milestones: [
    { id: 'm1', name: '들어와서 기록하기', goal: '가입하고 오늘 먹은 것을 적는다.', features: ['onboarding', 'meal-log'], acceptance: ['새 사람이 가입하고 아침을 적으면 오늘 점수가 오른다.'] },
    { id: 'm2', name: '상대와 겨루기', goal: '상대가 잡히고 순위가 보인다.', features: ['matching', 'ranking', 'meal-photo'], acceptance: ['두 사람이 매칭을 누르면 서로가 상대로 보인다.'] },
    { id: 'm3', name: '끝과 몸', goal: '2주가 끝나면 결과를 보고 활동이 점수에 든다.', features: ['health-sync', 'result'], acceptance: ['대결이 끝난 사람이 결과 화면에서 이겼는지 본다.'] },
  ],
};

const problemsOf = (change: (map: ProductMap) => void): string[] => {
  const map = structuredClone(SOUND);
  change(map);
  const read = readProductMap(map);
  return read.ok ? [] : read.problems;
};

test('a map that holds reads, and is the same text every time it is written out for the owner', () => {
  const read = readProductMap(SOUND);
  assert.ok(read.ok, read.ok ? '' : read.problems.join('\n'));
  const text = renderProductMap(SOUND);
  assert.equal(text, renderProductMap(structuredClone(SOUND)));
  assert.match(text, /^# 제품 지도\n\n비슷한 체급의 상대와/);
  assert.match(text, /기능 7개를 마일스톤 3개로 짓는다\./);
  assert.match(text, /## 2\. 상대와 겨루기/);
  assert.match(text, /### meal-photo 기능 \(기본, 프리뷰에서는 예시\)/);
  assert.match(text, /필요한 것: 데이터 meals · 기기 camera · 모델/);
  assert.match(text, /프리뷰에서: 음식표에서 고른 예시 추정이 대신한다\./);
  assert.deepEqual(notYetReal(SOUND).map((line) => line.split(':')[0]), ['meal-photo 기능 (프리뷰에서는 예시)', 'health-sync 기능 (기기에서만)'], 'what the owner still has to connect or build, one line a feature');
});

test('each way a map fails to be a product is said, with the feature or milestone it is about', () => {
  assert.match(problemsOf((m) => void (m.features = m.features.slice(0, 4), m.milestones = [{ ...m.milestones[0]!, features: ['onboarding', 'meal-log'] }, { ...m.milestones[1]!, features: ['matching'] }, { ...m.milestones[2]!, features: ['ranking'] }])).join('\n'), /features has 4 entries; a product of this kind has at least 6/);
  assert.deepEqual(problemsOf((m) => void (m.features[2]!.does = ['매칭'])), ['feature "matching": does needs at least two lines, each something a person can do with it or sees ("찍은 사진에서 음식과 칼로리를 읽어 한 끼로 저장한다"). A name is not a behaviour.']);
  assert.match(problemsOf((m) => void (m.features[4]!.simulation = null))[0]!, /^feature "meal-photo": it is simulated in the preview and simulation is empty\./);
  assert.match(problemsOf((m) => void (m.features[5]!.inPreview = 'real'))[0]!, /^feature "health-sync": it needs health and says it is real in the preview\. The preview is a browser/);
  assert.deepEqual(problemsOf((m) => void m.milestones[1]!.features.pop()), ['feature "meal-photo" is in no milestone. Everything in the map is built; put it in one, or take it out.']);
  assert.match(problemsOf((m) => void m.milestones[2]!.features.push('matching'))[0]!, /^milestone 3 "m3": feature "matching" is already built in milestone "m2"\. Every feature is built in exactly one\.$/);
  assert.match(problemsOf((m) => void m.milestones[2]!.features.push('streaks'))[0]!, /^milestone 3 "m3": it names feature "streaks", which is not in features\.$/);
  assert.match(problemsOf((m) => void (m.milestones[1]!.features = ['matching', 'ranking', 'meal-photo', 'health-sync', 'result'], m.milestones[2]!.features = []))[0]!, /^milestone 2 "m2": it builds 5 features; 4 is the most one milestone builds whole\. Split it\.$/);
  assert.match(problemsOf((m) => void (m.milestones = m.milestones.slice(0, 2), m.milestones[1]!.features = ['matching', 'ranking', 'meal-photo', 'health-sync'], m.milestones[0]!.features.push('result'))).join('\n'), /milestones has 2 entries; give at least 3/);
  assert.match(problemsOf((m) => void (m.features[0]!.tier = 'expected', m.features[1]!.tier = 'expected')).join('\n'), /milestone 1 "m1" builds no core feature/);
  assert.match(problemsOf((m) => void (m.milestones[0]!.acceptance = ['됨'])).join('\n'), /milestone 1 "m1": acceptance is empty/);
  assert.match(problemsOf((m) => void (m.features[3]!.id = 'Ranking System')).join('\n'), /its id must be a short lowercase word/);
  const notAMap = readProductMap({ pitch: 'x' });
  assert.ok(!notAMap.ok && notAMap.problems.length > 0, 'something that is not a map is refused by its shape');
});
