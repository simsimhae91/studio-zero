// A product map that holds, for the tests that plan one and the tests that build from one.
import type { ProductMap } from '@studio-zero/protocol';

type Feature = ProductMap['features'][number];
export const feature = (id: string, over: Partial<Feature> = {}): Feature => ({
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
