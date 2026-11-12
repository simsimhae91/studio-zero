import type { Approval, AuditReport, AxBlock, Checkpoint, Eval, EventBody, EventEnvelope, FileEntry, KnowledgeJob, Lesson, MethodName, ParamsOf, Project, ProposalCard, ResultOf, SandboxInfo, ScratchEntry, Scratchpad, Session, Task } from '@studio-zero/protocol';
import { matchesFilter } from '@studio-zero/protocol';
import type { Backend } from './backend.ts';

/**
 * A daemon made of fixtures (`?demo` in the URL). It exists so the interface can be reviewed, and put through
 * the same visual audit as the projects it builds, without a daemon, a model or a container engine.
 */

const T0 = Date.UTC(2026, 10, 12, 1, 30);
const min = (n: number): number => T0 + n * 60_000;

const projects: Project[] = [
  { id: 'prj_ledger', slug: 'ledger', name: 'Ledger', template: 'web-vite-react', createdAt: min(-600) },
  { id: 'prj_atlas', slug: 'atlas', name: 'Atlas 모바일', template: 'mobile-expo', createdAt: min(-300) },
];

const baseTask = { projectId: 'prj_ledger', origin: 'desktop', engine: 'native-claude', model: 'claude-opus-5-5', budgetTokens: 2_000_000, error: null, baseBranch: null, enginePref: null, sessionId: null, track: 'full' } as const;
const sessions: Session[] = [{ id: 'ses_refactor', projectId: 'prj_ledger', name: 'refactor/dates', createdAt: min(-241) }];
const tasks: Task[] = [
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

const approvals: Approval[] = [
  {
    id: 'apr_budget', projectId: 'prj_ledger', taskId: 'tsk_detail', actionKind: 'task.extend-budget', actionHash: 'f'.repeat(64),
    summary: '작업 tsk_detail이(가) 토큰 예산을 다 썼습니다. 2,000,000 토큰을 더 줄까요?', state: 'pending', requestedAt: min(-1), expiresAt: min(59), resolvedAt: null, resolvedVia: null,
  },
];

const bodies: EventBody[] = [
  { type: 'task.state', state: 'running', error: null },
  { type: 'task.phase', phase: 'plan', round: 0 },
  { type: 'route.decided', taskKind: 'build', engine: 'native-claude', model: 'claude-opus-5-5', effort: 'high', considered: [{ engine: 'native-claude', available: true, reason: 'Anthropic API key present in vault' }] },
  { type: 'checkpoint.created', checkpointId: 'ckp_b', label: 'before build tsk_detail' },
  { type: 'plan.created', summary: '상세 화면 아래쪽에 결제 이력 섹션을 추가합니다. 이력이 없을 때는 다음 행동을 안내합니다.', steps: ['결제 이력 타입과 예시 데이터를 src/data/payments.ts에 정의', 'InvoiceDetail에 이력 섹션 추가', '빈 상태 문구 작성'], auditRoutes: ['/invoices/1'], appliedLessonIds: ['les_tokens'] },
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
const events: EventEnvelope[] = bodies.map((body, i) => ({ seq: 100 + i, at: min(-18) + i * 35_000, projectId: 'prj_ledger', taskId: 'tsk_detail', body }));

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
  'README.md': '# Ledger\n\n미결제 청구서를 한 화면에서 보고 다시 보내는 앱입니다.\n',
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

type Handlers = { [M in MethodName]?: (params: ParamsOf<M>) => ResultOf<M> };

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
  'projects.list': () => ({ projects, live: [{ projectId: 'prj_ledger', sandbox: 'running', busy: true }, { projectId: 'prj_atlas', sandbox: 'stopped', busy: false }] }),
  'sessions.list': (p) => ({ sessions: sessions.filter((s) => s.projectId === p.projectId) }),
  'files.list': (p) => ({ entries: p.projectId === 'prj_ledger' ? fileEntries.filter((e) => parentOf(e.path) === (p.path ?? '.')) : [], truncated: false }),
  'files.read': (p) => {
    const content = fileBodies[p.path] ?? '';
    return { content, encoding: 'utf-8', size: new TextEncoder().encode(content).length, truncated: false, binary: false };
  },
  'sandbox.info': (p) => sandbox(p.projectId),
  'preview.start': () => ({ containerPort: 5173, localhost: 'http://localhost:32775', orbLocal: 'http://sz-ledger.orb.local:5173' }),
  'tasks.list': (p) => ({ tasks: tasks.filter((t) => p.projectId === undefined || t.projectId === p.projectId) }),
  'tasks.get': (p) => tasks.find((t) => t.id === p.taskId)!,
  'approvals.list': (p) => ({ approvals: approvals.filter((a) => p.state === undefined || a.state === p.state) }),
  'checkpoints.list': (p) => ({ checkpoints: checkpoints.filter((c) => c.projectId === p.projectId) }),
  'audits.list': (p) => ({ audits: [audit, unreviewedAudit].filter((a) => a.projectId === p.projectId).map((a) => ({ id: a.id, taskId: a.taskId, createdAt: a.createdAt, score: a.score, passed: a.passed })) }),
  'audits.get': (p) => (p.auditId === unreviewedAudit.id ? unreviewedAudit : audit),
  'audits.redesign': () => tasks.find((t) => t.id === 'tsk_detail')!,
  'tasks.resume': (p) => ({ ...tasks.find((t) => t.id === p.taskId)!, state: 'queued' }),
  'lessons.list': (p) => ({ lessons: lessons.filter((l) => p.projectId === undefined || l.projectId === p.projectId) }),
  'evals.list': (p) => ({ evals: evals.filter((e) => e.projectId === p.projectId) }),
  'kirby.proposals': (p) => ({ proposals: proposals.filter((c) => c.projectId === p.projectId) }),
  'scratch.list': () => ({ scratchpads: pads }),
  'scratch.get': (p) =>
    p.scratchId === 'scr_capex'
      ? { scratchpad: pads[1]!, entries: capexEntries, spec: '', decisionLog: '', readiness: { ready: false, missing: ['기획 명세의 "문제" 항목'] }, thinking: false, jobs: [capexJob] }
      : {
          scratchpad: pads[0]!, entries: fieldEntries, thinking: false, jobs: [],
          spec: '# 현장 기사용 청구서 앱\n\n## 문제\n\n설비 기사가 미결제 청구서를 사무실에 돌아와서야 확인한다.\n\n## 사용자\n\n하루 5~8곳을 방문하는, 혼자 일하는 설비 기사.',
          decisionLog: '# 결정 기록: 현장 기사용 청구서 앱\n\n## 1. 첫 사용자는 누구인가\n\n- 결정: 혼자 일하는 설비 기사\n- 결정한 쪽: 에이전트 (확신도 높음)\n- 기각한 대안:\n  - 5인 이상 업체의 경리 담당: 기존 회계 도구와 정면으로 겹칩니다.',
          readiness: { ready: false, missing: ['기획 명세의 "범위: 포함" 항목', '기획 명세의 "요구사항" 항목', '답하지 않은 질문 1건'] },
        },
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
    artifactUrl: async (id) => (id === 'art_tablet' ? fakeScreen(834, 1194) : id === 'art_desktop' ? fakeScreen(1440, 900) : fakeScreen(393, 659)),
    close: () => undefined,
  };
}
