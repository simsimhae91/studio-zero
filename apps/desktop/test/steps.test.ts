import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { EventBody, EventEnvelope } from '@studio-zero/protocol';
import { advisorCommand, classify, narrate, packagesOf, type Item, type Step } from '../src/lib/steps.ts';

const envelopes = (bodies: EventBody[]): EventEnvelope[] => bodies.map((body, i) => ({ seq: i + 1, at: 1000 + i, projectId: 'prj', taskId: 'tsk', body }));
const call = (callId: string, tool: string, input: string): EventBody => ({ type: 'tool.call', callId, tool, input });
const done = (callId: string, ok = true, exitCode: number | null = ok ? 0 : 1, preview = ''): EventBody => ({ type: 'tool.result', callId, ok, exitCode, durationMs: 1200, preview });
const steps = (items: Item[]): Step[] => items.flatMap((item) => (item.kind === 'steps' ? item.steps : []));
const rows = (items: Item[]): string[] => steps(items).map((s) => `[${s.state === 'done' ? '✓' : s.state === 'active' ? '▶' : '✗'}] ${s.title}${s.detail ? ` (${s.detail})` : ''}`);

test('a build reads as a handful of steps: scaffold, dependencies, files, a check in progress', () => {
  const items = narrate(
    envelopes([
      { type: 'task.phase', phase: 'execute', round: 1 },
      call('c1', 'bash', 'pnpm create expo-app . --template tabs'),
      done('c1'),
      call('c2', 'bash', 'pnpm add @shopify/react-native-skia expo-image-picker@^17 -D'),
      done('c2'),
      call('c3', 'bash', 'cd app && pnpm add zustand'),
      done('c3'),
      call('c4', 'write_file', 'app/(tabs)/index.tsx (2140 chars)'),
      done('c4', true, null),
      call('c5', 'write_file', 'src/mosaic/Overlay.tsx (3811 chars)'),
      done('c5', true, null),
      call('c6', 'edit_file', 'src/mosaic/Overlay.tsx'),
      done('c6', true, null),
      call('c7', 'bash', 'pnpm typecheck'),
    ]),
  );
  assert.deepEqual(rows(items), ['[✓] 프로젝트 스캐폴드 (Expo / TypeScript)', '[✓] 의존성 설치 (react-native-skia, expo-image-picker, zustand)', '[✓] 파일 2개 작성 (Overlay.tsx 외 1개)', '[▶] 타입 검사·빌드 실행 중 (pnpm typecheck)']);
  assert.equal(items.length, 1, 'one list, not a paragraph per step');
  const install = steps(items)[1]!;
  assert.deepEqual(install.lines.map((l) => [l.text, l.meta]), [['pnpm add @shopify/react-native-skia expo-image-picker@^17 -D', '완료, 1.2초'], ['cd app && pnpm add zustand', '완료, 1.2초']], 'every command is one click away');
});

test('what the agent says between steps is kept with the step, and only its closing words stand alone', () => {
  const plan = '1. 준비: .studio-zero/project.json 을 확인합니다.\n2. 스캐폴드: Expo 프로젝트를 만듭니다.\n3. …';
  const items = narrate(
    envelopes([
      { type: 'task.phase', phase: 'execute', round: 1 },
      { type: 'agent.text', text: plan },
      call('c1', 'bash', 'ls -la'),
      done('c1'),
      { type: 'agent.text', text: '이제 화면을 만듭니다.' },
      call('c2', 'write_file', 'src/App.tsx (900 chars)'),
      done('c2', true, null),
      { type: 'agent.text', text: '모자이크 화면을 만들었습니다. 사진 세 장을 예시로 넣었습니다.' },
      { type: 'task.phase', phase: 'verify', round: 1 },
    ]),
  );
  assert.deepEqual(items.map((i) => i.kind), ['steps', 'said', 'steps']);
  assert.deepEqual(rows(items).slice(0, 2), ['[✓] 코드 확인 (1건)', '[✓] 파일 1개 작성 (src/App.tsx)']);
  assert.deepEqual(steps(items)[0]!.notes, [plan], 'the planning monologue is a note on the step it led into, folded away');
  assert.deepEqual(steps(items)[1]!.notes, ['이제 화면을 만듭니다.']);
  const said = items.find((i) => i.kind === 'said')!;
  assert.equal(said.kind === 'said' && said.text, '모자이크 화면을 만들었습니다. 사진 세 장을 예시로 넣었습니다.');
});

test('verification is one step per round: the gates and evals that ran, the first failure opened up', () => {
  const items = narrate(
    envelopes([
      { type: 'task.phase', phase: 'verify', round: 1 },
      { type: 'gate.result', gate: 'compiler', name: 'npm run --silent typecheck', passed: false, exitCode: 2, durationMs: 4100, detail: "src/App.tsx(24,12): error TS2322: Type 'string' is not assignable to type 'number'." },
      { type: 'task.phase', phase: 'execute', round: 2 },
      call('c1', 'edit_file', 'src/App.tsx'),
      done('c1', true, null),
      { type: 'task.phase', phase: 'verify', round: 2 },
      { type: 'gate.result', gate: 'compiler', name: 'npm run --silent typecheck', passed: true, exitCode: 0, durationMs: 3900, detail: '' },
      { type: 'gate.result', gate: 'smoke', name: '/', passed: true, exitCode: null, durationMs: 2100, detail: '1 route loaded without errors' },
      { type: 'eval.result', evalId: 'e1', name: 'slop-lint', passed: true, durationMs: 60, detail: '0 minor findings' },
      { type: 'audit.completed', auditId: 'aud_1', score: 91.2, passed: true, blockers: 0, majors: 0, minors: 2 },
      { type: 'eval.result', evalId: 'e2', name: 'visual-audit', passed: true, durationMs: 14000, detail: 'score 91.2/100' },
      { type: 'task.state', state: 'succeeded', error: null },
    ]),
  );
  assert.deepEqual(rows(items), ['[✗] 검증 1회차 실패 (컴파일)', '[✓] 파일 1개 작성 (src/App.tsx)', '[✓] 검증 2회차 통과 (컴파일, 스모크 테스트, 슬롭 린트, 시각 감사)']);
  const [failed, , passed] = steps(items) as [Step, Step, Step];
  assert.deepEqual(failed.lines.map((l) => [l.text, l.tone, l.meta, l.output]), [['컴파일', 'bad', '실패, 종료 코드 2, 4.1초', "src/App.tsx(24,12): error TS2322: Type 'string' is not assignable to type 'number'."]]);
  assert.deepEqual(passed.audit, { score: 91.2, passed: true, blockers: 0, majors: 0, minors: 2 });
  assert.ok(passed.lines.every((l) => l.tone === 'good' && l.output === ''));
});

test('a round whose design review did not run is neither a pass nor a failure, and says which check it was', () => {
  const items = narrate(
    envelopes([
      { type: 'task.phase', phase: 'verify', round: 1 },
      { type: 'gate.result', gate: 'compiler', name: 'npm run --silent typecheck', passed: true, exitCode: 0, durationMs: 3900, detail: '' },
      { type: 'audit.completed', auditId: 'aud_2', score: 50, passed: false, blockers: 0, majors: 0, minors: 0, visionReviewed: false, grade: null },
      { type: 'eval.result', evalId: 'e2', name: 'visual-audit', passed: false, unverified: true, durationMs: 9000, detail: 'Design review did not run (no model to ask).' },
      { type: 'task.state', state: 'succeeded', error: null },
    ]),
  );
  assert.deepEqual(rows(items), ['[✓] 검증 1회차: 검증하지 못한 항목 있음 (시각 감사)']);
  const [round] = steps(items) as [Step];
  assert.deepEqual(round.lines.map((l) => [l.text, l.tone, l.meta]), [['컴파일', 'good', '통과, 3.9초'], ['시각 감사', 'warn', '검증하지 못함, 9.0초']]);
  assert.deepEqual(round.audit, { score: 50, passed: false, blockers: 0, majors: 0, minors: 0, visionReviewed: false });
});

test('a running verification is in progress; a plan is a step with its steps inside; a round with nothing to check says so', () => {
  const running = narrate(envelopes([{ type: 'plan.created', summary: '상세 화면에 결제 이력을 추가합니다.', steps: ['타입 정의', '섹션 추가'], auditRoutes: ['/'], appliedLessonIds: ['les_1'] }, { type: 'task.phase', phase: 'verify', round: 1 }]));
  assert.deepEqual(rows(running), ['[✓] 계획 2단계 (상세 화면에 결제 이력을 추가합니다.)', '[▶] 검증 1회차']);
  assert.deepEqual(steps(running)[0]!.lines.map((l) => l.text), ['타입 정의', '섹션 추가']);
  assert.deepEqual(steps(running)[0]!.notes, ['지난 작업의 교훈 1건을 반영했습니다.']);

  const empty = narrate(envelopes([{ type: 'task.phase', phase: 'verify', round: 1 }, { type: 'task.phase', phase: 'reflect', round: 0 }]));
  assert.deepEqual(rows(empty), ['[✓] 검증 1회차: 확인할 항목 없음']);
});

test('other voices keep their place in the stream: the owner steering, policy refusing, another model answering', () => {
  const items = narrate(
    envelopes([
      call('c1', 'bash', 'pnpm build'),
      done('c1', false, 1, 'error: Cannot find module'),
      { type: 'steer.queued', text: '버튼은 오른쪽에 두세요' },
      call('c2', 'edit_file', 'src/App.tsx'),
      { type: 'steer.delivered', count: 1 },
      done('c2', true, null),
      { type: 'policy.decision', actionKind: 'llm.request', actor: 'agent:tsk', effect: 'deny', rule: 'budget.task', reason: 'task budget exhausted' },
      { type: 'policy.decision', actionKind: 'sandbox.exec', actor: 'agent:tsk', effect: 'require_approval', rule: 'x', reason: 'not shown' },
      { type: 'advisor.answered', advisor: 'codex', question: 'Zustand?', ok: true, answer: 'Yes.', durationMs: 900 },
      { type: 'reflection.completed', outcome: 'recovered', lessonsAccepted: 1, lessonsRejected: 0, evalsAdded: 2 },
      { type: 'reflection.completed', outcome: 'clean', lessonsAccepted: 0, lessonsRejected: 0, evalsAdded: 0 },
    ]),
  );
  assert.deepEqual(items.map((i) => i.kind), ['steps', 'steer', 'steps', 'denied', 'advisor', 'note']);
  assert.deepEqual(rows(items), ['[✗] 타입 검사·빌드, 1건 실패 (pnpm build)', '[✓] 파일 1개 작성 (src/App.tsx)']);
  assert.equal(steps(items)[0]!.lines[0]!.output, 'error: Cannot find module', 'the output of what failed is there to read');
  const steer = items[1]!;
  assert.ok(steer.kind === 'steer' && steer.delivered);
  const advisor = items[4]!;
  assert.deepEqual(advisor.kind === 'advisor' && [advisor.advisor, advisor.answer], ['codex', 'Yes.']);
});

test('commands are sorted by what they do, and package names are read out of install commands', () => {
  assert.deepEqual(
    ['npx create-vite@latest . --template react-ts', 'pnpm install', 'pnpm exec tsc --noEmit', 'git status --short', 'node scripts/seed.mjs', 'pnpm dev'].map((c) => classify('bash', c)),
    ['scaffold', 'install', 'check', 'read', 'run', 'run'],
  );
  assert.deepEqual([classify('write_file', 'a.ts'), classify('read_file', 'a.ts'), classify('use_tool', 'github create_issue')], ['write', 'read', 'tool']);
  assert.deepEqual(packagesOf('pnpm add -D @types/node typescript@^5.9 && npm i react react-dom'), ['node', 'typescript', 'react', 'react-dom']);
  assert.deepEqual(packagesOf('pnpm install'), []);
  assert.deepEqual(packagesOf('npx expo install expo-haptics'), ['expo-haptics']);
});

test('the composer recognises a question for another model', () => {
  assert.deepEqual(advisorCommand('/ask-codex 상태 관리는 뭘로 할까?'), { advisor: 'codex', question: '상태 관리는 뭘로 할까?' });
  assert.deepEqual(advisorCommand('  /ask-gemini  두 줄\n질문  '), { advisor: 'gemini', question: '두 줄\n질문' });
  assert.deepEqual(advisorCommand('/ask-codex'), { advisor: 'codex', question: '' });
  assert.equal(advisorCommand('/ask-claude hi'), null);
  assert.equal(advisorCommand('ask codex about it'), null);
  assert.equal(advisorCommand('버튼을 /ask-codex 로 바꿔줘'), null, 'only at the start of the message');
});
