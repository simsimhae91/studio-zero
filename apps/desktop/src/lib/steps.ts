import type { AdvisorId, EventEnvelope, FlowStop, FlowWalk, MockupMeasures } from '@studio-zero/protocol';
import { duration, evalLabel, reviewerLabel } from './format.ts';

export type StepKind = 'plan' | 'reference' | 'anchor' | 'review' | 'scaffold' | 'install' | 'write' | 'read' | 'check' | 'measure' | 'run' | 'tool' | 'verify';
export type StepState = 'done' | 'active' | 'failed';

/** One line inside an opened step: a command, a planned step, a check and how it went. */
export interface StepLine {
  text: string;
  /** Commands and paths are set in the code face. */
  mono: boolean;
  /** `warn`: a check that could not reach a verdict. Not a failure, and not a pass. */
  tone: 'plain' | 'good' | 'bad' | 'warn';
  /** How it ended, in a few words: "완료, 1.2초". */
  meta: string;
  /** Raw output of something that failed. Sandbox or page output: only ever rendered as text. */
  output: string;
}

/** A unit of work the owner can read at a glance: what was done, to what, and whether it held. */
export interface Step {
  kind: StepKind;
  state: StepState;
  title: string;
  /** The subject in a few words: package names, a file, a command. */
  detail: string;
  at: number;
  lines: StepLine[];
  /** Things the agent said while doing this. Kept with the step instead of interrupting the list. */
  notes: string[];
  /** Verify steps only: the visual audit of that round, if one ran. */
  audit: {
    /** The audit this round ran, and the one the task's round before it ran: the same screen before and after the repair. */
    id: string;
    previousId: string | null;
    grade: string | null;
    score: number;
    passed: boolean;
    blockers: number;
    majors: number;
    minors: number;
    /** False: no design reviewer saw the screens. Undefined on audits recorded before that was tracked. */
    visionReviewed?: boolean;
  } | null;
}

/** One drawn direction of a design task: the page it was drawn from, the picture of it, and what the daemon measured on it. */
export interface Mockup {
  file: string;
  title: string;
  idea: string;
  artifactId: string;
  width: number;
  height: number;
  /** The core flow as a browser carried it out on the page. Absent on designs from before mock-ups were walked. */
  flow?: FlowWalk | null;
  measures?: MockupMeasures | null;
}

const STOPPED: Record<FlowStop, (step: number | null) => string> = {
  'already-done': () => '화면이 이미 끝난 뒤의 모습으로 열립니다',
  'step-missing': (step) => `${step ?? 1}번째로 누를 곳이 화면에 없습니다`,
  covered: (step) => `${step ?? 1}번째로 누를 곳이 다른 요소에 가려 있습니다`,
  'outcome-not-shown': () => '끝까지 눌러도 결과가 나타나지 않습니다',
};

/**
 * A mock-up's walk as one line the owner can compare across directions: what it took to get the core flow done.
 * Every figure is a count the daemon made in a browser; `ok` is false when the flow could not be walked to its end.
 */
export function flowLine(flow: FlowWalk): { ok: boolean; text: string } {
  const stuck = flow.tasks.find((t) => !t.reached);
  if (flow.tasks.length === 0) return { ok: false, text: '핵심 흐름을 걷지 못했습니다' };
  if (stuck) return { ok: false, text: `핵심 흐름이 끝까지 가지 않음: ${stuck.stopped ? STOPPED[stuck.stopped](stuck.stoppedAtStep) : '멈춘 곳을 알 수 없습니다'}` };
  const sum = (pick: (t: FlowWalk['tasks'][number]) => number): number => flow.tasks.reduce((n, t) => n + pick(t), 0);
  const [presses, typed, scrolls, answered] = [sum((t) => t.presses), sum((t) => t.typed), sum((t) => t.scrolls), sum((t) => t.answered)];
  const smallest = Math.min(...flow.tasks.flatMap((t) => (t.smallestTargetPx === null ? [] : [t.smallestTargetPx])));
  const parts = [`누름 ${presses}번`, typed > 0 ? `입력 ${typed}자` : null, scrolls > 0 ? `스크롤 ${scrolls}번` : '스크롤 없음', Number.isFinite(smallest) ? `가장 작은 버튼 ${smallest}px` : null, `눌렀을 때 답함 ${answered}/${presses}`];
  return { ok: true, text: `핵심 흐름 ${parts.filter(Boolean).join(' · ')}` };
}

/** A mock-up's audit as one line: what was measured wrong on the page, and how generated it reads to the reviewer. */
export function measuresLine(m: MockupMeasures): { ok: boolean; text: string } {
  const found = m.blockers + m.majors + m.copyHabits;
  const parts = [m.blockers > 0 ? `막는 결함 ${m.blockers}` : null, m.majors > 0 ? `큰 결함 ${m.majors}` : null, m.copyHabits > 0 ? `문구 습관 ${m.copyHabits}` : null, found === 0 ? '측정된 결함 없음' : null, m.slopScore === null ? '디자인 심사 없음' : `슬롭 지수 ${m.slopScore}`];
  return { ok: m.blockers === 0 && m.copyHabits === 0 && (m.slopScore === null || m.slopScore <= 30), text: parts.filter(Boolean).join(' · ') };
}

const BUILD_FROM_DESIGN = 'docs/prd.md, docs/architecture.md, docs/erd.md, docs/openapi.yaml에 정리한 설계대로 MVP를 구현해줘. 문서에서 범위 밖으로 둔 것은 만들지 말고, 문서와 다르게 구현해야 하는 부분이 생기면 마지막에 알려줘.';
/** A mock-up page as the daemon names it. */
const MOCKUP_PATH = /^docs\/mockups\/([abc])\.html$/;

/** `docs/mockups/b.html` → "B안". */
export const mockupName = (file: string): string => `${(MOCKUP_PATH.exec(file)?.[1] ?? '?').toUpperCase()}안`;

/**
 * The request that starts a build from a finished design, naming the direction the owner picked by its file.
 * This text is sent as the owner's own words, so nothing a model wrote goes into it: not the mock-up's title,
 * not its description, and no path that is not one of the three the daemon draws.
 */
export function buildRequest(mockup: string | null): string {
  if (mockup === null || !MOCKUP_PATH.test(mockup)) return BUILD_FROM_DESIGN;
  return `${BUILD_FROM_DESIGN}\n\n첫 화면은 ${mockup} 시안을 기준으로 만들어줘. 무엇이 앞에 오는지, 어떻게 배치하는지, 사람이 처음 하는 일은 그 시안을 따르고, 다른 시안의 구성은 섞지 마.`;
}

export type Item =
  | { kind: 'steps'; at: number; steps: Step[] }
  | { kind: 'said'; at: number; text: string }
  | { kind: 'steer'; at: number; text: string; delivered: boolean }
  | { kind: 'denied'; at: number; reason: string }
  | { kind: 'note'; at: number; text: string }
  /** A design task's directions as pictures. The card that ends the task shows them; `title` and `idea` are a model's words. */
  | { kind: 'mockups'; at: number; options: Mockup[] }
  /** Directions as they stand while the task is still drawing them: what the studio drew each time the engine had a page measured. Gone once the finished set arrives. */
  | { kind: 'drafts'; at: number; options: Mockup[] }
  | { kind: 'advisor'; at: number; advisor: AdvisorId; question: string; answer: string; ok: boolean; durationMs: number };

const SCAFFOLD = /\b(?:pnpm|npm|npx|yarn|bun|bunx)\s+(?:create|dlx|init)\b|\bcreate-(?:vite|next-app|expo-app|expo|react-app)\b/;
const INSTALL = /\b(?:pnpm|npm|yarn|bun)\s+(?:add|install|i)\b|\bexpo\s+install\b/;
const CHECK = /\b(?:tsc|typecheck|type-check|lint|eslint|vitest|jest|test|build)\b/;
const READ = /^\s*(?:ls|cat|head|tail|grep|rg|find|tree|pwd|wc|git\s+(?:status|diff|log|show|ls-files))\b/;

/** What kind of work a tool call is, from the tool and, for the shell, from the command itself. */
export function classify(tool: string, input: string): StepKind {
  if (tool === 'write_file' || tool === 'edit_file') return 'write';
  if (tool === 'read_file') return 'read';
  if (tool === 'find_tools' || tool === 'use_tool') return 'tool';
  if (tool === 'check_mockup') return 'measure';
  if (tool !== 'bash') return 'run';
  if (SCAFFOLD.test(input)) return 'scaffold';
  if (INSTALL.test(input)) return 'install';
  if (CHECK.test(input)) return 'check';
  if (READ.test(input)) return 'read';
  return 'run';
}

/** Package names out of an install command: `pnpm add @shopify/react-native-skia expo-image-picker@^17 -D` → skia, image-picker. */
export function packagesOf(command: string): string[] {
  const names: string[] = [];
  for (const part of command.split(/&&|\|\||;|\n/)) {
    const match = /\b(?:pnpm|npm|yarn|bun)\s+(?:add|install|i)\b(.*)|\bexpo\s+install\b(.*)/.exec(part);
    if (!match) continue;
    for (const word of (match[1] ?? match[2] ?? '').trim().split(/\s+/)) {
      if (word === '' || word.startsWith('-')) continue;
      // Drop the version, then the scope: the last segment is what people call the package.
      const bare = word.replace(/(?!^)@[^/]*$/, '');
      const short = bare.includes('/') ? bare.slice(bare.lastIndexOf('/') + 1) : bare;
      if (short !== '' && !names.includes(short)) names.push(short);
    }
  }
  return names;
}

function some(names: readonly string[], limit: number): string {
  return names.length <= limit ? names.join(', ') : `${names.slice(0, limit).join(', ')} 외 ${names.length - limit}개`;
}

function scaffoldOf(command: string): string {
  const stack = /expo/i.test(command) ? 'Expo' : /next/i.test(command) ? 'Next.js' : /vite/i.test(command) ? 'Vite' : '';
  const typed = /typescript|react-ts|--ts\b|-ts\b|tabs|blank-typescript/i.test(command) ? 'TypeScript' : '';
  return [stack, typed].filter(Boolean).join(' / ');
}

const pathOf = (input: string): string => input.split(' ')[0] ?? input;
const fileName = (path: string): string => path.slice(path.lastIndexOf('/') + 1);

interface Call {
  id: string;
  tool: string;
  input: string;
  ok: boolean | null;
  exitCode: number | null;
  ms: number | null;
  preview: string;
  /** Which of the task's engines made the call, when several work at once: a design task's "a", "b", "c". */
  lane: string | null;
}

interface Building {
  step: Step;
  calls: Call[];
}

/** Title and subject of a group of tool calls, from the calls themselves. No model wrote these words. */
function describe(kind: StepKind, calls: readonly Call[], active: boolean): { title: string; detail: string } {
  const inputs = calls.map((c) => c.input);
  const failed = calls.filter((c) => c.ok === false).length;
  const retried = failed > 0 && !active ? `, ${failed}건 실패 후 계속` : '';
  switch (kind) {
    case 'scaffold':
      return { title: active ? '프로젝트 스캐폴드 중' : '프로젝트 스캐폴드', detail: inputs.map(scaffoldOf).find(Boolean) ?? '' };
    case 'install': {
      const names = [...new Set(inputs.flatMap(packagesOf))];
      return { title: active ? '의존성 설치 중' : `의존성 설치${retried}`, detail: names.length > 0 ? some(names, 3) : 'package.json 기준' };
    }
    case 'write': {
      const paths = [...new Set(inputs.map(pathOf))];
      return { title: active ? '파일 작성 중' : `파일 ${paths.length}개 작성${retried}`, detail: paths.length === 1 ? paths[0]! : `${fileName(paths.at(-1)!)} 외 ${paths.length - 1}개` };
    }
    case 'read':
      return { title: active ? '코드 확인 중' : '코드 확인', detail: `${calls.length}건` };
    case 'check':
      return { title: active ? '타입 검사·빌드 실행 중' : `타입 검사·빌드${failed > 0 ? `, ${failed}건 실패` : ' 통과'}`, detail: inputs.at(-1) ?? '' };
    case 'measure': {
      // The engine asking the studio to measure a page it is drawing. What was drawn for it is shown as a draft.
      const pages = [...new Set(inputs.map(mockupName))];
      return { title: active ? '시안 측정 중' : `시안 측정 ${calls.length}회`, detail: pages.join(', ') };
    }
    case 'tool':
      return { title: active ? '외부 도구 사용 중' : '외부 도구 사용', detail: inputs.at(-1) ?? '' };
    default:
      return { title: active ? '명령 실행 중' : `명령 ${calls.length}건 실행${retried}`, detail: inputs.at(-1) ?? '' };
  }
}

function refresh(group: Building): void {
  const active = group.calls.some((c) => c.ok === null);
  const { title, detail } = describe(group.step.kind, group.calls, active);
  group.step.title = title;
  group.step.detail = detail;
  group.step.state = active ? 'active' : group.step.kind === 'check' && group.calls.at(-1)?.ok === false ? 'failed' : 'done';
  group.step.lines = group.calls.map((c) => ({
    text: `${c.lane ? `${laneName(c.lane)} · ` : ''}${c.tool === 'bash' ? c.input : `${c.tool} ${c.input}`}`,
    mono: true,
    tone: c.ok === false ? 'bad' : 'plain',
    meta: c.ok === null ? '실행 중' : `${c.ok ? '완료' : `실패${c.exitCode === null ? '' : `, 종료 코드 ${c.exitCode}`}`}${c.ms === null ? '' : `, ${duration(c.ms)}`}`,
    output: c.ok === false ? c.preview : '',
  }));
}

/** A lane as the owner reads it: a direction's engine is named by its direction. */
const laneName = (lane: string): string => (/^[abc]$/.test(lane) ? `${lane.toUpperCase()}안` : lane);

const gateLabel = { compiler: '컴파일', smoke: '스모크 테스트', anchor: '고정표', build: '프로덕션 빌드', screens: '화면 명세', flow: '시안에서 핵심 흐름 걷기', directions: '시안 방향표' } as const;

/**
 * A task's event stream as what the owner reads: a short list of steps with their outcome, the agent's closing
 * words for each round, and the moments someone other than the agent spoke (the owner steering, policy refusing,
 * another model's opinion). Everything here is derived from events; the list is the same on every replay.
 */
export function narrate(events: readonly EventEnvelope[]): Item[] {
  const items: Item[] = [];
  const calls = new Map<string, { call: Call; group: Building }>();
  const waiting: Extract<Item, { kind: 'steer' }>[] = [];
  let group: Building | null = null;
  let verify: Step | null = null;
  /** The last audit the task ran so far: what the next round's screen is set beside. */
  let lastAuditId: string | null = null;
  /** The agent's latest words, if nothing has followed them yet: a closing message, unless a tool call comes next. */
  let trailing: Extract<Item, { kind: 'said' }> | null = null;

  const pushStep = (step: Step): void => {
    const last = items.at(-1);
    if (last?.kind === 'steps') last.steps.push(step);
    else items.push({ kind: 'steps', at: step.at, steps: [step] });
  };
  const settleVerify = (): void => {
    if (!verify) return;
    const failed = verify.lines.filter((l) => l.tone === 'bad');
    // Nothing failed, but something could not be checked: the round is over without being a clean pass.
    const unverified = failed.length > 0 ? [] : verify.lines.filter((l) => l.tone === 'warn');
    verify.state = failed.length > 0 ? 'failed' : 'done';
    verify.title = failed.length > 0 ? `${verify.title} 실패` : unverified.length > 0 ? `${verify.title}: 검증하지 못한 항목 있음` : verify.lines.length === 0 ? `${verify.title}: 확인할 항목 없음` : `${verify.title} 통과`;
    verify.detail = (failed.length > 0 ? failed : unverified.length > 0 ? unverified : verify.lines).map((l) => l.text).join(', ');
    verify = null;
  };
  const closeWork = (): void => {
    group = null;
    trailing = null;
  };

  for (const e of events) {
    const b = e.body;
    switch (b.type) {
      case 'task.phase':
        settleVerify();
        closeWork();
        if (b.phase === 'verify') {
          verify = { kind: 'verify', state: 'active', title: `검증 ${b.round}회차`, detail: '', at: e.at, lines: [], notes: [], audit: null };
          pushStep(verify);
        }
        break;
      case 'task.state':
        if (b.state !== 'running' && b.state !== 'queued' && b.state !== 'awaiting_approval') settleVerify();
        break;
      case 'plan.created':
        pushStep({
          kind: 'plan',
          state: 'done',
          title: `계획 ${b.steps.length}단계`,
          detail: b.summary,
          at: e.at,
          lines: b.steps.map((text) => ({ text, mono: false, tone: 'plain', meta: '', output: '' })),
          notes: b.appliedLessonIds.length > 0 ? [`지난 작업의 교훈 ${b.appliedLessonIds.length}건을 반영했습니다.`] : [],
          audit: null,
        });
        break;
      case 'tool.call': {
        const kind = classify(b.tool, b.input);
        const notes: string[] = [];
        // Words followed by more work were narration, not a closing message: they go with the step they led into.
        if (trailing) {
          items.splice(items.lastIndexOf(trailing), 1);
          notes.push(trailing.text);
          trailing = null;
          group = items.at(-1)?.kind === 'steps' ? group : null;
        }
        if (!group || group.step.kind !== kind) {
          group = { step: { kind, state: 'active', title: '', detail: '', at: e.at, lines: [], notes: [], audit: null }, calls: [] };
          pushStep(group.step);
        }
        group.step.notes.push(...notes);
        const call: Call = { id: b.callId, tool: b.tool, input: b.input, ok: null, exitCode: null, ms: null, preview: '', lane: b.lane ?? null };
        group.calls.push(call);
        calls.set(b.callId, { call, group });
        refresh(group);
        break;
      }
      case 'tool.result': {
        const found = calls.get(b.callId);
        if (!found) break;
        Object.assign(found.call, { ok: b.ok, exitCode: b.exitCode, ms: b.durationMs, preview: b.preview });
        refresh(found.group);
        break;
      }
      case 'agent.text':
        if (b.text.trim() === '') break;
        trailing = { kind: 'said', at: e.at, text: b.text };
        items.push(trailing);
        break;
      case 'gate.result': {
        const line: StepLine = { text: gateLabel[b.gate], mono: false, tone: b.passed ? 'good' : 'bad', meta: `${b.passed ? '통과' : `실패${b.exitCode === null ? '' : `, 종료 코드 ${b.exitCode}`}`}, ${duration(b.durationMs)}`, output: b.passed ? '' : b.detail };
        if (verify) verify.lines.push(line);
        // Outside a verification round: the anchor table refused before any code (a pass is told by `anchor.committed`),
        // or the production build measured after the work was accepted.
        else if (b.gate === 'build' || (b.gate === 'anchor' && !b.passed)) {
          closeWork();
          pushStep({ kind: b.gate === 'build' ? 'check' : 'anchor', state: b.passed ? 'done' : 'failed', title: b.gate === 'build' ? `프로덕션 빌드 ${b.passed ? '통과' : '실패'}` : '고정표 미완성: 코드 작성 전에 멈춤', detail: b.gate === 'build' ? `${b.name}, ${duration(b.durationMs)}` : b.name, at: e.at, lines: [line], notes: [], audit: null });
        }
        break;
      }
      case 'reference.captured':
        closeWork();
        pushStep({ kind: 'reference', state: b.ok ? 'done' : 'failed', title: b.ok ? '레퍼런스 측정' : '레퍼런스를 열지 못함', detail: b.url, at: e.at, lines: [{ text: b.detail, mono: false, tone: b.ok ? 'plain' : 'bad', meta: b.ok ? 'QA 브라우저 컨테이너에서 열어 측정' : '', output: '' }], notes: [], audit: null });
        break;
      case 'anchor.committed':
        closeWork();
        pushStep({
          kind: 'anchor',
          state: 'done',
          title: b.author === 'workspace' ? '고정표 확인' : '고정표 확정',
          detail: b.idea,
          at: e.at,
          lines: [...b.directions.map((text, i) => ({ text: `방향 ${i + 1}: ${text}`, mono: false, tone: 'plain' as const, meta: '', output: '' })), { text: `첫 화면 볼거리: ${b.livingVisual}`, mono: false, tone: 'plain', meta: '', output: '' }],
          notes: [],
          audit: null,
        });
        break;
      case 'review.completed': {
        closeWork();
        const who = b.reviewer ? (reviewerLabel[b.reviewer] ?? b.reviewer) : '';
        const stage = b.stage === 'plan' ? '계획 교차 검토' : '최종 인수 검수';
        const title = b.reviewer === null ? `${stage}를 받지 못함` : b.stage === 'plan' ? `${stage}: 지적 ${b.points.length}건` : `${stage}: ${b.verdict === 'patch' ? '보정 패치 1건' : '통과'}`;
        pushStep({
          kind: 'review',
          state: 'done',
          title,
          detail: b.reviewer === null ? (b.reason ?? '') : `${who}, ${duration(b.durationMs)}`,
          at: e.at,
          // Another model's words: shown as text.
          lines: b.reviewer === null ? [{ text: b.reason ?? '', mono: false, tone: 'warn', meta: '', output: '' }] : b.points.map((text) => ({ text, mono: false, tone: 'plain' as const, meta: '', output: '' })),
          notes: [],
          audit: null,
        });
        break;
      }
      case 'mockups.drafted': {
        // One entry for the task's drafts, each page replaced by its latest measurement, in the order a, b, c.
        let drafts = items.find((item): item is Extract<Item, { kind: 'drafts' }> => item.kind === 'drafts');
        if (!drafts) items.push((drafts = { kind: 'drafts', at: e.at, options: [] }));
        drafts.options = [...drafts.options.filter((o) => o.file !== b.option.file), b.option].sort((x, y) => x.file.localeCompare(y.file));
        break;
      }
      case 'mockups.rendered': {
        closeWork();
        // The finished, judged set takes the drafts' place.
        const drafts = items.findIndex((item) => item.kind === 'drafts');
        if (drafts >= 0) items.splice(drafts, 1);
        items.push({ kind: 'mockups', at: e.at, options: b.options });
        break;
      }
      case 'image.generated':
        closeWork();
        // The purpose is the engine's own sentence: shown as text beside the path.
        pushStep({ kind: 'write', state: 'done', title: '이미지 생성', detail: b.path, at: e.at, lines: [{ text: b.purpose, mono: false, tone: 'plain', meta: `${b.width}×${b.height}, ${Math.round(b.bytes / 1024)}KB, ${duration(b.durationMs)}`, output: '' }], notes: [], audit: null });
        break;
      case 'ledger.recorded':
        items.push({ kind: 'note', at: e.at, text: b.proof === '' ? '장부에 기록했습니다.' : `장부에 기록했습니다. 직전 작업 대비 ${b.proof}` });
        break;
      case 'selfhost.exported':
        items.push({ kind: 'note', at: e.at, text: `이 Mac의 저장소에 ${b.branch} 브랜치로 내보냈습니다 (파일 ${b.files}개, +${b.insertions} −${b.deletions}). ${b.base}에는 아직 합쳐지지 않았습니다.` });
        break;
      case 'selfhost.merged':
        items.push({ kind: 'note', at: e.at, text: `${b.branch}를 ${b.into}에 합쳤습니다.` });
        break;
      case 'eval.result':
        verify?.lines.push({ text: evalLabel(b.name), mono: false, tone: b.passed ? 'good' : b.unverified ? 'warn' : 'bad', meta: `${b.passed ? '통과' : b.unverified ? '검증하지 못함' : '실패'}, ${duration(b.durationMs)}`, output: b.passed ? '' : b.detail });
        break;
      case 'audit.completed':
        if (verify) verify.audit = { id: b.auditId, previousId: lastAuditId, grade: b.grade ?? null, score: b.score, passed: b.passed, blockers: b.blockers, majors: b.majors, minors: b.minors, ...(b.visionReviewed === undefined ? {} : { visionReviewed: b.visionReviewed }) };
        lastAuditId = b.auditId;
        break;
      case 'steer.queued': {
        closeWork();
        const steer = { kind: 'steer' as const, at: e.at, text: b.text, delivered: false };
        items.push(steer);
        waiting.push(steer);
        break;
      }
      case 'steer.delivered':
        for (const steer of waiting.splice(0)) steer.delivered = true;
        break;
      case 'policy.decision':
        if (b.effect === 'deny') {
          closeWork();
          items.push({ kind: 'denied', at: e.at, reason: b.reason });
        }
        break;
      case 'reflection.completed':
        if (b.lessonsAccepted + b.evalsAdded > 0) items.push({ kind: 'note', at: e.at, text: `이번 작업에서 교훈 ${b.lessonsAccepted}건, 회귀 검사 ${b.evalsAdded}건을 남겼습니다.` });
        break;
      case 'advisor.answered':
        closeWork();
        items.push({ kind: 'advisor', at: e.at, advisor: b.advisor, question: b.question, answer: b.answer, ok: b.ok, durationMs: b.durationMs });
        break;
      default:
        break;
    }
  }
  return items;
}

/** `/ask-codex why …` and `/ask-gemini …` in the composer: a question for another model instead of a task. */
export function advisorCommand(text: string): { advisor: AdvisorId; question: string } | null {
  const match = /^\/ask-(codex|gemini)(?:\s+([\s\S]+))?$/.exec(text.trim());
  if (!match) return null;
  return { advisor: match[1] as AdvisorId, question: (match[2] ?? '').trim() };
}
