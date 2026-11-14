// The product map: what a whole product is made of, checked by rule before anything is built from it.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ProductMap } from '@studio-zero/protocol';
import { PRODUCT_MAP_PROMPT } from '../src/harness/prompts.ts';
import type { ClaudeClient } from '../src/llm/ClaudeClient.ts';
import { notYetReal, readProductMap, renderProductMap } from '../src/product/ProductMap.ts';
import { ProductMapError, planProductMap } from '../src/product/planner.ts';
import { SOUND } from './fixtures-product.ts';

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

/** A planner that answers with these maps in turn, and keeps what it was asked. */
function scripted(answers: unknown[]): { claude: Pick<ClaudeClient, 'structured'>; asked: { system: string; said: string[] }[] } {
  const asked: { system: string; said: string[] }[] = [];
  const claude = {
    structured: async (req: { system: string; content: { type: string; text?: string }[] }) => {
      asked.push({ system: req.system, said: req.content.map((block) => block.text ?? '') });
      return answers.shift() ?? assert.fail('the planner was asked once too often');
    },
  } as unknown as Pick<ClaudeClient, 'structured'>;
  return { claude, asked };
}
const scope = { projectId: 'prj_a', taskId: null };

test('a map is planned from the owner\'s request in one call, with the platform and what is connected said', async () => {
  const { claude, asked } = scripted([SOUND]);
  const map = await planProductMap({ claude, scope }, { request: '2주 다이어트 배틀 앱\n- 매칭\n- 랭킹', template: 'mobile-expo', connected: [], existing: null });
  assert.deepEqual(map, SOUND);
  assert.equal(asked.length, 1);
  assert.equal(asked[0]!.system, PRODUCT_MAP_PROMPT, 'the system prompt is the constant');
  assert.deepEqual(asked[0]!.said, [
    "The owner's request:\n2주 다이어트 배틀 앱\n- 매칭\n- 랭킹",
    'Platform: a phone app (Expo, React Native); the preview is its web build in a phone-sized browser.',
    'The owner has connected no outside service: nothing in the product can call a model or a paid API for real yet.',
    'The project is empty.',
  ]);
  const connected = scripted([SOUND]);
  await planProductMap({ claude: connected.claude, scope }, { request: 'x', template: 'web-next', connected: ['openai', 'kis'], existing: 'Screens: H-01 장부' });
  assert.equal(connected.asked[0]!.said[2], 'Outside services the owner has connected (by the name they gave each): openai, kis.');
  assert.match(connected.asked[0]!.said[3]!, /^What the project already has, from its screen plan:\n<untrusted-data id="[0-9a-f]{24}" source="sandbox-output">\nScreens: H-01 장부\n<\/untrusted-data id="[0-9a-f]{24}">\nKeep it:/, 'what was read from the workspace travels as data');
});

test('a map that does not hold is sent back once with what is wrong; a second that does not hold is not built from', async () => {
  const thin = { ...SOUND, features: SOUND.features.slice(0, 4), milestones: [SOUND.milestones[0]!, { ...SOUND.milestones[1]!, features: ['matching'] }, { ...SOUND.milestones[2]!, features: ['ranking'] }] };
  const { claude, asked } = scripted([thin, SOUND]);
  assert.deepEqual(await planProductMap({ claude, scope }, { request: '다이어트 배틀', template: 'mobile-expo', connected: [], existing: null }), SOUND);
  assert.equal(asked.length, 2);
  assert.equal(asked[1]!.system, PRODUCT_MAP_PROMPT);
  assert.match(asked[1]!.said[4]!, /^You wrote a map for this request and it does not hold yet\. Write the whole map again, the same product, with these put right:\n- features has 4 entries; a product of this kind has at least 6/);
  assert.match(asked[1]!.said[5]!, /^The map you wrote:\n<untrusted-data id="[0-9a-f]{24}" source="engine-output">\n\{"pitch":/, 'its own first answer comes back as data');

  const twice = scripted([thin, thin]);
  await assert.rejects(planProductMap({ claude: twice.claude, scope }, { request: '다이어트 배틀', template: 'mobile-expo', connected: [], existing: null }), (err: unknown) => err instanceof ProductMapError && /features has 4 entries/.test(err.problems[0]!));
  assert.equal(twice.asked.length, 2, 'asked twice and no more');
});
