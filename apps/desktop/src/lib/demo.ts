import type { Approval, PlanVersion, AuditReport, AxBlock, Checkpoint, Eval, EventBody, EventEnvelope, FileEntry, FlowTaskWalk, KnowledgeJob, LedgerEntry, Lesson, MethodName, ParamsOf, Project, ProposalCard, ResultOf, SandboxInfo, ScratchEntry, Scratchpad, ScreenSpec, Session, SubscriptionQuota, Task, OwnerSettings } from '@studio-zero/protocol';
import { matchesFilter } from '@studio-zero/protocol';
import type { Backend } from './backend.ts';

/**
 * A daemon made of fixtures (`?demo` in the URL). It exists so the interface can be reviewed, and put through
 * the same visual audit as the projects it builds, without a daemon, a model or a container engine.
 */

const T0 = Date.UTC(2026, 10, 12, 1, 30);
const min = (n: number): number => T0 + n * 60_000;

const projects: Project[] = [
  // The studio's own repository, pinned ahead of everything the owner made.
  { id: 'prj_core', slug: 'studio-zero-core', name: 'Studio Zero Core', template: 'studio-core', createdAt: min(-30) },
  { id: 'prj_ledger', slug: 'ledger', name: 'Ledger', template: 'web-vite-react', createdAt: min(-600) },
  { id: 'prj_atlas', slug: 'atlas', name: 'Atlas 모바일', template: 'mobile-expo', createdAt: min(-300) },
  { id: 'prj_tide', slug: 'tide', name: 'Tide 정산', template: 'web-vite-react', createdAt: min(-70) },
  { id: 'prj_pace', slug: 'pace', name: 'Pace 2주 식단', template: 'mobile-expo', createdAt: min(-12) },
  { id: 'prj_harbor', slug: 'harbor', name: 'Harbor 예약', template: 'web-vite-react', createdAt: min(-40) },
];

const baseTask = { projectId: 'prj_ledger', origin: 'desktop', engine: 'native-claude', model: 'claude-opus-5-5', budgetTokens: 2_000_000, error: null, baseBranch: null, enginePref: null, modelPref: null, effort: 'high', effortPref: null, sessionId: null, reviewerPref: null, references: [] as string[], track: 'full', parkedUntil: null, parkCount: 0 } as const;
const sessions: Session[] = [{ id: 'ses_refactor', projectId: 'prj_ledger', name: 'refactor/dates', createdAt: min(-241) }];
const tasks: Task[] = [
  {
    // A build the owner asked to see the plan of first: sent back once with a note, now waiting on the second version.
    ...baseTask, id: 'tsk_harbor_plan', projectId: 'prj_harbor', kind: 'build', prompt: '정박지 예약 현황판을 만들어줘. 오늘 들어오는 배가 먼저 보여야 한다.', state: 'awaiting_plan_review', phase: 'plan', branch: 'sz/tsk_harbor_plan', reviewPlan: true,
    spentTokens: 96_400, spentUsdMicros: 410_000, baseCheckpointId: null, summary: null, createdAt: min(-9), startedAt: min(-9), finishedAt: null,
  },
  {
    // A design task still at work: the documents are written and two directions are being drawn side by side.
    ...baseTask, id: 'tsk_pace_design', projectId: 'prj_pace', engine: 'claude-code', model: 'opus', kind: 'ideate', prompt: '둘씩 짝지어 2주 동안 같이 하는 식단 기록 앱. 상대가 오늘 기록했는지가 먼저 보여야 한다.', state: 'running', phase: 'execute', branch: 'sz/tsk_pace_design',
    spentTokens: 412_000, spentUsdMicros: 0, baseCheckpointId: null, summary: null, createdAt: min(-12), startedAt: min(-12), finishedAt: null,
  },
  {
    // A design task that ended: documents written, three first screens drawn, the build waiting for the owner's pick.
    ...baseTask, id: 'tsk_tide_design', projectId: 'prj_tide', engine: 'claude-code', model: 'opus', kind: 'ideate', prompt: '프리랜서 셋이 같이 쓰는 정산 도구. 누가 누구에게 얼마를 줘야 하는지 한눈에 보여야 한다.', state: 'succeeded', phase: null, branch: 'sz/tsk_tide_design',
    spentTokens: 318_000, spentUsdMicros: 0, baseCheckpointId: null, summary: '설계 문서 네 개와 첫 화면 시안 세 개를 만들었습니다. 문서는 A안을 기준으로 썼습니다.', createdAt: min(-66), startedAt: min(-66), finishedAt: min(-58),
  },
  {
    // A change to the studio itself: verified in its sandbox, copied out as a feature branch, waiting for the owner's merge.
    ...baseTask, id: 'tsk_core_quota', projectId: 'prj_core', engine: 'claude-code', model: 'opus', kind: 'build', prompt: '워크벤치 하단에 구독 현황 팝오버를 추가해줘', state: 'succeeded', phase: null, branch: 'sz/tsk_core_quota',
    spentTokens: 684_000, spentUsdMicros: 0, baseCheckpointId: null, summary: '하단 상태바와 팝오버를 추가했습니다. 컨테이너 엔진이 필요한 테스트는 이 샌드박스에서 건너뛰었습니다.', createdAt: min(-44), startedAt: min(-44), finishedAt: min(-31),
  },
  {
    // Done and committed, waiting for a design reviewer whose usage limit has to lift first.
    ...baseTask, id: 'tsk_atlas_home', projectId: 'prj_atlas', engine: 'claude-code', model: 'opus', kind: 'build', prompt: '지도 홈 화면을 모바일 키트로 다시 짜줘', state: 'suspended', phase: null, branch: 'sz/tsk_atlas_home',
    spentTokens: 1_240_000, spentUsdMicros: 0, baseCheckpointId: null, summary: null, createdAt: min(-52), startedAt: min(-52), finishedAt: null,
  },
  {
    ...baseTask, id: 'tsk_detail', kind: 'build', prompt: '청구서 상세 화면에 결제 이력을 추가해줘', state: 'awaiting_approval', phase: 'execute', branch: 'sz/tsk_detail',
    spentTokens: 2_004_300, spentUsdMicros: 9_120_000, baseCheckpointId: 'ckp_b', summary: null, createdAt: min(-18), startedAt: min(-18), finishedAt: null,
  },
  {
    ...baseTask, id: 'tsk_list', kind: 'build', prompt: '미결제 청구서 화면을 만들어줘', origin: 'telegram', state: 'succeeded', phase: null, branch: 'sz/tsk_list',
    spentTokens: 412_800, spentUsdMicros: 1_890_000, baseCheckpointId: 'ckp_a', summary: '미결제 청구서 목록을 만들었습니다. 고객별로 묶고, 가장 오래된 건이 맨 위에 옵니다. 금액은 원화 기준으로 가정했습니다.', createdAt: min(-95), startedAt: min(-95), finishedAt: min(-81),
  },
  {
    ...baseTask, id: 'tsk_refactor', kind: 'refactor', prompt: '날짜 포맷 함수를 한 곳으로 모아줘', engine: 'claude-code', model: 'opus', state: 'failed', phase: null, branch: 'sz/tsk_refactor', sessionId: 'ses_refactor',
    spentTokens: 96_200, spentUsdMicros: 0, baseCheckpointId: 'ckp_0', summary: null, error: 'verification still failing after 3 corrections: compiler', createdAt: min(-240), startedAt: min(-240), finishedAt: min(-231),
  },
];

/** The Harbor build's plan: the first version as the owner sent it back, and the second, waiting. */
const harborPlanV1 = `## 요약

정박지 예약을 표 한 장으로 보여 줍니다. 행은 정박지, 열은 날짜이고 예약된 칸을 칠합니다.

## 단계

1. src/data/berths.ts에 정박지 12곳과 2주치 예약 예시 데이터를 정의
2. 정박지 × 날짜 표를 src/routes/Board.tsx에 구성
3. 칸을 누르면 예약 상세를 옆 패널에 표시
4. 빈 상태와 불러오기 실패 문구 작성

## 끝나고 볼 화면

- \`/\`

## 가정한 것

- 정박지 수는 20곳을 넘지 않는다고 가정했습니다.
`;
const harborPlanV2 = `## 요약

오늘 들어오는 배를 맨 위에 도착 시각 순으로 세우고, 그 아래에 정박지별 2주 예약 표를 둡니다.

## 단계

1. src/data/berths.ts에 정박지 12곳과 2주치 예약 예시 데이터를 정의
2. 오늘 입항 목록을 src/routes/Board.tsx 맨 위에 도착 시각 순으로 구성
3. 그 아래에 정박지 × 날짜 표를 두고 오늘 열을 강조
4. 칸을 누르면 예약 상세를 옆 패널에 표시
5. 빈 상태와 불러오기 실패 문구 작성

## 끝나고 볼 화면

- \`/\`

## 가정한 것

- 정박지 수는 20곳을 넘지 않는다고 가정했습니다.
- 도착 시각은 예약에 적힌 예정 시각을 씁니다.
`;
const planVersions: PlanVersion[] = [
  {
    taskId: 'tsk_harbor_plan', version: 1, planMarkdown: harborPlanV1, sha256: 'a'.repeat(64), verdict: 'changes', createdAt: min(-7), resolvedAt: min(-5),
    reviewerNotes: '표가 화면의 주인이라 요청의 "오늘 들어오는 배"가 칸 하나로 묻힙니다.\n\nGaps:\n- 입항 시각이 바뀐 예약을 어떻게 보여 줄지 계획에 없습니다.',
    feedback: [{ quote: '행은 정박지, 열은 날짜이고 예약된 칸을 칠합니다.', comment: '표보다 오늘 들어오는 배 목록이 먼저입니다. 표는 그 아래로 내려 주세요.' }],
  },
  {
    taskId: 'tsk_harbor_plan', version: 2, planMarkdown: harborPlanV2, sha256: 'b'.repeat(64), verdict: null, createdAt: min(-3), resolvedAt: null, feedback: [],
    reviewerNotes: '오늘 입항 목록이 먼저 나와 요청과 맞습니다.\n\nGaps:\n- 늦게 도착한 배를 목록에서 어떻게 구분할지 정해 두면 좋습니다.',
  },
];
const harborBodies: EventBody[] = [
  { type: 'task.state', state: 'running', error: null },
  { type: 'task.phase', phase: 'plan', round: 0 },
  { type: 'plan.created', summary: '정박지 예약을 표 한 장으로 보여 줍니다.', steps: ['정박지와 예약 예시 데이터 정의', '정박지 × 날짜 표 구성', '예약 상세 패널', '빈 상태와 실패 문구'], auditRoutes: ['/'], appliedLessonIds: [] },
  { type: 'review.completed', stage: 'plan', reviewer: 'codex', verdict: 'noted', points: ['표가 화면의 주인이라 오늘 들어오는 배가 칸 하나로 묻힙니다.'], reason: null, durationMs: 38_000 },
  { type: 'plan.review_requested', version: 1, planHash: 'a'.repeat(64) },
  { type: 'plan.review_resolved', version: 1, outcome: 'changes' },
  { type: 'plan.created', summary: '오늘 들어오는 배를 맨 위에 세우고, 그 아래에 정박지별 예약 표를 둡니다.', steps: ['정박지와 예약 예시 데이터 정의', '오늘 입항 목록', '정박지 × 날짜 표', '예약 상세 패널', '빈 상태와 실패 문구'], auditRoutes: ['/'], appliedLessonIds: [] },
  { type: 'review.completed', stage: 'plan', reviewer: 'codex', verdict: 'noted', points: ['늦게 도착한 배를 목록에서 어떻게 구분할지 정해 두면 좋습니다.'], reason: null, durationMs: 31_000 },
  { type: 'plan.review_requested', version: 2, planHash: 'b'.repeat(64) },
  { type: 'task.state', state: 'awaiting_plan_review', error: null },
];

const approvals: Approval[] = [
  {
    id: 'apr_budget', projectId: 'prj_ledger', taskId: 'tsk_detail', actionKind: 'task.extend-budget', actionHash: 'f'.repeat(64),
    summary: '작업 tsk_detail이(가) 토큰 예산을 다 썼습니다 (지금까지 2,004,300 토큰). 여기서 2,000,000 토큰을 더 쓰게 할까요?', state: 'pending', requestedAt: min(-1), expiresAt: min(59), resolvedAt: null, resolvedVia: null,
  },
];

const bodies: EventBody[] = [
  { type: 'task.state', state: 'running', error: null },
  { type: 'task.phase', phase: 'plan', round: 0 },
  { type: 'route.decided', taskKind: 'build', engine: 'native-claude', model: 'claude-opus-5-5', effort: 'high', considered: [{ engine: 'native-claude', available: true, reason: 'Anthropic API key present in vault' }] },
  { type: 'checkpoint.created', checkpointId: 'ckp_b', label: 'before build tsk_detail' },
  { type: 'plan.created', summary: '상세 화면 아래쪽에 결제 이력 섹션을 추가합니다. 이력이 없을 때는 다음 행동을 안내합니다.', steps: ['결제 이력 타입과 예시 데이터를 src/data/payments.ts에 정의', 'InvoiceDetail에 이력 섹션 추가', '빈 상태 문구 작성'], auditRoutes: ['/invoices/1'], appliedLessonIds: ['les_tokens'] },
  { type: 'reference.captured', url: 'https://usekuroko.com/', ok: true, artifactId: 'art_ref', detail: 'Kuroko: 장부를 넘기는 가장 조용한 방법' },
  { type: 'gate.result', gate: 'anchor', name: '.studio-zero/anchor-table.json', passed: true, exitCode: null, durationMs: 30, detail: '' },
  { type: 'anchor.committed', author: 'planner', idea: '밀린 돈이 며칠째인지가 금액보다 먼저 보인다.', directions: ['입금이 쌓이는 타임라인 한 줄을 화면 가운데 두는 구성', '청구서 한 장을 펼쳐 놓고 그 위에 입금 도장이 찍히는 구성'], livingVisual: '고객 12곳의 실제 입금 기록으로 움직이는 타임라인' },
  { type: 'review.completed', stage: 'plan', reviewer: 'codex', verdict: 'noted', points: ['이력이 회색 줄의 반복으로 굳어 있습니다. 가장 최근 입금 한 건을 크게 두세요.', '부분 입금과 환불 상태가 계획에 없습니다.'], reason: null, durationMs: 41_000 },
  { type: 'task.phase', phase: 'execute', round: 1 },
  { type: 'tool.call', callId: 'call_1', tool: 'read_file', input: 'src/routes/InvoiceDetail.tsx' },
  { type: 'tool.result', callId: 'call_1', ok: true, exitCode: null, durationMs: 41, preview: '     1\timport { useParams } from "react-router";' },
  { type: 'tool.call', callId: 'call_2', tool: 'write_file', input: 'src/data/payments.ts (612 chars)' },
  { type: 'tool.result', callId: 'call_2', ok: true, exitCode: null, durationMs: 38, preview: 'wrote src/data/payments.ts' },
  { type: 'tool.call', callId: 'call_3', tool: 'bash', input: 'pnpm typecheck' },
  { type: 'tool.result', callId: 'call_3', ok: false, exitCode: 2, durationMs: 4210, preview: "src/routes/InvoiceDetail.tsx(48,19): error TS2339: Property 'paidAt' does not exist on type 'Payment'." },
  { type: 'tool.call', callId: 'call_4', tool: 'edit_file', input: 'src/data/payments.ts' },
  { type: 'tool.result', callId: 'call_4', ok: true, exitCode: null, durationMs: 52, preview: 'edited src/data/payments.ts (1 replacement)' },
  { type: 'tool.call', callId: 'call_5', tool: 'bash', input: 'pnpm typecheck && pnpm build' },
  { type: 'tool.result', callId: 'call_5', ok: true, exitCode: 0, durationMs: 9830, preview: 'dist/assets/index-B2kq.js  184.20 kB' },
  { type: 'tool.call', callId: 'call_5b', tool: 'bash', input: 'pnpm add @tanstack/react-query zustand@^5' },
  { type: 'tool.result', callId: 'call_5b', ok: true, exitCode: 0, durationMs: 6120, preview: '+ @tanstack/react-query 5.90.2\n+ zustand 5.0.8' },
  { type: 'agent.text', text: '결제 이력 섹션을 추가했습니다.' },
  { type: 'task.phase', phase: 'verify', round: 1 },
  { type: 'gate.result', gate: 'compiler', name: 'npm run --silent typecheck', passed: true, exitCode: 0, durationMs: 4100, detail: '' },
  { type: 'gate.result', gate: 'smoke', name: '/ /invoices/1', passed: true, exitCode: null, durationMs: 2300, detail: '2 routes loaded without errors' },
  { type: 'eval.result', evalId: 'evl_lint', name: 'slop-lint', passed: true, durationMs: 60, detail: '0 minor findings' },
  { type: 'audit.completed', auditId: 'aud_1', score: 66, passed: false, blockers: 1, majors: 3, minors: 1, visionReviewed: true, grade: 'D' },
  { type: 'eval.result', evalId: 'evl_vis', name: 'visual-audit', passed: false, durationMs: 14200, detail: 'Visual audit score 66/100, required 85 with no blockers.' },
  { type: 'task.phase', phase: 'execute', round: 2 },
  { type: 'steer.queued', text: '영수증 버튼은 목록 아래가 아니라 각 행 오른쪽에 두세요' },
  { type: 'tool.call', callId: 'call_6', tool: 'edit_file', input: 'src/routes/InvoiceDetail.tsx' },
  { type: 'tool.result', callId: 'call_6', ok: true, exitCode: null, durationMs: 47, preview: 'edited src/routes/InvoiceDetail.tsx (1 replacement)' },
  { type: 'steer.delivered', count: 1 },
  { type: 'advisor.answered', advisor: 'codex', question: '결제 이력처럼 서버에서 오는 목록은 Zustand에 두는 게 맞을까, TanStack Query가 맞을까?', ok: true, answer: 'TanStack Query를 권합니다.\n\n결제 이력은 서버가 원본인 데이터라서 캐시, 재검증, 로딩 상태가 필요합니다. Zustand에는 필터나 선택한 행처럼 화면에만 있는 상태를 두세요. 목록이 한 화면에서만 쓰이고 새로 고침이 필요 없다면 이 판단은 뒤집힙니다.', durationMs: 18_400 },
  { type: 'checkpoint.created', checkpointId: 'ckp_t2', label: '7턴: edit_file src/routes/InvoiceDetail.tsx' },
  { type: 'policy.decision', actionKind: 'llm.request', actor: 'agent:tsk_detail', effect: 'deny', rule: 'budget.task', reason: 'task budget exhausted (2004300/2000000 tokens)' },
  { type: 'approval.requested', approvalId: 'apr_budget', actionKind: 'task.extend-budget', summary: approvals[0]!.summary, expiresAt: min(59) },
  { type: 'task.state', state: 'awaiting_approval', error: null },
];
const designBodies: EventBody[] = [
  { type: 'task.state', state: 'running', error: null },
  { type: 'task.phase', phase: 'execute', round: 1 },
  { type: 'tool.call', callId: 'tide_1', tool: 'write_file', input: 'docs/prd.md (4210 chars)' },
  { type: 'tool.result', callId: 'tide_1', ok: true, exitCode: null, durationMs: 44, preview: 'wrote docs/prd.md' },
  { type: 'tool.call', callId: 'tide_2', tool: 'write_file', input: 'docs/mockups/a.html (9120 chars)' },
  { type: 'tool.result', callId: 'tide_2', ok: true, exitCode: null, durationMs: 51, preview: 'wrote docs/mockups/a.html' },
  { type: 'agent.text', text: '설계 문서 네 개와 첫 화면 시안 세 개를 만들었습니다. 문서는 A안을 기준으로 썼습니다.' },
  {
    type: 'mockups.rendered',
    options: [
      { file: 'docs/mockups/a.html', title: '흐름 한 줄', idea: '세 사람 사이에 오가야 할 돈을 화살표 한 줄로 먼저 보여 주고, 내역은 그 아래에 둡니다.', artifactId: 'art_mock_a', width: 1440, height: 900, flow: { filmArtifactId: 'art_film_a', tasks: [walked('settle', 1, 56), walked('undo', 1, 48)] }, measures: { blockers: 0, majors: 0, copyHabits: 0, slopScore: 14 } },
      { file: 'docs/mockups/b.html', title: '이번 달 영수증', idea: '이번 달 지출을 영수증 한 장처럼 펼쳐 놓고, 맨 아래 합계에서 각자 몫이 갈립니다.', artifactId: 'art_mock_b', width: 1440, height: 900, flow: { filmArtifactId: 'art_film_b', tasks: [{ ...walked('settle', 3, 44), scrolls: 1 }, walked('undo', 1, 44)] }, measures: { blockers: 0, majors: 1, copyHabits: 0, slopScore: 22 } },
      { file: 'docs/mockups/c.html', title: '사람별 저울', idea: '사람마다 낸 돈과 쓴 돈을 저울처럼 나란히 놓아 기운 쪽이 줄 사람임을 보입니다.', artifactId: 'art_mock_c', width: 1440, height: 900, flow: { filmArtifactId: null, tasks: [{ ...walked('settle', 0, null), reached: false, stopped: 'covered', stoppedAtStep: 1 }] }, measures: { blockers: 1, majors: 2, copyHabits: 1, slopScore: 41 } },
    ],
  },
  { type: 'task.state', state: 'succeeded', error: null },
];
/** The design task that is still drawing: each direction's engine has had its page measured, one of them twice. */
const draftingBodies: EventBody[] = [
  { type: 'task.state', state: 'running', error: null },
  { type: 'task.phase', phase: 'execute', round: 1 },
  { type: 'tool.call', callId: 'pace_1', tool: 'write_file', input: 'docs/prd.md (6120 chars)' },
  { type: 'tool.result', callId: 'pace_1', ok: true, exitCode: null, durationMs: 40, preview: 'wrote docs/prd.md' },
  { type: 'tool.call', callId: 'pace_2', tool: 'write_file', input: 'docs/mockups/directions.json (2210 chars)' },
  { type: 'tool.result', callId: 'pace_2', ok: true, exitCode: null, durationMs: 38, preview: 'wrote docs/mockups/directions.json' },
  { type: 'gate.result', gate: 'directions', name: 'docs/mockups/directions.json', passed: true, exitCode: null, durationMs: 31, detail: '' },
  { type: 'tool.call', callId: 'pace_3', tool: 'write_file', input: 'docs/mockups/b.html (24120 chars)', lane: 'b' },
  { type: 'tool.result', callId: 'pace_3', ok: true, exitCode: null, durationMs: 52, preview: 'wrote docs/mockups/b.html' },
  { type: 'tool.call', callId: 'pace_4', tool: 'write_file', input: 'docs/mockups/a.html (27310 chars)', lane: 'a' },
  { type: 'tool.result', callId: 'pace_4', ok: true, exitCode: null, durationMs: 49, preview: 'wrote docs/mockups/a.html' },
  { type: 'tool.call', callId: 'pace_5', tool: 'check_mockup', input: 'docs/mockups/b.html', lane: 'b' },
  { type: 'mockups.drafted', option: { file: 'docs/mockups/b.html', title: '둘이 채우는 2주 달력', idea: '', artifactId: 'art_mock_b', width: 393, height: 852, flow: { filmArtifactId: null, tasks: [walked('log', 2, 48)] }, measures: { blockers: 1, majors: 2, copyHabits: 0, slopScore: null } } },
  { type: 'tool.result', callId: 'pace_5', ok: true, exitCode: null, durationMs: 21_400, preview: 'Measured: 1 blocker, 2 major, 3 minor.' },
  { type: 'tool.call', callId: 'pace_6', tool: 'check_mockup', input: 'docs/mockups/a.html', lane: 'a' },
  { type: 'mockups.drafted', option: { file: 'docs/mockups/a.html', title: '오늘의 맞대결 접시', idea: '', artifactId: 'art_mock_a', width: 393, height: 852, flow: { filmArtifactId: null, tasks: [walked('log', 1, 56)] }, measures: { blockers: 0, majors: 0, copyHabits: 0, slopScore: null } } },
  { type: 'tool.result', callId: 'pace_6', ok: true, exitCode: null, durationMs: 19_800, preview: 'Nothing here holds the page back.' },
];
/** One task of a walk that went through, for the demo's mock-ups. */
function walked(id: string, presses: number, smallestTargetPx: number | null): FlowTaskWalk {
  return { id, reached: true, stopped: null, stoppedAtStep: null, presses, typed: 0, scrolls: 0, smallestTargetPx, answered: presses, responseMs: presses > 0 ? 320 : null };
}
const events: EventEnvelope[] = [
  ...bodies.map((body, i): EventEnvelope => ({ seq: 100 + i, at: min(-18) + i * 35_000, projectId: 'prj_ledger', taskId: 'tsk_detail', body })),
  ...designBodies.map((body, i): EventEnvelope => ({ seq: 40 + i, at: min(-66) + i * 50_000, projectId: 'prj_tide', taskId: 'tsk_tide_design', body })),
  ...draftingBodies.map((body, i): EventEnvelope => ({ seq: 70 + i, at: min(-12) + i * 38_000, projectId: 'prj_pace', taskId: 'tsk_pace_design', body })),
  ...harborBodies.map((body, i): EventEnvelope => ({ seq: 900 + i, at: min(-9) + i * 40_000, projectId: 'prj_harbor', taskId: 'tsk_harbor_plan', body })),
];

/** The Tide design task's three first screens: small real pages, each arranged its own way, in the project's tokens. */
const tidePage = (title: string, idea: string, body: string): string => `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title><meta name="description" content="${idea}">
<style>
:root{color-scheme:light dark;--bg:oklch(98.5% 0.006 240);--surface:oklch(100% 0 0);--fg:oklch(20% 0.01 240);--muted:oklch(43% 0.01 240);--line:oklch(90% 0.006 240);--accent:oklch(42% 0.12 255)}
@media (prefers-color-scheme:dark){:root{--bg:oklch(16.5% 0.006 240);--surface:oklch(21% 0.006 240);--fg:oklch(96% 0.006 240);--muted:oklch(72% 0.01 240);--line:oklch(30% 0.006 240);--accent:oklch(78% 0.1 255)}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.6 system-ui,sans-serif}
main{max-width:960px;margin:0 auto;padding:24px 20px 48px;display:flex;flex-direction:column;gap:20px}
h1{font-size:30px;line-height:1.25;margin:0}p{margin:0;color:var(--muted)}
.row{display:flex;justify-content:space-between;gap:12px;padding:12px 0;border-top:1px solid var(--line)}
.sum{font-size:20px;font-weight:600}.card{background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:16px}
.flow{display:flex;align-items:center;gap:8px}.who{flex:none;inline-size:64px;block-size:64px;border-radius:999px;border:2px solid var(--fg);display:flex;align-items:center;justify-content:center;font-weight:600}
.arrow{flex:1;block-size:4px;background:var(--accent)}button{min-height:44px;border:0;border-radius:8px;padding:0 16px;background:var(--accent);color:var(--bg);font:inherit;font-weight:600}
.cols{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}.bar{background:var(--accent);border-radius:4px}
</style></head><body><main>${body}</main></body></html>`;
const tideSpec: ScreenSpec = {
  coreMoment: '민지가 이번 달에 서준에게 보낼 돈을 한눈에 보고, 보냈다고 표시한다.',
  screens: [
    {
      id: 'S-01',
      name: '이번 달 정산',
      purpose: '누가 누구에게 얼마를 보내야 하는지 보고, 보낸 것을 표시한다.',
      entry: ['앱 실행', '정산 알림'],
      elements: [
        { name: '보낼 돈', rule: '세 사람 사이에 오가야 할 금액을 가장 적은 횟수로 묶어 보여 준다. 지출이 바뀌면 바로 다시 계산한다.', goesTo: null },
        { name: '보냈어요', rule: '누르면 그 줄이 보낸 것으로 바뀌고 받는 사람에게 알림이 간다. 10초 동안 되돌릴 수 있다.', goesTo: null },
        { name: '지출 내역', rule: '이번 달 지출을 날짜순으로 보여 준다. 누르면 그 지출을 고치는 화면으로 간다.', goesTo: 'S-02' },
      ],
      states: [{ name: '지출 없음', shows: '이번 달에 적은 지출이 없어요' }, { name: '모두 정산함', shows: '11월은 서로 줄 돈이 없어요' }],
      exceptions: ['환불은 음수 지출로 적는다.', '한 사람이 빠진 지출은 나머지 사람끼리만 나눈다.'],
    },
    { id: 'S-02', name: '지출 고치기', purpose: '지출 한 건의 금액과 나눌 사람을 고친다.', entry: ['S-01'], elements: [{ name: '금액', rule: '원 단위 정수. 0은 받지 않는다.', goesTo: null }], states: [], exceptions: [] },
    { id: 'S-00', name: '들어오기', purpose: '이메일로 가입하거나 로그인해 자기 모임으로 들어간다.', entry: ['앱 실행', '초대 링크'], elements: [{ name: '시작하기', rule: '이메일과 비밀번호를 받는다. 초대 링크로 왔으면 그 모임에 바로 들어간다.', goesTo: 'S-01' }], states: [], exceptions: [] },
  ],
  tasks: [
    { id: 'settle', goal: '서준에게 184,000원을 보냈다고 표시한다', outcome: '그 줄이 보낸 것으로 바뀐다', screen: 'S-01' },
    { id: 'undo', goal: '잘못 누른 표시를 되돌린다', outcome: '그 줄이 다시 보낼 것으로 돌아온다', screen: 'S-01' },
  ],
  events: [{ name: 'settlement_marked', when: '보냈어요를 누를 때', measures: '달마다 정산을 끝낸 모임의 비율' }],
  // What makes it a plan for a product that works: who uses it, how they get in, what they do, what is kept.
  roles: [{ id: 'member', name: '모임 구성원', does: '지출을 적고, 줄 돈을 보내고, 보냈다고 표시한다.' }],
  entry: {
    signUp: 'S-00',
    signIn: 'S-00',
    signOut: '설정에서 로그아웃하면 들어오기 화면으로 돌아간다.',
    sessionEnded: '세션이 끝나면 보던 달을 기억해 두고 들어오기 화면으로 보낸다.',
    forgot: '가입한 이메일로 비밀번호를 다시 정하는 링크를 보낸다.',
    leave: '모임에서 나가면 적은 지출은 남고, 정산이 끝난 달부터 이름이 빠진다.',
  },
  noAccounts: null,
  scenarios: [
    {
      id: 'settle-up',
      role: 'member',
      steps: [
        { id: 'settle-up:1', screen: 'S-00', does: '이메일과 비밀번호로 가입한다', saves: 'members', outcome: '이번 달 정산 화면이 열린다' },
        { id: 'settle-up:2', screen: 'S-01', does: '서준에게 보낼 184,000원 줄에서 보냈어요를 누른다', saves: 'settlements', outcome: '그 줄이 보낸 것으로 바뀐다' },
      ],
    },
  ],
  data: [
    { table: 'expenses', holds: '지출 한 건: 금액, 낸 사람, 나눌 사람, 날짜', readers: 'members' },
    { table: 'settlements', holds: '보냈다고 표시한 기록과 그 시각', readers: 'members' },
  ],
};
const tideFiles: Record<string, string> = {
  'docs/screens.json': JSON.stringify(tideSpec, null, 2),
  'docs/mockups/a.html': tidePage('흐름 한 줄', '세 사람 사이에 오가야 할 돈을 화살표 한 줄로 먼저 보여 주고, 내역은 그 아래에 둡니다.', `<h1>민지가 서준에게 184,000원</h1><p>11월 정산 · 지출 14건 · 11월 12일 기준</p><div class="flow"><span class="who">민지</span><span class="arrow"></span><span class="who">서준</span><span class="arrow" style="opacity:.4"></span><span class="who">하람</span></div><div class="card"><div class="row"><span>공유 오피스 11월</span><span class="sum">660,000원</span></div><div class="row"><span>촬영 장비 대여</span><span class="sum">132,000원</span></div><div class="row"><span>환불 대기 · 폰트 라이선스</span><span class="sum">−48,000원</span></div></div><button type="button">184,000원 보냈다고 표시</button>`),
  'docs/mockups/b.html': tidePage('이번 달 영수증', '이번 달 지출을 영수증 한 장처럼 펼쳐 놓고, 맨 아래 합계에서 각자 몫이 갈립니다.', `<div class="card" style="max-width:420px;margin:0 auto;inline-size:100%"><h1>11월 영수증</h1><div class="row"><span>공유 오피스</span><span>660,000</span></div><div class="row"><span>촬영 장비 대여</span><span>132,000</span></div><div class="row"><span>택시 · 야간 촬영</span><span>41,800</span></div><div class="row"><span>폰트 라이선스 환불</span><span>−48,000</span></div><div class="row sum"><span>합계</span><span>785,800원</span></div><div class="row"><span>민지 몫</span><span>261,934원</span></div><div class="row"><span>서준 몫</span><span>261,933원</span></div><div class="row"><span>하람 몫</span><span>261,933원</span></div></div>`),
  'docs/mockups/c.html': tidePage('사람별 저울', '사람마다 낸 돈과 쓴 돈을 저울처럼 나란히 놓아 기운 쪽이 줄 사람임을 보입니다.', `<h1>누가 더 냈나</h1><div class="cols"><div class="card"><p>민지</p><div class="bar" style="block-size:60px"></div><p class="sum">−184,000</p></div><div class="card"><p>서준</p><div class="bar" style="block-size:160px"></div><p class="sum">+151,000</p></div><div class="card"><p>하람</p><div class="bar" style="block-size:110px"></div><p class="sum">+33,000</p></div></div><p>막대는 낸 돈, 숫자는 받을 돈(+)과 줄 돈(−)입니다.</p>`),
};

/**
 * Three flat drawings that stand in for a design task's mock-ups. Each is arranged differently, because that is
 * what the real ones are for: a row of flows, one long sheet, columns side by side.
 */
function fakeMockup(which: 'a' | 'b' | 'c'): string {
  const shapes = {
    a: `<rect x="96" y="96" width="420" height="44" fill="#2b2b2d"/><rect x="96" y="250" width="200" height="200" rx="100" fill="#d7d7d9"/><rect x="620" y="250" width="200" height="200" rx="100" fill="#d7d7d9"/><rect x="1144" y="250" width="200" height="200" rx="100" fill="#d7d7d9"/><rect x="316" y="338" width="284" height="24" fill="#2b2b2d"/><rect x="840" y="338" width="284" height="24" fill="#8a8a8e"/>${[0, 1, 2].map((i) => `<rect x="96" y="${560 + i * 84}" width="1248" height="60" fill="#e9e9ea"/>`).join('')}`,
    b: `<rect x="460" y="60" width="520" height="780" fill="#ffffff" stroke="#c9c9cc" stroke-width="2"/><rect x="508" y="112" width="260" height="36" fill="#2b2b2d"/>${[0, 1, 2, 3, 4, 5].map((i) => `<rect x="508" y="${208 + i * 68}" width="${300 - (i % 3) * 40}" height="18" fill="#8a8a8e"/><rect x="852" y="${208 + i * 68}" width="80" height="18" fill="#2b2b2d"/>`).join('')}<rect x="508" y="640" width="424" height="2" fill="#2b2b2d"/><rect x="508" y="680" width="140" height="56" fill="#d7d7d9"/><rect x="664" y="680" width="120" height="56" fill="#d7d7d9"/><rect x="800" y="680" width="132" height="56" fill="#2b2b2d"/>`,
    c: `<rect x="96" y="84" width="340" height="40" fill="#2b2b2d"/>${[0, 1, 2].map((i) => `<rect x="${96 + i * 432}" y="${220 + i * 60}" width="384" height="${560 - i * 60}" fill="#e9e9ea"/><rect x="${128 + i * 432}" y="${252 + i * 60}" width="160" height="28" fill="#2b2b2d"/><rect x="${128 + i * 432}" y="${320 + i * 60}" width="${300 - i * 70}" height="120" fill="#8a8a8e"/><rect x="${128 + i * 432}" y="${470 + i * 60}" width="${180 + i * 60}" height="120" fill="#d7d7d9"/>`).join('')}`,
  }[which];
  return `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1440 900" width="1440" height="900"><rect width="100%" height="100%" fill="#fbfbfb"/>${shapes}</svg>`)}`;
}

/** A flat drawing that stands in for a captured screen. Greys only: the proof marks are what should read. */
function fakeScreen(width: number, height: number): string {
  const rows = Array.from({ length: 4 }, (_, i) => `<rect x="24" y="${236 + i * 76}" width="${width - 48}" height="60" fill="#e9e9ea"/>`).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#fbfbfb"/><rect x="24" y="48" width="${Math.round(width * 0.5)}" height="30" fill="#2b2b2d"/><rect x="24" y="96" width="${Math.round(width * 0.72)}" height="14" fill="#9b9b9f"/><rect x="24" y="120" width="${Math.round(width * 0.55)}" height="14" fill="#9b9b9f"/><rect x="24" y="168" width="150" height="26" fill="#b9b9bd"/>${rows}<rect x="${width - 124}" y="${height - 84}" width="100" height="32" fill="#77777b"/></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

const audit: AuditReport = {
  id: 'aud_1', projectId: 'prj_ledger', taskId: 'tsk_detail', createdAt: min(-4), score: 66, threshold: 85, passed: false,
  visionReviewed: true,
  vision: { status: 'reviewed', via: 'codex', model: 'codex:default', limited: false, reviewed: 3, expected: 3, reason: null },
  rubric: { hierarchy: 6, whitespace: 7, typography: 8, color: 9, copy: 6, originality: 5, tactility: 5 },
  slopScore: 44,
  archetype: 'web-app',
  critique: '결제 이력이 표가 아니라 똑같은 회색 줄의 반복으로 보여서, 어느 입금이 최근인지와 무엇을 누를 수 있는지가 드러나지 않습니다. 가장 최근 입금을 맨 위에 크게 두고, 영수증 받기를 각 줄의 오른쪽 끝에 붙이세요.',
  grade: 'D',
  redesignPatches: [
    { viewport: 'iphone-15-pro', route: '/invoices/1', target: 'section.history > ul', bbox: { x: 24, y: 236, w: 345, h: 288 }, action: 'restructure', instruction: '결제 이력을 날짜, 금액, 영수증 버튼 순서의 줄로 다시 짜고, 가장 최근 입금 한 건은 text-2xl 금액으로 목록 위에 따로 둡니다.' },
    { viewport: 'iphone-15-pro', route: '/invoices/1', target: 'section.history button.receipt', bbox: { x: 269, y: 575, w: 100, h: 32 }, action: 'restyle', instruction: '영수증 버튼을 목록 아래에서 각 줄 오른쪽 끝으로 옮기고 min-h-11, rounded-md, border-control-border로 눌리는 모양을 줍니다.' },
    { viewport: 'iphone-15-pro', route: '/invoices/1', target: 'section.history > p', bbox: { x: 24, y: 168, w: 150, h: 26 }, action: 'rewrite_copy', instruction: '"아직 입금된 내역이 없습니다. 입금이 확인되면 여기에 표시됩니다."' },
  ],
  findings: [
    { rule: 'contrast/text', category: 'contrast', severity: 'blocker', source: 'dom', viewport: 'iphone-15-pro', route: '/invoices/1', message: '"2026년 10월 31일 입금" has contrast 3.42:1; 7:1 is required (WCAG AAA, and it fails AA 4.5:1)', selector: 'section.history > ul > li:nth-of-type(1) > time', bbox: { x: 24, y: 252, w: 168, h: 22 }, fix: 'Use text-fg or text-fg-muted on bg-bg / bg-surface / bg-sunken. Do not lighten text with opacity.', file: null, line: null },
    { rule: 'touch/target-size', category: 'touch-target', severity: 'major', source: 'dom', viewport: 'iphone-15-pro', route: '/invoices/1', message: 'button "영수증" is 62×28px; touch targets need 44×44px', selector: 'section.history button.receipt', bbox: { x: 269, y: 575, w: 100, h: 32 }, fix: 'Give the control min-h-11 min-w-11 (44px); keep the icon size and grow the hit area.', file: null, line: null },
    { rule: 'spacing/off-grid', category: 'spacing', severity: 'major', source: 'dom', viewport: 'ipad-pro-11', route: '/invoices/1', message: '34% of paddings, margins and gaps are off the 4px grid (e.g. 10, 14, 18px).', selector: 'section.history', bbox: { x: 24, y: 236, w: 786, h: 288 }, fix: 'Use spacing utilities (multiples of 4px).', file: null, line: null },
    { rule: 'vision/tactility', category: 'tactility', severity: 'major', source: 'vlm', viewport: 'iphone-15-pro', route: '/invoices/1', message: '결제 이력의 네 줄이 모두 같은 회색 면이라 누를 수 있는 것과 읽기만 하는 것이 구분되지 않습니다.', selector: 'section.history > ul', bbox: { x: 24, y: 236, w: 345, h: 288 }, fix: '줄은 bg-surface에 border-border 가는 선으로 나누고, 누를 수 있는 것은 영수증 버튼 하나로 분명히 하세요.', file: null, line: null },
    { rule: 'vision/copy', category: 'copy', severity: 'minor', source: 'vlm', viewport: 'iphone-15-pro', route: '/invoices/1', message: '빈 상태 문구 "데이터가 없습니다"는 무엇이 없는지, 다음에 무엇을 할 수 있는지 말해주지 않습니다.', selector: 'section.history > p', bbox: { x: 24, y: 168, w: 150, h: 26 }, fix: '"아직 입금된 내역이 없습니다. 입금이 확인되면 여기에 표시됩니다."처럼 상태와 다음 일을 적으세요.', file: null, line: null },
  ],
  screenshots: [
    { viewport: 'iphone-15-pro', route: '/invoices/1', fold: 0, artifactId: 'art_phone', width: 393, height: 659 },
    { viewport: 'ipad-pro-11', route: '/invoices/1', fold: 0, artifactId: 'art_tablet', width: 834, height: 1194 },
    { viewport: 'desktop-1440', route: '/invoices/1', fold: 0, artifactId: 'art_desktop', width: 1440, height: 900 },
  ],
};

/** The other thing an audit can say: the measurements are clean and nobody looked. No grade, a capped score, and the reason. */
const unreviewedAudit: AuditReport = {
  id: 'aud_2', projectId: 'prj_atlas', taskId: 'tsk_atlas_home', createdAt: min(-40), score: 50, threshold: 85, passed: false,
  visionReviewed: false,
  vision: { status: 'failed', via: null, model: null, limited: true, reviewed: 0, expected: 2, reason: 'Codex subscription: You have hit your usage limit; Claude subscription: Claude 구독의 사용 한도에 걸렸습니다.' },
  rubric: null, slopScore: null, archetype: null, critique: null, grade: null, redesignPatches: [], findings: [],
  screenshots: [
    { viewport: 'iphone-15-pro', route: '/', fold: 0, artifactId: 'art_phone', width: 393, height: 659 },
    { viewport: 'ipad-pro-11', route: '/', fold: 0, artifactId: 'art_tablet', width: 834, height: 1194 },
  ],
};

const checkpoints: Checkpoint[] = [
  { id: 'ckp_t2', projectId: 'prj_ledger', taskId: 'tsk_detail', label: '7턴: edit_file src/routes/InvoiceDetail.tsx', commit: 'f00dfeed', createdAt: min(-6) },
  { id: 'ckp_t1', projectId: 'prj_ledger', taskId: 'tsk_detail', label: '4턴: pnpm typecheck && pnpm build', commit: 'decafbad', createdAt: min(-12) },
  { id: 'ckp_b', projectId: 'prj_ledger', taskId: 'tsk_detail', label: 'before build tsk_detail', commit: 'c0ffee1', createdAt: min(-18) },
  { id: 'ckp_m', projectId: 'prj_ledger', taskId: null, label: 'before merging sz/tsk_list', commit: 'badc0de', createdAt: min(-80) },
  { id: 'ckp_a', projectId: 'prj_ledger', taskId: 'tsk_list', label: 'before build tsk_list', commit: 'a11ce55', createdAt: min(-95) },
];

const proposals: ProposalCard[] = [
  {
    id: 'prp_schema', projectId: 'prj_ledger', ingestId: 'ing_1', sourceRepo: 'https://github.com/n8n-io/nod', sourceCommit: '079f534d951471029bbb25965fd9a52318179d13', practiceId: 'schema-validated-boundaries',
    title: '폼 입력과 API 응답을 스키마로 검증', rationale: '지금은 서버 응답을 그대로 화면 상태로 씁니다. 금액 필드가 문자열로 오면 합계가 조용히 틀어집니다. 경계에서 한 번 검증하면 이런 오류가 화면이 아니라 로그에 남습니다.',
    evidence: [{ file: 'src/server/integrations.ts', line: 212, excerpt: 'const input = CreateIntegration.parse(await req.json());' }, { file: 'desktop/main/main.mjs', line: 1785, excerpt: 'const settings = Settings.safeParse(raw);' }],
    plannedChanges: [{ path: 'src/data/schema.ts', action: 'create', description: '청구서와 결제 스키마 정의' }, { path: 'src/data/api.ts', action: 'modify', description: '응답을 스키마로 파싱' }],
    risk: 'low', estimatedImpact: '잘못된 응답으로 인한 화면 오류가 줄어들 것으로 예상합니다.', state: 'ready', branch: 'kirby/prp_schema', taskId: 'tsk_k1',
    diff: 'diff --git a/src/data/api.ts b/src/data/api.ts\n--- a/src/data/api.ts\n+++ b/src/data/api.ts\n@@ -8,3 +8,3 @@\n-  return (await res.json()) as Invoice[];\n+  return InvoiceList.parse(await res.json());\n',
    diffStat: { files: 2, insertions: 31, deletions: 4 }, measured: [{ metric: '`any` annotations', before: 6, after: 2 }, { metric: 'practice: schema-validated-boundaries', before: 0, after: 1 }], createdAt: min(-50),
  },
  {
    id: 'prp_tests', projectId: 'prj_ledger', ingestId: 'ing_1', sourceRepo: 'https://github.com/n8n-io/nod', sourceCommit: '079f534d951471029bbb25965fd9a52318179d13', practiceId: 'automated-tests',
    title: '금액 계산에 단위 테스트 추가', rationale: '합계와 연체 일수 계산은 화면 세 곳에서 쓰이지만 테스트가 없습니다.', evidence: [{ file: 'tests/trust.test.ts', line: 1, excerpt: '' }],
    plannedChanges: [{ path: 'src/data/totals.test.ts', action: 'create', description: '합계, 연체 일수 테스트' }], risk: 'low', estimatedImpact: '계산 로직을 고칠 때 회귀를 바로 알 수 있습니다.',
    state: 'proposed', branch: null, taskId: null, diff: null, diffStat: null, measured: null, createdAt: min(-50),
  },
];

const lessons: Lesson[] = [
  { id: 'les_tokens', scope: 'project', projectId: 'prj_ledger', kind: 'rule', title: '색은 테마 변수로만', trigger: '페이지나 컴포넌트 스타일을 작성할 때', guidance: '.studio-zero/theme.css를 연결하고 모든 색에 토큰 유틸리티를 쓴다. 16진수 색은 린트와 감사에서 걸린다.', state: 'active', confirmations: 2, harms: 0, originTaskId: 'tsk_list', createdAt: min(-80), updatedAt: min(-20) },
  { id: 'les_install', scope: 'project', projectId: 'prj_ledger', kind: 'heuristic', title: '빌드 전에 의존성 설치 확인', trigger: 'node_modules가 없는 워크스페이스에서 빌드할 때', guidance: 'pnpm build 전에 pnpm install을 먼저 실행한다.', state: 'candidate', confirmations: 1, harms: 0, originTaskId: 'tsk_refactor', createdAt: min(-230), updatedAt: min(-230) },
];

const evals: Eval[] = [
  { id: 'evl_lint', projectId: 'prj_ledger', name: 'slop-lint', spec: { kind: 'slop-lint', maxMajor: 0 }, enabled: true, originTaskId: null, createdAt: min(-600) },
  { id: 'evl_vis', projectId: 'prj_ledger', name: 'visual-audit', spec: { kind: 'visual', routes: ['/'], minScore: 85 }, enabled: true, originTaskId: null, createdAt: min(-600) },
  { id: 'evl_tc', projectId: 'prj_ledger', name: 'typecheck', spec: { kind: 'command', command: 'pnpm typecheck', timeoutSec: 60 }, enabled: true, originTaskId: 'tsk_list', createdAt: min(-81) },
];

const sandbox = (projectId: string): SandboxInfo => ({
  projectId, state: projectId === 'prj_ledger' ? 'running' : 'stopped', container: 'sz-ledger', image: 'studio-zero/sandbox:cdbfa2d9f369',
  previewUrls: projectId === 'prj_ledger' ? [{ containerPort: 5173, localhost: 'http://localhost:32775', orbLocal: 'http://sz-ledger.orb.local:5173' }] : [],
});

const pads: Scratchpad[] = [
  { id: 'scr_field', title: '현장 기사용 청구서 앱', mode: 'think', state: 'exploring', projectId: null, createdAt: min(-40), updatedAt: min(-3) },
  { id: 'scr_capex', title: '이번 분기 AI 인프라 투자 규모', mode: 'research', state: 'exploring', projectId: null, createdAt: min(-200), updatedAt: min(-190) },
];

const fieldBlocks: AxBlock[][] = [
  [
    { type: 'text', markdown: '사무실에 돌아와서야 미결제를 확인한다는 점이 핵심입니다. 같은 필요에 답하는 세 가지 방향을 나란히 놓았습니다.' },
    {
      type: 'comparison', title: '어떤 제품으로 풀까', criteria: ['누구를 위한 것', '핵심 동작', '가장 큰 위험'], recommended: '방문 직후 청구', confidence: 'medium',
      options: [
        { label: '방문 직후 청구', cells: ['하루 5~8곳을 도는 1인 기사', '작업을 마친 자리에서 청구서를 보내고 미결제를 본다', '현장에서 입력이 귀찮으면 쓰지 않는다'] },
        { label: '사무실 대시보드', cells: ['경리 담당이 있는 5인 이상 업체', '미결제를 한 화면에 모아 독촉한다', '이미 회계 도구가 하는 일이다'] },
        { label: '고객용 결제 링크', cells: ['기사의 고객', '문자로 받은 링크에서 바로 결제한다', '결제 대행 연동과 수수료'] },
      ],
    },
  ],
  [{ type: 'decision', id: 'dec-user', question: '첫 사용자는 누구인가', chosen: '혼자 일하는 설비 기사', why: '처음 적어주신 장면이 이 사람의 하루이고, 경리 담당이 있는 업체는 이미 쓰는 도구가 있습니다.', rejected: [{ option: '5인 이상 업체의 경리 담당', why: '기존 회계 도구와 정면으로 겹칩니다.' }], confidence: 'high' }],
  [
    { type: 'diagram', title: '방문 한 번의 흐름', mermaid: 'flowchart LR\n  visit[방문 완료] --> draft[청구서 작성]\n  draft --> send[문자로 전송]\n  send --> paid{입금 확인}\n  paid --> done[완료]' },
    { type: 'choice', id: 'platform', question: '어디서 먼저 쓰이나요?', options: [{ id: 'mobile', label: '모바일 앱', detail: '현장에서 한 손으로. 오프라인에서도 작성할 수 있어야 합니다.' }, { id: 'web', label: '모바일 웹', detail: '설치 없이 시작합니다. 오프라인 작성은 제한됩니다.' }], recommended: 'mobile', confidence: 'medium', allowOther: true },
  ],
];
const fieldEntries: ScratchEntry[] = [
  { seq: 1, scratchId: 'scr_field', at: min(-40), author: 'owner', text: '현장 기사용 청구서 앱\n설비 기사들이 사무실에 돌아와서야 미결제 청구서를 확인해요. 현장에서 바로 보고 다시 보낼 수 있으면 좋겠습니다.', response: null, blocks: [] },
  ...fieldBlocks.map((blocks, i): ScratchEntry => ({ seq: i + 2, scratchId: 'scr_field', at: min(-39 + i * 12), author: 'agent', text: null, response: null, blocks })),
];

const capexBrief = `# 이번 분기 AI 인프라 투자 규모

## 결론

2026년 3분기 상위 4개 클라우드의 설비 투자는 합계 1,120억 달러로, 전년 같은 분기보다 38% 늘었다 [1]. 늘어난 금액의 대부분은 GPU 서버와 전력 설비에 쓰였다 [2].

## 근거

| 항목 | 2025년 3분기 | 2026년 3분기 |
| --- | --- | --- |
| 설비 투자 합계 | 810억 달러 [1] | 1,120억 달러 [1] |
| 전력 계약 용량 | 6.2GW [2] | 9.8GW [2] |

## 다음 단계

11월 20일 실적 발표에서 4분기 가이던스를 확인한다.`;
const capexEntries: ScratchEntry[] = [
  { seq: 20, scratchId: 'scr_capex', at: min(-200), author: 'owner', text: '이번 분기 AI 인프라 투자 규모를 조사해서 한 장으로 정리해줘', response: null, blocks: [] },
  { seq: 21, scratchId: 'scr_capex', at: min(-190), author: 'agent', text: null, response: null, blocks: [{ type: 'text', markdown: capexBrief }, { type: 'sources', title: '출처 2곳', items: [{ title: 'Quarterly filing, capital expenditures', url: 'https://example.com/filing', quote: 'total capital expenditures of $112 billion' }, { title: 'Power contracts tracker', url: 'https://example.org/power', quote: 'contracted capacity reached 9.8 GW' }] }] },
];
const capexJob: KnowledgeJob = { id: 'job_capex', kind: 'research', title: '이번 분기 AI 인프라 투자 규모', state: 'succeeded', origin: 'telegram', scratchId: 'scr_capex', error: null, spentTokens: 184_000, createdAt: min(-200), finishedAt: min(-190) };

/** A small workspace for the file explorer: what a Vite project looks like after a couple of tasks. */
const fileBodies: Record<string, string> = {
  'package.json': '{\n  "name": "ledger",\n  "private": true,\n  "type": "module",\n  "scripts": {\n    "dev": "vite",\n    "build": "tsc -b && vite build",\n    "typecheck": "tsc --noEmit"\n  },\n  "dependencies": {\n    "react": "^19.3.1",\n    "react-dom": "^19.3.1",\n    "zustand": "^5.0.8"\n  }\n}\n',
  'README.md': '# Ledger\n\n미결제 청구서를 한 화면에서 보고 다시 보내는 앱입니다. 받을 돈이 가장 오래된 순서로 놓이고, 한 줄을 누르면 그 청구서를 다시 보낼 수 있으며, 보낸 뒤에는 5초 동안 되돌릴 수 있습니다.\n\n## 화면\n\n- **미결제 목록**: 오래된 순서. 30일이 넘으면 줄 머리에 표시가 붙습니다.\n- **청구서**: 금액, 받는 사람, 보낸 기록.\n\n## 실행\n\n```\npnpm install\npnpm dev\n```\n',
  'tsconfig.json': '{\n  "compilerOptions": {\n    "strict": true,\n    "jsx": "react-jsx"\n  },\n  "include": ["src"]\n}\n',
  '.studio-zero/project.json': '{\n  "dev": { "command": "pnpm dev --host 0.0.0.0 --port 5173", "port": 5173 },\n  "routes": ["/", "/invoices/1"]\n}\n',
  'src/main.tsx': "import { StrictMode } from 'react';\nimport { createRoot } from 'react-dom/client';\nimport { App } from './App.tsx';\nimport './index.css';\n\ncreateRoot(document.getElementById('root')!).render(\n  <StrictMode>\n    <App />\n  </StrictMode>,\n);\n",
  'src/App.tsx': "import { useState } from 'react';\nimport { invoices, type Invoice } from './data/invoices.ts';\n\n// Unpaid invoices, oldest first.\nexport function App() {\n  const [selected, setSelected] = useState<Invoice | null>(null);\n  const unpaid = invoices.filter((invoice) => invoice.paidAt === null);\n  return (\n    <main className=\"flex flex-col gap-6 p-6\">\n      <h1 className=\"text-3xl font-semibold\">미결제 청구서 {unpaid.length}건</h1>\n      <ul>\n        {unpaid.map((invoice) => (\n          <li key={invoice.id} onClick={() => setSelected(invoice)}>\n            {invoice.customer}: {invoice.amount.toLocaleString('ko')}원\n          </li>\n        ))}\n      </ul>\n      {selected ? <p>{selected.customer}</p> : null}\n    </main>\n  );\n}\n",
  'src/index.css': '@import "tailwindcss";\n@import "../.studio-zero/theme.css";\n\nbody {\n  margin: 0;\n}\n',
  'src/data/invoices.ts': "export interface Invoice {\n  id: string;\n  customer: string;\n  amount: number;\n  paidAt: string | null;\n}\n\nexport const invoices: Invoice[] = [\n  { id: 'inv_1', customer: 'Northwind Trading', amount: 1_240_000, paidAt: null },\n  { id: 'inv_2', customer: '한빛설비', amount: 380_000, paidAt: '2026-10-31' },\n];\n",
  'src/data/payments.ts': "export interface Payment {\n  invoiceId: string;\n  paidAt: string;\n  amount: number;\n}\n\nexport const payments: Payment[] = [{ invoiceId: 'inv_2', paidAt: '2026-10-31', amount: 380_000 }];\n",
};
const fileDirs = ['.studio-zero', 'src', 'src/data'];
const parentOf = (path: string): string => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '.');
const fileEntries: FileEntry[] = [
  ...fileDirs.map((path): FileEntry => ({ path, name: path.slice(path.lastIndexOf('/') + 1), type: 'directory', size: 0, mtime: min(-60) })),
  ...Object.entries(fileBodies).map(([path, body]): FileEntry => ({ path, name: path.slice(path.lastIndexOf('/') + 1), type: 'file', size: new TextEncoder().encode(body).length, mtime: min(-12) })),
].sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'directory' ? -1 : 1));

const receipt = (over: Partial<LedgerEntry> & Pick<LedgerEntry, 'id' | 'taskId' | 'createdAt'>): LedgerEntry => ({
  projectId: 'prj_ledger', taskKind: 'build', track: 'full', outcome: 'succeeded', engine: 'native-claude',
  code: { compilerErrors: 0, firstCompilerErrors: 0, verifyRounds: 1, checksPassed: 2, checksFailed: [], buildMs: 9800, bundleBytes: 188_600 },
  design: { grade: 'A', score: 91, slopScore: 18, livingVisual: true, contrastAaa: 1, touchTargets: 1, pressAnswer: 1, focusVisible: 1, copySlop: 0, textSlop: 0 },
  cost: { modelCalls: 14, inputTokens: 368_000, outputTokens: 44_800, usdMicros: 1_890_000, wallMs: 14 * 60_000 },
  review: { plan: 'codex', acceptance: 'codex', verdict: 'pass' },
  flow: { tasks: 2, reached: 2, presses: 3, scrolls: 0, smallestTargetPx: 48, answered: 3 },
  delta: [], proof: '',
  ...over,
});
const ledger: LedgerEntry[] = [
  receipt({
    id: 'led_3', taskId: 'tsk_list', createdAt: min(-81),
    code: { compilerErrors: 0, firstCompilerErrors: 3, verifyRounds: 2, checksPassed: 2, checksFailed: [], buildMs: 9800, bundleBytes: 188_600 },
    design: { grade: 'S', score: 96, slopScore: 8, livingVisual: true, contrastAaa: 1, touchTargets: 1, pressAnswer: 1, focusVisible: 1, copySlop: 0, textSlop: 0 },
    review: { plan: 'codex', acceptance: 'codex', verdict: 'patched' },
    delta: [
      { metric: '타입 에러', before: '3', after: '0', better: true },
      { metric: '디자인 등급', before: 'B', after: 'S', better: true },
      { metric: '텍스트 슬롭', before: '4건', after: '0건 클린', better: true },
      { metric: '번들', before: '212KB', after: '184KB', better: true },
    ],
    proof: '타입 에러 3→0, 디자인 등급 B→S, 텍스트 슬롭 4건→0건 클린, 번들 212KB→184KB',
  }),
  receipt({
    id: 'led_2', taskId: 'tsk_refactor', createdAt: min(-231), taskKind: 'refactor', outcome: 'failed', engine: 'claude-code',
    code: { compilerErrors: 3, firstCompilerErrors: 5, verifyRounds: 4, checksPassed: 1, checksFailed: ['unit-tests'], buildMs: null, bundleBytes: null },
    design: { grade: 'B', score: 86, slopScore: 27, livingVisual: true, contrastAaa: 0.94, touchTargets: 1, pressAnswer: 0.86, focusVisible: 1, copySlop: 80, textSlop: 4 },
    cost: { modelCalls: 9, inputTokens: 88_000, outputTokens: 8200, usdMicros: 0, wallMs: 9 * 60_000 },
    review: { plan: null, acceptance: null, verdict: null },
    delta: [{ metric: '타입 에러', before: '0', after: '3', better: false }, { metric: '검증 회차', before: '1회', after: '4회', better: false }],
    proof: '타입 에러 0→3, 검증 회차 1회→4회',
  }),
  receipt({ id: 'led_1', taskId: 'tsk_first', createdAt: min(-420), track: 'fast', design: { grade: 'B', score: 85, slopScore: 30, livingVisual: false, contrastAaa: 0.9, touchTargets: 0.92, pressAnswer: 0.5, focusVisible: 0.8, copySlop: 100, textSlop: 6 }, review: { plan: null, acceptance: null, verdict: null } }),
];

const quota: SubscriptionQuota[] = [
  { id: 'claude-code', connected: true, detail: '2.1.322 (Claude Code)', state: 'ok', resetsAt: null, limitedSince: null, lastAnswerAt: min(-2), recent: { tokens: 1_840_000, calls: 61 }, week: { tokens: 12_400_000, calls: 388 } },
  { id: 'codex', connected: true, detail: 'codex-cli 0.153.4', state: 'limited', resetsAt: Date.now() + 134 * 60_000, limitedSince: min(-12), lastAnswerAt: min(-40), recent: { tokens: 420_000, calls: 14 }, week: { tokens: 2_900_000, calls: 96 } },
  { id: 'antigravity', connected: false, detail: 'agy is not installed', state: 'unknown', resetsAt: null, limitedSince: null, lastAnswerAt: null, recent: { tokens: 0, calls: 0 }, week: { tokens: 0, calls: 0 } },
  { id: 'cursor', connected: true, detail: '2026.11.11', state: 'unknown', resetsAt: null, limitedSince: null, lastAnswerAt: null, recent: { tokens: 0, calls: 0 }, week: { tokens: 0, calls: 0 } },
];

type Handlers = { [M in MethodName]?: (params: ParamsOf<M>) => ResultOf<M> };

const demoModels: Record<string, { id: string; label: string }[]> = {
  'native-claude': [{ id: 'claude-fable-5-2', label: 'Claude Fable 5.2' }, { id: 'claude-opus-5-5', label: 'Claude Opus 5.5' }, { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5' }, { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5' }],
  'claude-code': [{ id: 'fable', label: 'Claude Fable' }, { id: 'opus', label: 'Claude Opus' }, { id: 'sonnet', label: 'Claude Sonnet' }, { id: 'haiku', label: 'Claude Haiku' }],
  codex: [{ id: 'gpt-6-astra', label: 'GPT-6-Astra' }, { id: 'gpt-5.6-sol', label: 'GPT-5.6-Sol' }, { id: 'gpt-5.6-terra', label: 'GPT-5.6-Terra' }, { id: 'gpt-5.6-luna', label: 'GPT-5.6-Luna' }],
  cursor: [
    ['composer-2.5', 'Composer 2.5'], ['composer-2.5-fast', 'Composer 2.5 Fast'], ['gpt-5.3-codex', 'Codex 5.3'], ['gpt-5.3-codex-high', 'Codex 5.3 High'], ['gpt-5.2', 'GPT-5.2'],
    ['gpt-5.6-sol-high', 'GPT-5.6 Sol 1M High'], ['gpt-5.6-luna-high', 'GPT-5.6 Luna 1M High'], ['claude-opus-5-5-medium', 'Claude Opus 5.5 1M'], ['claude-opus-5-5-high', 'Claude Opus 5.5 1M High'],
    ['claude-sonnet-5-thinking-high', 'Claude Sonnet 5 1M Thinking'], ['claude-fable-5-thinking-high', 'Claude Fable 5 1M Thinking (NO ZDR)'], ['grok-4.7-medium', 'Grok 4.7 Medium'], ['grok-4.7-high', 'Grok 4.7 High'], ['cursor-grok-4.6-high', 'Grok 4.6'],
  ].map(([id, label]) => ({ id: id!, label: label! })),
};

const demoSettings: OwnerSettings = {
  ntfy: { enabled: true, server: 'https://ntfy.sh', topic: 'sz-7c1e0a44b9d2', commandTopic: 'sz-cmd-2f90d6c81a35' },
  telegram: { enabled: false, allowedUserIds: [] },
  slack: { enabled: false, allowedUserIds: [] },
  budgets: { taskTokens: 2_000_000, projectDailyTokens: 20_000_000 },
  approvals: { ttlSec: 3600 },
};

const handlers: Handlers = {
  'system.status': () => ({
    version: '0.1.0', protocol: 1, uptimeSec: 86_400, runtime: { context: 'orbstack', reachable: true, detail: '29.8.2 linux/arm64' }, relays: [{ id: 'telegram', state: 'connected' }, { id: 'slack', state: 'disabled' }, { id: 'ntfy', state: 'disabled' }], queue: { queued: 0, running: 1 },
    engines: [
      { id: 'native-claude', available: true, reason: 'Anthropic API key present in vault' },
      { id: 'claude-code', available: true, reason: '2.1.322 (Claude Code); lockdown: --tools "" + --strict-mcp-config' },
      { id: 'codex', available: true, reason: 'codex-cli 0.153.4; lockdown: --sandbox read-only + --disable shell_tool/…' },
      { id: 'cursor', available: true, reason: '2026.11.11; lockdown: host jail: home hidden, no shell can start' },
      { id: 'antigravity', available: false, reason: 'agy is not installed' },
    ],
    brain: 'api',
  }),
  // Cursor's level is part of its model names; the others take it as a setting of their own.
  'engines.models': (p) => ({ models: demoModels[p.engine] ?? [], efforts: p.engine === 'cursor' || p.engine === 'antigravity' ? [] : ['low', 'medium', 'high', 'xhigh', 'max'] }),
  'projects.list': () => ({ projects, live: [{ projectId: 'prj_core', sandbox: 'running', busy: false }, { projectId: 'prj_ledger', sandbox: 'running', busy: true }, { projectId: 'prj_atlas', sandbox: 'stopped', busy: false }, { projectId: 'prj_tide', sandbox: 'stopped', busy: false }, { projectId: 'prj_pace', sandbox: 'running', busy: true }, { projectId: 'prj_harbor', sandbox: 'running', busy: true }] }),
  'ledger.list': (p) => ({ entries: ledger.filter((e) => e.projectId === p.projectId) }),
  'external.list': (p) => ({ apis: p.projectId === 'prj_ledger' ? [{ projectId: 'prj_ledger', name: 'tosspay', origin: 'https://api.tosspayments.com', variables: ['SECRET_KEY'], createdAt: min(-200) }] : [] }),
  'power.get': () => ({ mode: 'system', supported: true }),
  'quota.get': () => ({ at: Date.now(), subscriptions: quota }),
  'selfhost.status': () => ({
    available: true, detail: 'tasks start from main at 9f3f205a1c3e', repoPath: '/Users/owner/studio-zero', baseBranch: 'main', head: '9f3f205a1c3e', clean: true, projectId: 'prj_core',
    pending: [{ taskId: 'tsk_core_quota', branch: 'feature/quota-popover-quota0', files: 6, insertions: 214, deletions: 9 }],
  }),
  'sessions.list': (p) => ({ sessions: sessions.filter((s) => s.projectId === p.projectId) }),
  'files.list': (p) => ({ entries: p.projectId === 'prj_ledger' ? fileEntries.filter((e) => parentOf(e.path) === (p.path ?? '.')) : [], truncated: false }),
  'mockups.page': (p) => ({ html: (p.projectId === 'prj_tide' ? tideFiles[p.file] : undefined) ?? null }),
  'files.read': (p) => {
    const content = (p.projectId === 'prj_tide' ? tideFiles[p.path] : fileBodies[p.path]) ?? '';
    return { content, encoding: 'utf-8', size: new TextEncoder().encode(content).length, truncated: false, binary: false };
  },
  'sandbox.info': (p) => sandbox(p.projectId),
  'preview.start': () => ({ containerPort: 5173, localhost: 'http://localhost:32775', orbLocal: 'http://sz-ledger.orb.local:5173' }),
  'tasks.list': (p) => ({ tasks: tasks.filter((t) => p.projectId === undefined || t.projectId === p.projectId) }),
  'tasks.get': (p) => tasks.find((t) => t.id === p.taskId)!,
  'approvals.list': (p) => ({ approvals: approvals.filter((a) => p.state === undefined || a.state === p.state) }),
  'plans.list': (p) => ({ versions: planVersions.filter((v) => v.taskId === p.taskId), revisionsLeft: 2 }),
  'checkpoints.list': (p) => ({ checkpoints: checkpoints.filter((c) => c.projectId === p.projectId) }),
  'audits.list': (p) => ({ audits: [audit, unreviewedAudit].filter((a) => a.projectId === p.projectId).map((a) => ({ id: a.id, taskId: a.taskId, createdAt: a.createdAt, score: a.score, passed: a.passed })) }),
  'audits.get': (p) => (p.auditId === unreviewedAudit.id ? unreviewedAudit : audit),
  'audits.redesign': () => tasks.find((t) => t.id === 'tsk_detail')!,
  'tasks.resume': (p) => ({ ...tasks.find((t) => t.id === p.taskId)!, state: 'queued' }),
  'lessons.list': (p) => ({ lessons: lessons.filter((l) => p.projectId === undefined || l.projectId === p.projectId) }),
  'evals.list': (p) => ({ evals: evals.filter((e) => e.projectId === p.projectId) }),
  'kirby.proposals': (p) => ({ proposals: proposals.filter((c) => c.projectId === p.projectId) }),
  // One note was put away: it is listed apart, under its own heading.
  'scratch.list': (p) => ({ scratchpads: p.archived ? [{ ...pads[0]!, id: 'scr_shelved', title: '견적서 자동 발송을 넣을지', state: 'archived' as const }] : pads }),
  'scratch.get': (p) =>
    p.scratchId === 'scr_capex'
      ? { scratchpad: pads[1]!, entries: capexEntries, spec: '', decisionLog: '', readiness: { ready: false, missing: ['기획 명세의 "문제" 항목'] }, thinking: false, jobs: [capexJob] }
      : {
          scratchpad: pads[0]!, entries: fieldEntries, thinking: false, jobs: [],
          spec: '# 현장 기사용 청구서 앱\n\n## 문제\n\n설비 기사가 미결제 청구서를 사무실에 돌아와서야 확인한다.\n\n## 사용자\n\n하루 5~8곳을 방문하는, 혼자 일하는 설비 기사.',
          decisionLog: '# 결정 기록: 현장 기사용 청구서 앱\n\n## 1. 첫 사용자는 누구인가\n\n- 결정: 혼자 일하는 설비 기사\n- 결정한 쪽: 에이전트 (확신도 높음)\n- 기각한 대안:\n  - 5인 이상 업체의 경리 담당: 기존 회계 도구와 정면으로 겹칩니다.',
          readiness: { ready: false, missing: ['기획 명세의 "범위: 포함" 항목', '기획 명세의 "요구사항" 항목', '답하지 않은 질문 1건'] },
        },
  'config.get': () => ({ settings: demoSettings, writable: true, restartRequired: false, supervised: true, file: '~/.studio-zero/config.json', logFile: '~/Library/Logs/studio-zero/daemon.log' }),
  'config.set': (p) => ({ settings: p.settings, restartRequired: true }),
  'system.restart': () => ({ accepted: true as const }),
  'knowledge.list': () => ({ jobs: [capexJob] }),
  'knowledge.get': () => ({ job: capexJob, markdown: capexBrief, report: null, lint: [] }),
  'ax.calibration': () => ({ levels: { high: { total: 14, overridden: 1 }, medium: { total: 9, overridden: 4 }, speculative: { total: 3, overridden: 2 } }, highDemoted: false }),
  'mcp.list': () => ({
    servers: [
      { id: 'github', name: 'GitHub', transport: 'http', command: null, args: [], tokenEnv: null, url: 'https://api.githubcopilot.com/mcp/', auth: 'bearer', about: '', builtin: true, credentialId: 'mcp/github/token', state: 'ready', grants: [{ projectId: 'prj_ledger', tool: 'create_issue' }, { projectId: 'prj_ledger', tool: 'list_pull_requests' }] },
      { id: 'stripe', name: 'Stripe', transport: 'http', command: null, args: [], tokenEnv: null, url: 'https://mcp.stripe.com', auth: 'bearer', about: '', builtin: true, credentialId: 'mcp/stripe/token', state: 'needs-token', grants: [] },
      { id: 'blender', name: 'Blender', transport: 'stdio', command: '/Users/me/.local/bin/uvx', args: ['mcp-for-blender'], tokenEnv: null, url: '', auth: 'none', about: '', builtin: false, credentialId: 'mcp/blender/token', state: 'ready', grants: [{ projectId: 'prj_atlas', tool: 'get_scene_info' }] },
      { id: 'notion', name: 'Notion', transport: 'http', command: null, args: [], tokenEnv: null, url: 'https://mcp.notion.com/mcp', auth: 'oauth', about: '', builtin: true, credentialId: 'mcp/notion/token', state: 'unsupported', grants: [] },
    ],
  }),
  'vault.list': () => ({ credentials: [{ id: 'daemon/client-token', createdAt: min(-900), updatedAt: min(-900) }, { id: 'provider/anthropic/api-key', createdAt: min(-890), updatedAt: min(-890) }] }),
  'events.history': () => ({ events }),
};

export function demoBackend(): Backend {
  return {
    demo: true,
    host: 'demo',
    call: async <M extends MethodName>(method: M, params: ParamsOf<M>): Promise<ResultOf<M>> => {
      const handler = handlers[method] as ((p: ParamsOf<M>) => ResultOf<M>) | undefined;
      if (!handler) throw new Error('데모에서는 변경할 수 없습니다. 데몬에 연결하면 실제로 동작합니다.');
      return handler(params);
    },
    subscribe: (filter, onEvent, sinceSeq) => {
      if (sinceSeq !== 'now') queueMicrotask(() => events.filter((e) => matchesFilter(e, filter)).forEach(onEvent));
      return () => undefined;
    },
    // A shell that only echoes: enough to show the terminal, and honest about not running anything.
    openTerminal: async (_params, handlers) => {
      const prompt = '\x1b[32mnode@ledger\x1b[0m:\x1b[34m/workspace\x1b[0m$ ';
      let line = '';
      let open = true;
      queueMicrotask(() => handlers.onOutput(`데모 터미널입니다. 데몬에 연결하면 샌드박스의 실제 셸이 열립니다.\r\n${prompt}`));
      return {
        id: 'trm_demo',
        write: (data) => {
          if (!open) return;
          for (const ch of data) {
            if (ch === '\r') {
              handlers.onOutput(`\r\n${line.trim() ? `${line.trim().split(' ')[0]}: 데모에서는 명령을 실행하지 않습니다\r\n` : ''}${prompt}`);
              line = '';
            } else if (ch === '\x7f') {
              if (line !== '') handlers.onOutput('\b \b');
              line = line.slice(0, -1);
            } else if (ch >= ' ') {
              line += ch;
              handlers.onOutput(ch);
            }
          }
        },
        resize: async () => undefined,
        kill: async () => {
          if (open) handlers.onExit(null, 'killed');
          open = false;
        },
      };
    },
    artifactUrl: async (id) => (id.startsWith('art_film_') ? fakeScreen(1440, 324) : id === 'art_mock_a' ? fakeMockup('a') : id === 'art_mock_b' ? fakeMockup('b') : id === 'art_mock_c' ? fakeMockup('c') : id === 'art_tablet' ? fakeScreen(834, 1194) : id === 'art_desktop' ? fakeScreen(1440, 900) : fakeScreen(393, 659)),
    close: () => undefined,
  };
}
