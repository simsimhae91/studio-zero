import { useEffect, useRef, useState, type ButtonHTMLAttributes, type FormEvent } from 'react';
import type { AxBlock, AxResponse, Confidence } from '../blocks.ts';
import type { Telemetry } from '../telemetry.ts';
import { Flow } from './Flow.tsx';
import { Markdown } from './Markdown.tsx';

/** Every word the renderer shows that did not come from the agent. Override any of them per app or per language. */
export interface AxLabels {
  confidence: Record<Confidence, string>;
  recommended: string;
  decide: string;
  other: string;
  unanswered: string;
  decision: string;
  rejected: string;
  done: string;
  criteria: string;
  yes: string;
  no: string;
  unset: string;
  diagram: string;
}
export const defaultLabels: AxLabels = {
  confidence: { high: '확실', medium: '의견이 갈릴 수 있음', speculative: '추정' },
  recommended: '추천',
  decide: '이걸로 결정',
  other: '덧붙일 말이나 다른 답',
  unanswered: '아직 답하지 않았습니다',
  decision: '결정',
  rejected: '기각',
  done: '완료',
  criteria: '기준',
  yes: '예',
  no: '아니요',
  unset: '미정',
  diagram: '흐름도',
};

const inputClass = 'min-h-11 w-full rounded-md border border-control-border bg-surface px-3 text-base text-fg placeholder:text-fg-muted';
const level: Record<Confidence, number> = { high: 3, medium: 2, speculative: 1 };

function Action({ busy = false, className = '', disabled, children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { busy?: boolean }) {
  return (
    <button {...props} disabled={disabled || busy} aria-busy={busy || undefined} className={`inline-flex min-h-11 min-w-11 items-center justify-center rounded-md bg-accent px-4 text-sm font-medium text-on-accent disabled:cursor-not-allowed disabled:opacity-60 ${className}`}>
      {children}
    </button>
  );
}

function Glyph({ d, label, className }: { d: string; label: string; className: string }) {
  return (
    <svg viewBox="0 0 16 16" role="img" aria-label={label} className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="square">
      <path d={d} />
    </svg>
  );
}

/** How sure the agent says it is: three bars and the word. The bars are the glance, the word is the meaning. */
export function ConfidenceMark({ confidence, labels = defaultLabels }: { confidence: Confidence; labels?: AxLabels }) {
  return (
    <span className="inline-flex items-center gap-2 text-sm text-fg-muted">
      <span className="flex items-end gap-1" aria-hidden>
        {[1, 2, 3].map((n) => (
          <span key={n} className={`w-1 ${n === 1 ? 'h-2' : n === 2 ? 'h-3' : 'h-4'} ${n <= level[confidence] ? 'bg-accent' : 'bg-border'}`} />
        ))}
      </span>
      {labels.confidence[confidence]}
    </span>
  );
}

type Answer = Extract<AxResponse, { kind: 'choice' }> | Extract<AxResponse, { kind: 'form' }>;

export interface BlockProps {
  block: AxBlock;
  /** The person's earlier answer to this block, if any. */
  answer?: Answer;
  /** Present when the block can still be answered. Resolves to whether the answer was accepted. */
  onRespond?: (response: AxResponse) => Promise<boolean>;
  labels?: Partial<AxLabels>;
  telemetry?: Telemetry;
}
type Inner<T extends AxBlock['type']> = Omit<BlockProps, 'block' | 'labels'> & { block: Extract<AxBlock, { type: T }>; labels: AxLabels };

/**
 * A2UI: renders one typed block an agent chose. The agent supplies data; every pixel is this component's.
 * It is styled with the Studio Zero theme tokens (bg-surface, text-fg-muted, border-accent, …), so it takes on
 * the palette of whatever project it is in.
 */
export function Block({ block, answer, onRespond, labels: overrides, telemetry }: BlockProps) {
  const labels = overrides ? { ...defaultLabels, ...overrides } : defaultLabels;
  const shownAt = useRef(0);
  const confidence = 'confidence' in block ? block.confidence : null;
  useEffect(() => {
    shownAt.current = performance.now();
    telemetry?.track({ name: 'block.shown', block: block.type, confidence });
    // Reported once per block shown, not on every re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const respond =
    onRespond &&
    (async (response: AxResponse): Promise<boolean> => {
      const accepted = await onRespond(response);
      if (accepted && (block.type === 'choice' || block.type === 'form')) {
        const followed = block.type === 'choice' && response.kind === 'choice' && block.recommended !== null ? response.optionId === block.recommended : null;
        telemetry?.track({ name: 'block.answered', block: block.type, confidence, followedRecommendation: followed, ms: Math.round(performance.now() - shownAt.current) });
      }
      return accepted;
    });

  switch (block.type) {
    case 'text':
      return <Markdown source={block.markdown} />;
    case 'choice':
      return <Choice block={block} answer={answer} onRespond={respond} labels={labels} />;
    case 'comparison':
      return <Comparison block={block} labels={labels} />;
    case 'form':
      return <Form block={block} answer={answer} onRespond={respond} labels={labels} />;
    case 'diagram':
      return (
        <figure className="flex flex-col gap-3">
          <Flow source={block.mermaid} label={labels.diagram} />
          <figcaption className="text-sm text-fg-muted">{block.title}</figcaption>
        </figure>
      );
    case 'decision':
      return (
        <section className="flex flex-col gap-3 border-l-4 border-accent pl-5">
          <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1">
            <p className="text-sm font-medium text-accent">{labels.decision}</p>
            <ConfidenceMark confidence={block.confidence} labels={labels} />
          </div>
          <p className="text-base text-fg-muted">{block.question}</p>
          <p className="text-2xl font-semibold">{block.chosen}</p>
          <p className="text-lg">{block.why}</p>
          {block.rejected.length > 0 ? (
            <ul className="flex flex-col gap-2">
              {block.rejected.map((r) => (
                <li key={r.option} className="flex items-start gap-3 text-base text-fg-muted">
                  <Glyph d="M3 3l10 10M13 3L3 13" label={labels.rejected} className="mt-1 size-4 shrink-0" />
                  <span>
                    <span className="font-medium text-fg">{r.option}</span> {r.why}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      );
    case 'sources':
      return (
        <section className="flex flex-col gap-3">
          <h4 className="text-xl font-semibold">{block.title}</h4>
          <ol className="flex flex-col">
            {block.items.map((s, i) => (
              <li key={s.url} className="flex gap-4 border-t border-border py-3">
                <span className="w-6 shrink-0 text-base font-medium text-accent">{i + 1}</span>
                <span className="flex min-w-0 flex-col gap-1">
                  <a href={s.url} target="_blank" rel="noreferrer" className="break-words text-base font-medium underline underline-offset-4">
                    {s.title}
                  </a>
                  <span className="break-all text-sm text-fg-muted">{hostOf(s.url)}</span>
                  {s.quote ? <span className="text-base text-fg-muted">“{s.quote}”</span> : null}
                </span>
              </li>
            ))}
          </ol>
        </section>
      );
    case 'checklist':
      return (
        <section className="flex flex-col gap-3">
          <h4 className="text-xl font-semibold">{block.title}</h4>
          <ul className="flex flex-col gap-2">
            {block.items.map((item) => (
              <li key={item.label} className="flex items-start gap-3 text-lg">
                <span className={`mt-1 flex size-5 shrink-0 items-center justify-center border ${item.done ? 'border-accent bg-accent text-on-accent' : 'border-control-border'}`}>{item.done ? <Glyph d="M3 8.5l3.5 3.5L13 4.5" label={labels.done} className="size-4" /> : null}</span>
                <span className={item.done ? 'text-fg-muted' : ''}>{item.label}</span>
              </li>
            ))}
          </ul>
        </section>
      );
  }
}

const hostOf = (url: string): string => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
};

function Choice({ block, answer, onRespond, labels }: Inner<'choice'>) {
  const given = answer?.kind === 'choice' ? answer : undefined;
  const [picked, setPicked] = useState<string | null>(block.recommended);
  const [other, setOther] = useState('');
  const [busy, setBusy] = useState(false);

  if (given || !onRespond) {
    const option = block.options.find((o) => o.id === given?.optionId);
    return (
      <section className="flex flex-col gap-1">
        <p className="text-base text-fg-muted">{block.question}</p>
        <p className="border-l-4 border-accent pl-5 text-lg font-medium">{given ? [option?.label, given.other].filter(Boolean).join(', ') : labels.unanswered}</p>
      </section>
    );
  }
  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setBusy(true);
    await onRespond({ kind: 'choice', blockId: block.id, optionId: picked, other: other.trim() || null });
    setBusy(false);
  };
  return (
    <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <h4 className="text-2xl font-semibold">{block.question}</h4>
        <ConfidenceMark confidence={block.confidence} labels={labels} />
      </div>
      <div role="radiogroup" aria-label={block.question} className="flex flex-col border-b border-border">
        {block.options.map((option) => {
          const selected = picked === option.id;
          return (
            <button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => setPicked(option.id)}
              className={`flex min-h-11 items-start gap-4 border-l-4 border-t border-t-border px-4 py-4 text-left ${selected ? 'border-l-accent bg-sunken' : 'border-l-transparent'}`}
            >
              <span className={`mt-1 flex size-5 shrink-0 items-center justify-center rounded-full border ${selected ? 'border-accent' : 'border-control-border'}`}>{selected ? <span className="size-3 rounded-full bg-accent" /> : null}</span>
              <span className="flex min-w-0 flex-col gap-1">
                <span className="flex flex-wrap items-center gap-x-3 text-lg font-medium">
                  {option.label}
                  {block.recommended === option.id ? <span className="text-sm font-medium text-accent">{labels.recommended}</span> : null}
                </span>
                {option.detail ? <span className="text-base text-fg-muted">{option.detail}</span> : null}
              </span>
            </button>
          );
        })}
      </div>
      {block.allowOther ? (
        <label className="flex flex-col gap-2">
          <span className="text-sm text-fg-muted">{labels.other}</span>
          <input className={inputClass} value={other} onChange={(e) => setOther(e.target.value)} />
        </label>
      ) : null}
      <Action type="submit" busy={busy} disabled={picked === null && other.trim() === ''} className="self-start">
        {labels.decide}
      </Action>
    </form>
  );
}

function Comparison({ block, labels }: Pick<Inner<'comparison'>, 'block' | 'labels'>) {
  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <h4 className="text-2xl font-semibold">{block.title}</h4>
        {block.recommended ? <ConfidenceMark confidence={block.confidence} labels={labels} /> : null}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left text-base">
          <thead>
            <tr>
              <th scope="col" className="border-b-2 border-fg px-3 py-2 font-medium text-fg-muted">
                <span className="sr-only">{labels.criteria}</span>
              </th>
              {block.options.map((o) => (
                <th key={o.label} scope="col" className={`border-b-2 px-3 py-2 align-bottom font-semibold ${o.label === block.recommended ? 'border-accent' : 'border-fg'}`}>
                  {o.label}
                  {o.label === block.recommended ? <span className="block text-sm font-medium text-accent">{labels.recommended}</span> : null}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.criteria.map((criterion, row) => (
              <tr key={criterion}>
                <th scope="row" className="border-b border-border px-3 py-3 align-top font-medium text-fg-muted">
                  {criterion}
                </th>
                {block.options.map((o) => (
                  <td key={o.label} className={`border-b border-border px-3 py-3 align-top ${o.label === block.recommended ? 'bg-sunken' : ''}`}>
                    {o.cells[row]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Form({ block, answer, onRespond, labels }: Inner<'form'>) {
  const given = answer?.kind === 'form' ? answer : undefined;
  const [values, setValues] = useState<Record<string, string | number | boolean>>(() => Object.fromEntries(block.fields.map((f) => [f.id, f.value ?? (f.kind === 'toggle' ? false : f.kind === 'number' || f.kind === 'range' ? (f.min ?? 0) : (f.options?.[0] ?? ''))])));
  const [busy, setBusy] = useState(false);
  const set = (id: string, value: string | number | boolean): void => setValues((v) => ({ ...v, [id]: value }));

  if (given || !onRespond) {
    return (
      <section className="flex flex-col gap-2">
        <p className="text-base text-fg-muted">{block.title}</p>
        <dl className="flex flex-col">
          {block.fields.map((f) => (
            <div key={f.id} className="flex flex-wrap justify-between gap-x-6 border-t border-border py-2">
              <dt className="text-base text-fg-muted">{f.label}</dt>
              <dd className="text-base font-medium">{String(given?.values[f.id] ?? labels.unset)}</dd>
            </div>
          ))}
        </dl>
      </section>
    );
  }
  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setBusy(true);
    await onRespond({ kind: 'form', blockId: block.id, values });
    setBusy(false);
  };
  const chip = (on: boolean): string => `min-h-11 rounded-md border px-4 text-sm font-medium ${on ? 'border-accent text-accent' : 'border-control-border text-fg-muted'}`;
  return (
    <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-6">
      <h4 className="text-2xl font-semibold">{block.title}</h4>
      {block.fields.map((f) => (
        <label key={f.id} className="flex flex-col gap-2">
          <span className="flex items-baseline justify-between gap-4 text-base font-medium">
            {f.label}
            {f.kind === 'range' ? <span className="text-lg font-semibold text-accent">{String(values[f.id])}</span> : null}
          </span>
          {f.kind === 'range' ? (
            <input type="range" className="min-h-11 w-full accent-accent" min={f.min ?? 0} max={f.max ?? 100} step={f.step ?? 1} value={Number(values[f.id])} onChange={(e) => set(f.id, Number(e.target.value))} />
          ) : f.kind === 'toggle' ? (
            <button type="button" role="switch" aria-checked={values[f.id] === true} onClick={() => set(f.id, values[f.id] !== true)} className={`self-start ${chip(values[f.id] === true)}`}>
              {values[f.id] === true ? labels.yes : labels.no}
            </button>
          ) : f.kind === 'select' ? (
            <span role="radiogroup" aria-label={f.label} className="flex flex-wrap gap-2">
              {(f.options ?? []).map((o) => (
                <button key={o} type="button" role="radio" aria-checked={values[f.id] === o} onClick={() => set(f.id, o)} className={chip(values[f.id] === o)}>
                  {o}
                </button>
              ))}
            </span>
          ) : (
            <input className={inputClass} type={f.kind === 'number' ? 'number' : 'text'} min={f.min ?? undefined} max={f.max ?? undefined} value={String(values[f.id])} onChange={(e) => set(f.id, f.kind === 'number' ? Number(e.target.value) : e.target.value)} />
          )}
        </label>
      ))}
      <Action type="submit" busy={busy} className="self-start">
        {block.submitLabel}
      </Action>
    </form>
  );
}
