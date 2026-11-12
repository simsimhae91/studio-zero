import type { AdvisorId, EventEnvelope } from '@studio-zero/protocol';
import { duration, evalLabel } from './format.ts';

export type StepKind = 'plan' | 'scaffold' | 'install' | 'write' | 'read' | 'check' | 'run' | 'tool' | 'verify';
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
  audit: { score: number; passed: boolean; blockers: number; majors: number; minors: number; /** False: no design reviewer saw the screens. Undefined on audits recorded before that was tracked. */ visionReviewed?: boolean } | null;
}

export type Item =
  | { kind: 'steps'; at: number; steps: Step[] }
  | { kind: 'said'; at: number; text: string }
  | { kind: 'steer'; at: number; text: string; delivered: boolean }
  | { kind: 'denied'; at: number; reason: string }
  | { kind: 'note'; at: number; text: string }
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
    text: c.tool === 'bash' ? c.input : `${c.tool} ${c.input}`,
    mono: true,
    tone: c.ok === false ? 'bad' : 'plain',
    meta: c.ok === null ? '실행 중' : `${c.ok ? '완료' : `실패${c.exitCode === null ? '' : `, 종료 코드 ${c.exitCode}`}`}${c.ms === null ? '' : `, ${duration(c.ms)}`}`,
    output: c.ok === false ? c.preview : '',
  }));
}

const gateLabel = { compiler: '컴파일', smoke: '스모크 테스트' } as const;

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
        const call: Call = { id: b.callId, tool: b.tool, input: b.input, ok: null, exitCode: null, ms: null, preview: '' };
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
      case 'gate.result':
        verify?.lines.push({ text: gateLabel[b.gate], mono: false, tone: b.passed ? 'good' : 'bad', meta: `${b.passed ? '통과' : `실패${b.exitCode === null ? '' : `, 종료 코드 ${b.exitCode}`}`}, ${duration(b.durationMs)}`, output: b.passed ? '' : b.detail });
        break;
      case 'eval.result':
        verify?.lines.push({ text: evalLabel(b.name), mono: false, tone: b.passed ? 'good' : b.unverified ? 'warn' : 'bad', meta: `${b.passed ? '통과' : b.unverified ? '검증하지 못함' : '실패'}, ${duration(b.durationMs)}`, output: b.passed ? '' : b.detail });
        break;
      case 'audit.completed':
        if (verify) verify.audit = { score: b.score, passed: b.passed, blockers: b.blockers, majors: b.majors, minors: b.minors, ...(b.visionReviewed === undefined ? {} : { visionReviewed: b.visionReviewed }) };
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
