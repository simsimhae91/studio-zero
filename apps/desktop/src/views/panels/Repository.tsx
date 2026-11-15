import { Check, Copy, FolderGit2, Ruler } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import type { EventEnvelope, Project, RepoStatus, Task } from '@studio-zero/protocol';
import { ago, stamp, taskStateLabel } from '../../lib/format.ts';
import { receivedLine } from '../../lib/steps.ts';
import { useAction, useQuery, useStudio } from '../../lib/studio.tsx';
import { Button, IconButton, Problem, Status } from '../../ui.tsx';

/** The studio's integration branch: every project's, whatever the branch it was brought in from was called. */
const INTEGRATION_BRANCH = 'main';
/** What a fit is asked for: the owner's words, the same every time. What it does is the daemon's brief. */
const FIT_PROMPT = '이 제품을 스튜디오가 걷고 잴 수 있게 맞춘다.';
const finished = (state: Task['state']): boolean => state === 'succeeded' || state === 'failed' || state === 'cancelled';
/** A path as a shell reads it, quoted only when it has to be: the daemon writes its clone command the same way. */
const quoted = (path: string): string => (/^[\w@%+=:,./-]+$/.test(path) ? path : `'${path.replaceAll("'", `'\\''`)}'`);

/**
 * What the daemon said when a checkout was brought in from this window, by project: shown once on the project's
 * page, where the owner lands. Kept while the window is open, like a draft.
 */
export const arrivals = new Map<string, readonly string[]>();

/**
 * What the owner pushed to a project's repository and the studio took, as this window saw it arrive, newest
 * first. The daemon's event history reads oldest first, so what came before the window opened is told by the
 * branches themselves, not here. Kept per project while the window is open.
 */
const received = new Map<string, EventEnvelope[]>();

export function useReceived(projectId: string | null): readonly EventEnvelope[] {
  const { backend } = useStudio();
  const [list, setList] = useState<readonly EventEnvelope[]>(() => (projectId === null ? [] : (received.get(projectId) ?? [])));
  useEffect(() => {
    if (projectId === null) return;
    setList(received.get(projectId) ?? []);
    return backend.subscribe(
      { projectId },
      (e) => {
        const kept = received.get(projectId) ?? [];
        if (e.body.type !== 'repo.received' || kept.some((k) => k.seq === e.seq)) return;
        const next = [e, ...kept].slice(0, 40);
        received.set(projectId, next);
        setList(next);
      },
      'now',
    );
  }, [backend, projectId]);
  return list;
}

/**
 * The project's repository on this Mac: a git repository that mirrors the project's branches, for the owner's own
 * tools to clone from and push to. Until the owner opens it, nothing of the project is on this Mac's disk. A
 * product that was brought in and has no walking plan yet is told so first, with the task that writes one.
 */
export function Repository({ project, received, fit, onFit, onTask }: { project: Project; received: readonly EventEnvelope[]; fit: Task | null; onFit: (task: Task) => void; onTask: (taskId: string) => void }) {
  const { backend, onEvent } = useStudio();
  const status = useQuery('repo.status', { projectId: project.id });
  const { reload } = status;
  // Read again when this project's branches may have moved: the owner pushed, the studio copied its own out, a task started or ended.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const off = onEvent((e) => {
      if (e.projectId !== project.id || timer !== null) return;
      if (e.body.type !== 'repo.received' && e.body.type !== 'repo.published' && e.body.type !== 'task.state') return;
      timer = setTimeout(() => {
        timer = null;
        reload();
      }, 150);
    });
    return () => {
      off();
      if (timer !== null) clearTimeout(timer);
    };
  }, [onEvent, project.id, reload]);
  const open = useAction(async () => {
    await backend.call('repo.open', { projectId: project.id });
    reload();
  });
  const fitting = useAction(async () => {
    const task = await backend.call('tasks.submit', { projectId: project.id, kind: 'adopt', prompt: FIT_PROMPT });
    onFit(task);
  });

  if (status.error && !status.data) return <div className="p-4"><Problem>{status.error}</Problem></div>;
  if (!status.data) return <p className="p-4 text-base text-fg-muted">저장소를 읽는 중입니다.</p>;
  const repo = status.data;

  return (
    <div className="flex flex-col gap-8 p-4">
      {repo.adopted && !repo.planned ? <FitNotice fit={fit} busy={fitting.busy} error={fitting.error} onFit={() => void fitting.run()} onTask={onTask} /> : null}

      {!repo.open || repo.path === null ? (
        <section className="flex flex-col items-start gap-4" aria-label="저장소">
          <div className="flex flex-col gap-1">
            <h2 className="text-lg font-semibold">저장소</h2>
            <p className="text-base text-fg-muted">이 프로젝트의 브랜치를 그대로 비추는 git 저장소를 이 Mac에 엽니다. 거기서 clone해 평소 쓰는 도구로 작업하고, 거기로 push하면 스튜디오가 받습니다.</p>
          </div>
          {open.error ? <Problem>{open.error}</Problem> : null}
          <Button variant="primary" busy={open.busy} onClick={() => void open.run()} icon={<FolderGit2 className="size-4" aria-hidden />}>
            이 Mac에 저장소 열기
          </Button>
        </section>
      ) : (
        <OpenRepository repo={repo} path={repo.path} />
      )}

      {repo.open ? <Branches branches={repo.branches} /> : null}

      {received.length > 0 ? (
        <section className="flex flex-col gap-2" aria-label="이 창에서 받은 것">
          <div className="flex flex-col gap-1">
            <h3 className="text-base font-semibold">이 창에서 받은 것</h3>
            <p className="text-sm text-fg-muted">이 창을 연 뒤로 소유자가 이 저장소에 올리고 스튜디오가 받은 것입니다.</p>
          </div>
          <ul className="flex flex-col">
            {received.map((e) =>
              e.body.type === 'repo.received' ? (
                <li key={e.seq} className="flex max-w-none flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-t border-border py-2">
                  <span className="min-w-0 break-words text-base">{receivedLine(e.body)}</span>
                  <time dateTime={new Date(e.at).toISOString()} className="text-sm text-fg-muted">
                    {stamp(e.at)}
                  </time>
                </li>
              ) : null,
            )}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

/**
 * A product that was brought in, before it has been fitted: nothing the studio knows how to start, walk or
 * measure. One task changes that, on the owner's subscription, and ends on a branch the owner reads and merges.
 */
function FitNotice({ fit, busy, error, onFit, onTask }: { fit: Task | null; busy: boolean; error: string | null; onFit: () => void; onTask: (taskId: string) => void }) {
  const going = fit !== null && !finished(fit.state);
  return (
    <section className="flex flex-col gap-3 rounded-lg border border-warning bg-surface px-4 py-3" aria-label="스튜디오에 맞추기">
      <span className="text-sm font-medium text-warning">아직 맞추지 않은 제품</span>
      <h2 className="text-base font-semibold">걷기 계획이 없어 프리뷰와 걷기, 화면 측정이 돌지 않습니다</h2>
      <dl className="flex flex-col">
        <Row label="맞추기 작업">웹에서 돌게 하고 지금 있는 화면을 계획으로 적어 걷는 표식을 달 뿐, 모양과 문구와 동작은 그대로 둡니다.</Row>
        <Row label="돌리는 곳">소유자의 구독. 브랜치 하나로 끝나고, 그 브랜치를 읽고 main에 합치면 이 안내가 사라집니다.</Row>
      </dl>
      {fit ? (
        going ? (
          <Status tone="active">맞추기 작업 {taskStateLabel[fit.state]}</Status>
        ) : fit.state === 'succeeded' && fit.branch ? (
          <p className="text-base">
            맞추기 작업이 <code className="break-words font-mono text-sm">{fit.branch}</code> 브랜치로 끝났습니다. 읽고 main에 합치세요.
          </p>
        ) : (
          <Status tone={fit.state === 'failed' ? 'bad' : 'neutral'}>지난 맞추기 작업 {taskStateLabel[fit.state]}</Status>
        )
      ) : null}
      {error ? <Problem>{error}</Problem> : null}
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" busy={busy} disabled={going} onClick={onFit} icon={<Ruler className="size-4" aria-hidden />}>
          스튜디오에 맞추기
        </Button>
        {fit ? <Button onClick={() => onTask(fit.id)}>맞추기 작업 보기</Button> : null}
      </div>
    </section>
  );
}

/** Where the repository is, how to reach it, how to use it, and for a product that was brought in, where it came from. */
function OpenRepository({ repo, path }: { repo: RepoStatus; path: string }) {
  const base = repo.adopted?.base ?? INTEGRATION_BRANCH;
  return (
    <section className="flex flex-col gap-4" aria-label="저장소">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold">저장소</h2>
        <p className="text-base text-fg-muted">이 프로젝트의 브랜치가 이 Mac의 git 저장소에 비칩니다. 스튜디오의 작업이 끝나거나 합쳐질 때마다 따라 움직입니다.</p>
      </div>
      <Copyable label="이 Mac의 위치" text={path} />
      {repo.cloneCommand ? <Copyable label="새로 clone하기" text={repo.cloneCommand} /> : null}
      <Copyable label="가진 체크아웃에 잇기" text={`git remote add studio ${quoted(path)}`} hint={repo.adopted ? '들여온 체크아웃에는 들여올 때 달았습니다.' : undefined} />
      <dl className="flex flex-col" aria-label="쓰는 법">
        <Row label="받기">
          <Command>git fetch studio</Command>
        </Row>
        <Row label="보내기">
          <Command>{'git push studio <브랜치>'}</Command>
        </Row>
        {/* The checkout's base branch is main here: pushing it under its own name would make a second branch. */}
        {base !== INTEGRATION_BRANCH ? (
          <Row label={`${base} 보내기`}>
            <Command>{`git push studio ${base}:main`}</Command>
          </Row>
        ) : null}
        <Row label="main">{`앞으로만 움직입니다. ${repo.planned ? 'main에 올리면 스튜디오가 전체 점검을 겁니다.' : '걷기 계획이 생긴 뒤로는 main에 올릴 때마다 스튜디오가 전체 점검을 겁니다.'}`}</Row>
      </dl>
      {repo.adopted ? (
        <dl className="flex flex-col" aria-label="들여온 곳">
          <Row label="들여온 체크아웃">
            <Command>{repo.adopted.path}</Command>
          </Row>
          <Row label="기준 브랜치">
            <Command>{repo.adopted.base}</Command>
          </Row>
          <Row label="제품 폴더">{repo.root === '' ? '저장소 루트' : <Command>{`${repo.root}/`}</Command>}</Row>
        </dl>
      ) : null}
    </section>
  );
}

/** A label and what it names, side by side where there is room and one above the other on a phone. Both read from the start side. */
function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-x-4 gap-y-1 border-t border-border py-2 md:grid-cols-[9rem_minmax(0,1fr)]">
      <dt className="text-sm font-medium text-fg-muted">{label}</dt>
      <dd className="min-w-0 break-words text-base">{children}</dd>
    </div>
  );
}

const Command = ({ children }: { children: string }) => <code className="break-words font-mono text-sm">{children}</code>;

/** One thing to copy into a terminal: shown whole, wrapped inside its own box, with a button that copies it. */
function Copyable({ label, text, hint }: { label: string; text: string; hint?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // No clipboard permission: the text is on screen and can be selected.
    }
  };
  return (
    <div className="flex flex-col gap-1">
      <span className="text-sm font-medium">{label}</span>
      <div className="flex items-start gap-1">
        <code className="min-w-0 flex-1 break-words rounded-md border border-border bg-sunken px-3 py-2 font-mono text-sm">{text}</code>
        <IconButton label={copied ? `${label} 복사됨` : `${label} 복사`} onClick={() => void copy()}>
          {copied ? <Check className="size-4 text-success" aria-hidden /> : <Copy className="size-4" aria-hidden />}
        </IconButton>
      </div>
      {hint ? <span className="text-sm text-fg-muted">{hint}</span> : null}
    </div>
  );
}

/** The repository's branches: main first, then the newest. Each with its commit, what it says, and when. */
function Branches({ branches }: { branches: RepoStatus['branches'] }) {
  const sorted = [...branches.filter((b) => b.name === INTEGRATION_BRANCH), ...branches.filter((b) => b.name !== INTEGRATION_BRANCH)];
  return (
    <section className="flex flex-col gap-2" aria-label="브랜치">
      <h3 className="text-base font-semibold">브랜치 {branches.length}개</h3>
      {sorted.length === 0 ? <p className="text-base text-fg-muted">아직 브랜치가 없습니다. 첫 작업이 끝나면 main이 생깁니다.</p> : null}
      <ul className="flex flex-col">
        {sorted.map((b) => (
          <li key={b.name} className="flex max-w-none flex-col gap-1 border-t border-border py-3">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <code className="min-w-0 break-words font-mono text-sm font-semibold">{b.name}</code>
              <span className="text-sm text-fg-muted">
                <code className="font-mono">{b.commit.slice(0, 7)}</code>
                {' · '}
                <time dateTime={new Date(b.at).toISOString()} title={new Date(b.at).toLocaleString('ko')}>
                  {ago(b.at)}
                </time>
              </span>
            </div>
            {b.subject ? <p className="break-words text-base">{b.subject}</p> : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
