import { ChevronDown } from 'lucide-react';
import { useState } from 'react';
import type { Effort, EngineModel, EnginePref } from '@studio-zero/protocol';
import { rememberedFor, resolveChoice, type Work } from '../lib/engineChoice.ts';
import { effortLabel, engineLabel } from '../lib/format.ts';
import { setPrefs, usePrefs } from '../lib/prefs.ts';
import { useQuery } from '../lib/studio.tsx';
import { Menu, MenuItem, inputClass } from '../ui.tsx';

/** The menus beside a request: what runs the next task, and who checks it. */
export const pickerClass = 'inline-flex min-h-9 pointer-coarse:min-h-11 items-center gap-1 rounded-md px-3 text-sm font-medium text-fg-muted hover:bg-sunken hover:text-fg';

export interface EngineChoice {
  /** The kind of work this choice is for: its level is remembered apart from the other's. */
  work: Work;
  /** The engines that can run a task now. */
  engines: readonly { id: EnginePref; label: string }[];
  engine: EnginePref | null;
  model: string | null;
  modelLabel: string | null;
  effort: Effort | null;
  /** The chosen engine's models, as its vendor lists them. Empty until they have been read. */
  models: readonly EngineModel[];
  /** The levels the chosen engine takes as a setting. Empty where its model names carry the level, and until they have been read. */
  efforts: readonly Effort[];
  /** False until the daemon has said what the chosen engine offers. */
  listed: boolean;
  pickEngine: (id: EnginePref | null) => void;
  pickModel: (id: string | null) => void;
  pickEffort: (level: Effort | null) => void;
  /** What a request carries for this choice: nothing when it is left to the studio. */
  fields: { engine?: EnginePref; model?: string; effort?: Effort };
}

/**
 * Who runs the next task: an engine, the model on it, and how hard it is asked to think. One choice for the whole app, and it is remembered:
 * what a project's first task was started with on the first page is what its composer shows afterwards, and
 * what the app opens with next time. The level alone is remembered twice, once for design work and once for
 * builds: `work` says which this is.
 */
export function useEngineChoice(work: Work = 'build'): EngineChoice {
  const prefs = usePrefs();
  const status = useQuery('system.status', {});
  const listedEngines = status.data?.engines;
  // The engine as far as it is known before what it offers is: that is asked for by engine.
  const { engine } = resolveChoice({ engine: prefs.engine, model: 'default', effort: 'default' }, listedEngines, undefined);
  const catalog = useQuery('engines.models', engine === null ? null : { engine });
  const choice = resolveChoice(rememberedFor(prefs, work), listedEngines, catalog.data);
  return {
    work,
    engines: (listedEngines ?? []).filter((e) => e.available).map((e) => ({ id: e.id as EnginePref, label: engineLabel[e.id] ?? e.id })),
    ...choice,
    models: catalog.data?.models ?? [],
    efforts: catalog.data?.efforts ?? [],
    listed: catalog.data !== undefined,
    // A model belongs to its engine: changing the engine leaves the new one on its usual model. The level is
    // the same scale everywhere and is about the work, so it stays.
    pickEngine: (id) => setPrefs({ engine: id ?? 'auto', model: 'default' }),
    pickModel: (id) => setPrefs({ model: id ?? 'default' }),
    pickEffort: (level) => setPrefs(work === 'design' ? { designEffort: level ?? 'default' } : { effort: level ?? 'default' }),
    fields: choice.engine === null ? {} : { engine: choice.engine, ...(choice.model === null ? {} : { model: choice.model }), ...(choice.effort === null ? {} : { effort: choice.effort }) },
  };
}

/** The menus: engine, then what that engine offers. Nothing is drawn when no engine can be picked: there is then nothing to choose between. */
export function EnginePicker({ choice }: { choice: EngineChoice }) {
  if (choice.engines.length === 0 && choice.engine === null) return null;
  return (
    <>
      <Menu
        align="start"
        trigger={
          <button type="button" title="고르지 않으면 작업 종류에 맞는 엔진이 맡습니다" className={pickerClass}>
            엔진: {choice.engine ? (engineLabel[choice.engine] ?? choice.engine) : '자동'}
            <ChevronDown className="size-4" aria-hidden />
          </button>
        }
      >
        <MenuItem onSelect={() => choice.pickEngine(null)}>자동</MenuItem>
        {choice.engines.map((e) => (
          <MenuItem key={e.id} onSelect={() => choice.pickEngine(e.id)}>
            {e.label}
          </MenuItem>
        ))}
      </Menu>
      {choice.engine === null ? null : choice.models.length > 0 ? (
        <ModelMenu models={choice.models} label={choice.modelLabel} onPick={choice.pickModel} />
      ) : choice.modelLabel ? (
        // The list has not arrived yet; the remembered pick still stands, and says so.
        <span className="px-3 text-sm font-medium text-fg-muted">모델: {choice.modelLabel}</span>
      ) : null}
      {choice.engine === null ? null : choice.efforts.length > 0 ? (
        <Menu
          align="start"
          trigger={
            <button type="button" title={`얼마나 깊이 생각하게 할지. ${choice.work === 'design' ? '설계 작업의 강도는 구현과 따로 기억합니다.' : '설계 작업의 강도는 따로 정합니다.'} 고르지 않으면 작업 종류에 맞는 강도로 돕니다`} className={pickerClass}>
              {choice.work === 'design' ? '설계 추론 강도' : '추론 강도'}: {choice.effort ? effortLabel[choice.effort] : '기본'}
              <ChevronDown className="size-4" aria-hidden />
            </button>
          }
        >
          <MenuItem onSelect={() => choice.pickEffort(null)}>기본</MenuItem>
          {choice.efforts.map((level) => (
            <MenuItem key={level} onSelect={() => choice.pickEffort(level)}>
              {effortLabel[level]} <span className="text-fg-muted">{level}</span>
            </MenuItem>
          ))}
        </Menu>
      ) : choice.effort && !choice.listed ? (
        <span className="px-3 text-sm font-medium text-fg-muted">
          {choice.work === 'design' ? '설계 추론 강도' : '추론 강도'}: {effortLabel[choice.effort]}
        </span>
      ) : null}
    </>
  );
}

/**
 * The models of the chosen engine. A vendor may list a few or a few hundred, so a long list gets a line to
 * narrow it by: typing stays in the line, Enter takes the first match, the down arrow goes into the list.
 */
function ModelMenu({ models, label, onPick }: { models: readonly EngineModel[]; label: string | null; onPick: (id: string | null) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const shown = words.length === 0 ? models : models.filter((m) => words.every((w) => `${m.label} ${m.id}`.toLowerCase().includes(w)));
  const toggle = (next: boolean): void => {
    setOpen(next);
    if (!next) setQuery('');
  };
  const pick = (id: string | null): void => {
    onPick(id);
    toggle(false);
  };
  return (
    <Menu
      align="start"
      open={open}
      onOpenChange={toggle}
      trigger={
        <button type="button" title="고르지 않으면 이 엔진이 평소 쓰는 모델로 돕니다" className={pickerClass}>
          모델: {label ?? '기본'}
          <ChevronDown className="size-4" aria-hidden />
        </button>
      }
    >
      {models.length > 10 ? (
        <input
          autoFocus
          aria-label="모델 찾기"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape' || e.key === 'Tab') return;
            // Anything typed here is the search: the menu must not read it as a jump to an entry.
            e.stopPropagation();
            if (e.key === 'Enter' && words.length > 0 && shown[0]) pick(shown[0].id);
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              e.currentTarget.closest('[role="menu"]')?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
            }
          }}
          placeholder={`모델 ${models.length}개 중에서 찾기`}
          autoCapitalize="none"
          spellCheck={false}
          className={`${inputClass} sticky top-0 z-10 mb-1 shrink-0 text-sm`}
        />
      ) : null}
      {words.length === 0 ? <MenuItem onSelect={() => pick(null)}>기본</MenuItem> : null}
      {shown.map((m) => (
        <MenuItem key={m.id} onSelect={() => pick(m.id)}>
          {m.label}
        </MenuItem>
      ))}
      {shown.length === 0 ? <p className="px-3 py-3 text-sm text-fg-muted">맞는 모델이 없습니다.</p> : null}
    </Menu>
  );
}

/**
 * The two remembered levels side by side, for the settings page: what a design task runs at and what a build
 * runs at. The same two values the menus beside a request show and change.
 */
export function EffortDefaults() {
  const design = useEngineChoice('design');
  const build = useEngineChoice('build');
  if (design.engine === null) return <p className="text-base text-fg-muted">엔진이 자동이면 추론 강도도 작업 종류에 맞게 정해집니다. 작업을 시작하는 자리에서 엔진을 고르면 여기서 설계와 구현의 강도를 따로 정할 수 있습니다.</p>;
  if (design.efforts.length === 0) return <p className="text-base text-fg-muted">{design.listed ? `${engineLabel[design.engine] ?? design.engine}은 추론 강도를 따로 받지 않습니다. 강도는 모델 이름에 들어 있습니다.` : '엔진이 받는 강도를 확인하는 중입니다.'}</p>;
  const row = (choice: EngineChoice, label: string, note: string) => (
    <li className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-t border-border py-3">
      <div className="flex min-w-0 flex-col gap-1">
        <span className="text-base font-medium">{label}</span>
        <span className="text-base text-fg-muted">{note}</span>
      </div>
      <Menu
        align="end"
        trigger={
          <button type="button" aria-label={`${label} 추론 강도`} className={`${pickerClass} border border-control-border`}>
            {choice.effort ? effortLabel[choice.effort] : '기본'}
            <ChevronDown className="size-4" aria-hidden />
          </button>
        }
      >
        <MenuItem onSelect={() => choice.pickEffort(null)}>기본</MenuItem>
        {choice.efforts.map((level) => (
          <MenuItem key={level} onSelect={() => choice.pickEffort(level)}>
            {effortLabel[level]} <span className="text-fg-muted">{level}</span>
          </MenuItem>
        ))}
      </Menu>
    </li>
  );
  return (
    <ul className="flex flex-col">
      {row(design, '설계 작업', '"설계부터"로 시작한 문서와 시안, 시안을 고쳐 달라는 요청')}
      {row(build, '구현 작업', '바로 만들기, 검증까지 가는 빌드, 고쳐 달라는 요청')}
    </ul>
  );
}
