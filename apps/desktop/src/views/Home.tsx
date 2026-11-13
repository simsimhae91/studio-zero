import { useId, useState, type FormEvent } from 'react';
import type { Project, Scratchpad, Template } from '@studio-zero/protocol';
import { ago, creatableTemplates, templateLabel } from '../lib/format.ts';
import { useAction, useStudio } from '../lib/studio.tsx';
import { Button, Problem, Segmented, TitlebarSpace } from '../ui.tsx';
import { EnginePicker, useEngineChoice } from './enginePicker.tsx';
import { scratchState, type Route } from './Shell.tsx';

type Mode = 'fast' | 'deep' | 'think' | 'research' | 'document';
const MODES: readonly { id: Mode; label: string; does: string; start: string }[] = [
  { id: 'fast', label: '바로 만들기', does: '질문 없이 시작합니다. 비어 있는 결정은 검증된 기본값으로 채우고, 돌아가는 초안을 먼저 띄운 뒤 화면을 보며 고칩니다.', start: '만들기 시작' },
  { id: 'deep', label: '설계부터', does: '요구사항(PRD), 데이터 모델, API 명세를 문서로 먼저 쓰고, 승인하면 그 문서대로 구현합니다. 판이 크거나 모호할 때 고릅니다.', start: '설계 시작' },
  { id: 'think', label: '생각 정리', does: '질문을 주고받으며 기획 명세와 결정 기록을 만듭니다. 컨테이너는 켜지 않습니다.', start: '정리 시작' },
  { id: 'research', label: '조사', does: '웹에서 근거를 모으고, 실제로 확인된 출처가 달린 브리핑으로 돌려드립니다.', start: '조사 시작' },
  { id: 'document', label: '문서', does: '적어 주신 내용으로 보고서를 쓰고, 문장 검사를 통과할 때까지 고칩니다.', start: '문서 쓰기' },
];
type Stack = Template | 'auto';
const STACKS: readonly { id: Stack; label: string }[] = [{ id: 'auto', label: '알아서' }, ...creatableTemplates];

/**
 * A blank sheet. Whatever is written on it becomes work; the mode decides what the studio does with it first.
 * The default is to build: an idea goes straight to a named project and a first draft, with nothing asked.
 */
export function Home({ scratchpads, projects, onOpen, onCreated }: { scratchpads: Scratchpad[]; projects: Project[]; onOpen: (route: Route) => void; onCreated: () => void }) {
  const { backend } = useStudio();
  const id = useId();
  const [text, setText] = useState('');
  const [mode, setMode] = useState<Mode>('fast');
  const [stack, setStack] = useState<Stack>('auto');
  const current = MODES.find((m) => m.id === mode)!;
  const builds = mode === 'fast' || mode === 'deep';
  // The first task of a project is usually its largest: who runs it is chosen here, not one task later.
  // A design task and a build each remember their own level: the menu follows what is about to be started.
  const choice = useEngineChoice(mode === 'deep' ? 'design' : 'build');

  const start = useAction(async () => {
    const opening = text.trim();
    if (mode === 'fast' || mode === 'deep') {
      // The daemon names the project from the idea, picks the stack unless one was chosen here, and starts the first task.
      const { project } = await backend.call('projects.ignite', { idea: opening, track: mode, ...(stack === 'auto' ? {} : { template: stack }), ...choice.fields });
      onCreated();
      return onOpen({ kind: 'project', id: project.id });
    }
    const pad = await backend.call('scratch.create', { opening, mode });
    onCreated();
    onOpen({ kind: 'scratch', id: pad.id });
  });
  const submit = (e: FormEvent): void => {
    e.preventDefault();
    if (text.trim() !== '') void start.run();
  };
  const recent = [
    ...scratchpads.map((p) => ({ key: p.id, title: p.title, meta: scratchState[p.state], at: p.updatedAt, route: { kind: 'scratch', id: p.id } as Route })),
    ...projects.map((p) => ({ key: p.id, title: p.name, meta: templateLabel[p.template], at: p.createdAt, route: { kind: 'project', id: p.id } as Route })),
  ]
    .sort((a, b) => b.at - a.at)
    .slice(0, 6);

  return (
    <div className="pane-scroll min-h-0 flex-1">
      <div className="page flex flex-col">
        <TitlebarSpace />
        <form onSubmit={submit} className="flex flex-col gap-8 px-4 pb-12 pt-10 md:px-10 md:pt-16">
          <div className="flex flex-col gap-6">
            <h1 className="text-4xl font-semibold">
              <label htmlFor={id}>무엇을 만들까요</label>
            </h1>
            <textarea
              id={id}
              autoFocus
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="생각나는 대로 적어 주세요. 한 줄이어도, 한 쪽이어도 됩니다."
              className="sheet-of-paper w-full resize-none rounded-lg border border-control-border bg-bg p-4 text-xl text-fg caret-accent placeholder:text-fg-muted focus:border-accent focus-visible:outline-hidden"
            />
          </div>

          <div role="radiogroup" aria-label="스튜디오가 먼저 할 일" className="flex flex-col border-b border-border">
            {MODES.map((m) => (
              <button key={m.id} type="button" role="radio" aria-checked={mode === m.id} onClick={() => setMode(m.id)} className={`grid min-h-11 items-baseline gap-x-6 gap-y-1 border-l-4 border-t border-t-border px-4 py-3 text-left md:grid-cols-[8rem_minmax(0,1fr)] ${mode === m.id ? 'border-l-accent bg-sunken' : 'border-l-transparent'}`}>
                <span className="text-lg font-semibold">{m.label}</span>
                {/* On a phone only the chosen mode spells out what it does, so the start button stays in reach. */}
                <span className={`text-base text-fg-muted ${mode === m.id ? '' : 'hidden md:block'}`}>{m.does}</span>
              </button>
            ))}
          </div>

          {builds ? (
            <div className="flex flex-col gap-2">
              <span className="text-sm font-medium text-fg-muted">무엇으로 만들지</span>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <Segmented label="무엇으로 만들지" value={stack} options={STACKS} onChange={setStack} />
                <EnginePicker choice={choice} />
              </div>
            </div>
          ) : null}
          {start.error ? <Problem>{start.error}</Problem> : null}
          <Button type="submit" variant="primary" busy={start.busy} disabled={text.trim() === ''} className="self-start">
            {start.busy && builds ? '이름을 짓고 프로젝트를 만드는 중' : current.start}
          </Button>
        </form>

        {recent.length > 0 ? (
          <section className="flex flex-col px-4 pb-16 md:px-10">
            <h2 className="pb-3 text-sm font-medium text-fg-muted">이어서 하기</h2>
            {recent.map((r) => (
              <button key={r.key} type="button" onClick={() => onOpen(r.route)} className="flex min-h-11 flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-t border-border py-3 text-left hover:bg-sunken">
                <span className="text-lg font-medium">{r.title}</span>
                <span className="text-sm text-fg-muted">
                  {r.meta}, {ago(r.at)}
                </span>
              </button>
            ))}
          </section>
        ) : null}
      </div>
    </div>
  );
}
