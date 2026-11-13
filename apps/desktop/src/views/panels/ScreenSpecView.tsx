import { useEffect, useState } from 'react';
import { ScreenSpec } from '@studio-zero/protocol';
import { useStudio } from '../../lib/studio.tsx';

/** Where a design task leaves its screen spec. */
export const SCREEN_SPEC_FILE = 'docs/screens.json';

/**
 * The project's screen spec as the workspace has it now. `stamp` changes when it may have changed (a task
 * ended). A model wrote the file: it is parsed against the shared shape, and anything else reads as "none".
 */
export function useScreenSpec(projectId: string, stamp: string): ScreenSpec | null {
  const { backend } = useStudio();
  const [spec, setSpec] = useState<ScreenSpec | null>(null);
  useEffect(() => {
    let stale = false;
    backend.call('files.read', { projectId, path: SCREEN_SPEC_FILE }).then(
      (read) => {
        if (stale) return;
        try {
          const parsed = ScreenSpec.safeParse(JSON.parse(read.content));
          setSpec(parsed.success ? parsed.data : null);
        } catch {
          setSpec(null);
        }
      },
      () => !stale && setSpec(null),
    );
    return () => {
      stale = true;
    };
  }, [backend, projectId, stamp]);
  return spec;
}

const cell = 'border-t border-border px-2 py-2 align-top text-sm';

/**
 * A screen spec, read as a screen plan is read: the core flow first, then every screen with how a person
 * arrives, what each thing on it does and under which rule, its other states and its exceptions, and last the
 * events the product records. Every cell is a model's words: text, never markup.
 */
export function ScreenSpecView({ spec }: { spec: ScreenSpec }) {
  const names = new Map(spec.screens.map((s) => [s.id, s.name]));
  return (
    <div className="flex flex-col gap-10 p-6">
      <section className="flex flex-col gap-3">
        <h3 className="text-sm font-semibold text-fg-muted">핵심 장면</h3>
        <p className="text-xl font-semibold">{spec.coreMoment}</p>
        <ol className="flex flex-col">
          {spec.tasks.map((task, i) => (
            <li key={task.id} className="flex max-w-none items-baseline gap-3 border-t border-border py-2 text-base">
              <span className="w-6 shrink-0 font-mono text-sm text-fg-muted">{i + 1}</span>
              <span className="min-w-0 flex-1">
                <span className="font-medium">{task.goal}</span>
                <span className="text-fg-muted"> → {task.outcome}</span>
              </span>
              <span className="shrink-0 font-mono text-sm text-fg-muted">{task.screen}</span>
            </li>
          ))}
        </ol>
      </section>

      {spec.screens.map((screen) => (
        <section key={screen.id} className="flex flex-col gap-3">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="font-mono text-sm font-semibold text-accent">{screen.id}</span>
            <h3 className="text-lg font-semibold">{screen.name}</h3>
            {screen.later ? <span className="text-sm text-fg-muted">첫 버전 이후</span> : null}
          </div>
          <p className="text-base">{screen.purpose}</p>
          <p className="text-sm text-fg-muted">
            진입: {screen.entry.map((from) => (names.has(from) ? `${from} ${names.get(from)}` : from)).join(' · ')}
          </p>
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="text-sm text-fg-muted">
                <th scope="col" className="w-8 px-2 py-1 font-medium">#</th>
                <th scope="col" className="w-1/4 px-2 py-1 font-medium">요소</th>
                <th scope="col" className="px-2 py-1 font-medium">동작 · 규칙</th>
                <th scope="col" className="w-16 px-2 py-1 font-medium">다음</th>
              </tr>
            </thead>
            <tbody>
              {screen.elements.map((element, i) => (
                <tr key={i}>
                  <td className={`${cell} font-mono text-fg-muted`}>{i + 1}</td>
                  <td className={`${cell} font-medium`}>{element.name}</td>
                  <td className={cell}>{element.rule}</td>
                  <td className={`${cell} font-mono text-fg-muted`}>{element.goesTo ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {screen.states.length > 0 ? (
            <dl className="flex flex-col">
              <dt className="text-sm font-semibold text-fg-muted">상태</dt>
              {screen.states.map((state, i) => (
                <dd key={i} className="border-t border-border py-2 text-sm">
                  <span className="font-medium">{state.name}</span>
                  <span className="text-fg-muted"> {state.shows}</span>
                </dd>
              ))}
            </dl>
          ) : null}
          {screen.exceptions.length > 0 ? (
            <dl className="flex flex-col">
              <dt className="text-sm font-semibold text-fg-muted">예외</dt>
              {screen.exceptions.map((exception, i) => (
                <dd key={i} className="border-t border-border py-2 text-sm">
                  {exception}
                </dd>
              ))}
            </dl>
          ) : null}
        </section>
      ))}

      {spec.events.length > 0 ? (
        <section className="flex flex-col gap-3">
          <h3 className="text-lg font-semibold">측정 이벤트</h3>
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="text-sm text-fg-muted">
                <th scope="col" className="w-1/4 px-2 py-1 font-medium">이벤트</th>
                <th scope="col" className="px-2 py-1 font-medium">언제</th>
                <th scope="col" className="w-1/3 px-2 py-1 font-medium">재는 것</th>
              </tr>
            </thead>
            <tbody>
              {spec.events.map((event) => (
                <tr key={event.name}>
                  <td className={`${cell} font-mono`}>{event.name}</td>
                  <td className={cell}>{event.when}</td>
                  <td className={cell}>{event.measures}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}
    </div>
  );
}
