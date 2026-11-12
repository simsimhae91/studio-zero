import { Check, ChevronDown, LoaderCircle, ScanEye, X } from 'lucide-react';
import { useState } from 'react';
import type { Step } from '../lib/steps.ts';
import { Button } from '../ui.tsx';

const stateWord = { done: '완료', active: '진행 중', failed: '실패' } as const;
/** Steps whose subject is a sentence, not a command or a path. */
const WORDED: ReadonlySet<Step['kind']> = new Set(['verify', 'anchor', 'review', 'reference']);

function Mark({ state }: { state: Step['state'] }) {
  return (
    <span className="flex size-5 shrink-0 items-center justify-center">
      {state === 'done' ? <Check className="size-4 text-success" aria-hidden /> : state === 'failed' ? <X className="size-4 text-danger" aria-hidden /> : <LoaderCircle className="size-4 animate-spin text-accent" aria-hidden />}
      <span className="sr-only">{stateWord[state]}</span>
    </span>
  );
}

/**
 * What the agent did, as a list someone can read in a glance: one row per unit of work, a mark for how it went,
 * and the detail (every command, every check's output) one click away. It replaces the wall of narration: the
 * rows are derived from what actually ran, not from what a model said it would do.
 */
export function ActionStepper({ steps, onAudit }: { steps: readonly Step[]; onAudit: () => void }) {
  return (
    <ol className="flex flex-col rounded-lg border border-border bg-surface" aria-label="작업 단계">
      {steps.map((step, i) => (
        <StepRow key={`${i}:${step.kind}`} step={step} onAudit={onAudit} />
      ))}
    </ol>
  );
}

function StepRow({ step, onAudit }: { step: Step; onAudit: () => void }) {
  // Something that failed is what the reader came for; everything else stays folded.
  const [open, setOpen] = useState(step.state === 'failed');
  const expandable = step.lines.length > 0 || step.notes.length > 0 || step.audit !== null || step.kind === 'plan';
  const prose = step.kind === 'plan';
  return (
    <li className="flex max-w-none flex-col border-b border-border last:border-b-0">
      <button type="button" disabled={!expandable} onClick={() => setOpen(!open)} aria-expanded={expandable ? open : undefined} className="flex min-h-11 w-full items-center gap-3 px-3 py-2 text-left disabled:cursor-default">
        <Mark state={step.state} />
        <span className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-3">
          <span className={`text-sm font-medium ${step.state === 'failed' ? 'text-danger' : 'text-fg'}`}>{step.title}</span>
          {step.detail && !prose ? <span className={`line-clamp-1 min-w-0 break-all text-sm text-fg-muted ${WORDED.has(step.kind) ? '' : 'font-mono'}`}>{step.detail}</span> : null}
        </span>
        {expandable ? <ChevronDown className={`size-4 shrink-0 text-fg-muted ${open ? 'rotate-180' : ''}`} aria-hidden /> : null}
      </button>
      {open ? (
        <div className="flex flex-col gap-3 border-t border-border bg-bg px-3 py-3 pl-11">
          {prose && step.detail ? <p className="text-base">{step.detail}</p> : null}
          {step.notes.map((note, i) => (
            <p key={i} className="whitespace-pre-wrap break-words text-base text-fg-muted">
              {note}
            </p>
          ))}
          {step.lines.length > 0 ? (
            <ol className={`flex flex-col gap-2 ${prose ? 'list-decimal pl-5' : ''}`}>
              {step.lines.map((line, i) => (
                <li key={i} className="flex max-w-none flex-col gap-1">
                  <span className="flex flex-wrap items-baseline justify-between gap-x-4">
                    <span className={`min-w-0 break-words ${line.mono ? 'font-mono text-sm' : 'text-base'} ${line.tone === 'bad' ? 'text-danger' : 'text-fg'}`}>{line.text}</span>
                    {line.meta ? <span className={`shrink-0 text-sm ${line.tone === 'bad' ? 'font-medium text-danger' : line.tone === 'warn' ? 'font-medium text-warning' : line.tone === 'good' ? 'text-success' : 'text-fg-muted'}`}>{line.meta}</span> : null}
                  </span>
                  {/* Sandbox and page output is untrusted: it is only ever a text node. */}
                  {line.output ? <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-sunken p-3 font-mono text-sm">{line.output}</pre> : null}
                </li>
              ))}
            </ol>
          ) : null}
          {step.audit ? (
            <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
              <p className="text-base">
                시각 감사 {step.audit.score.toFixed(0)}점, {step.audit.visionReviewed === false ? '디자인 심사가 실행되지 않아 디자인은 보증되지 않습니다' : step.audit.passed ? '기준을 넘었습니다' : '기준에 못 미쳤습니다'}. 블로커 {step.audit.blockers}건, 주요 {step.audit.majors}건, 사소 {step.audit.minors}건
              </p>
              <Button onClick={onAudit} icon={<ScanEye className="size-4" aria-hidden />}>
                증거 보기
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}
