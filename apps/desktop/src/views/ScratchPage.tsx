import { Archive, FileDown, FileText } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { AxBlock, AxResponse, DocumentKind, KnowledgeJob, ScratchMove, Template } from '@studio-zero/protocol';
import { Block, Markdown } from '@studio-zero/ax/react';
import { templateLabel, tokens } from '../lib/format.ts';
import { useAction, useQuery, useStudio } from '../lib/studio.tsx';
import { Button, Problem, Segmented, Sheet, Status, TitlebarSpace } from '../ui.tsx';
import { Composer, Entry, OwnWords, Working, useStickToEnd } from './page.tsx';
import { scratchState, type Route } from './Shell.tsx';

const modeLabel = { think: '생각 정리', research: '조사', document: '문서' } as const;
const MOVES: readonly { id: ScratchMove; label: string; does: string }[] = [
  { id: 'crazy-eights', label: '여덟 갈래', does: '서로 다른 방향 8가지를 펼쳐 봅니다' },
  { id: 'personas', label: '가상 사용자', does: '사용자 5명의 입장에서 반응을 들어 봅니다' },
  { id: 'red-team', label: '반대 검토', does: '이 계획이 실패할 이유를 찾습니다' },
  { id: 'converge', label: '명세로 모으기', does: '지금까지의 결정을 기획 명세로 정리합니다' },
];
const TEMPLATES = (Object.keys(templateLabel) as Template[]).map((id) => ({ id, label: templateLabel[id] }));
const DOCUMENTS: readonly { id: DocumentKind; label: string }[] = [
  { id: 'prd', label: '제품 요구사항' },
  { id: 'rfc', label: '기술 제안' },
  { id: 'report', label: '보고서' },
  { id: 'brief', label: '한 장 브리핑' },
];
const LABELS = { recommended: '스튜디오 추천' };
const answerable = (block: AxBlock): block is Extract<AxBlock, { type: 'choice' | 'form' }> => block.type === 'choice' || block.type === 'form';

/** A worksheet: one page where the owner and the studio think something through, in order, top to bottom. */
export function ScratchPage({ scratchId, onOpen, onChanged }: { scratchId: string; onOpen: (route: Route) => void; onChanged: () => void }) {
  const { backend, onEvent } = useStudio();
  const view = useQuery('scratch.get', { scratchId }, ['scratch.entry', 'scratch.state', 'scratch.thinking', 'knowledge.state']);
  const [turnError, setTurnError] = useState<string | null>(null);
  const [steps, setSteps] = useState<Record<string, string>>({});
  const [papers, setPapers] = useState(false);

  useEffect(
    () =>
      onEvent((e) => {
        const b = e.body;
        if (b.type === 'scratch.thinking' && b.scratchId === scratchId) setTurnError(b.error);
        if (b.type === 'knowledge.state' && b.step) setSteps((s) => ({ ...s, [b.jobId]: b.step! }));
      }),
    [onEvent, scratchId],
  );

  const data = view.data;
  const entries = data?.entries ?? [];
  // A conversation is read from its end; a finished briefing is read from its conclusion at the top.
  const scroll = useStickToEnd(`${entries.length}:${data?.thinking}`, data?.scratchpad.mode === 'think');
  const answers = useMemo(() => new Map(entries.flatMap((e) => (e.response ? [[e.response.blockId, e.response] as const] : []))), [entries]);

  const say = useAction((text: string) => backend.call('scratch.say', { scratchId, text }));
  const respond = useAction((response: AxResponse) => backend.call('scratch.respond', { scratchId, response }));
  const move = useAction((id: ScratchMove) => backend.call('scratch.move', { scratchId, move: id }));
  const archive = useAction(async () => {
    await backend.call('scratch.archive', { scratchId });
    onChanged();
    onOpen({ kind: 'home' });
  });

  if (!data) {
    return (
      <div className="page p-10">
        <TitlebarSpace />
        {view.error ? <Problem>{view.error}</Problem> : null}
      </div>
    );
  }
  const pad = data.scratchpad;
  const open = pad.state === 'exploring' || pad.state === 'ready';
  const running = data.jobs.filter((j) => j.state === 'running');

  return (
    <>
      <div ref={scroll} className="pane-scroll min-h-0 flex-1">
        <article className="page flex flex-col pb-16">
          <TitlebarSpace />
          <header className="flex flex-col gap-4 border-b border-border px-4 pb-8 pt-10 md:px-10">
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
              <p className="text-sm font-medium text-fg-muted">{modeLabel[pad.mode]}</p>
              <Status tone={pad.state === 'ready' ? 'good' : pad.state === 'exploring' ? 'active' : 'neutral'}>{scratchState[pad.state]}</Status>
            </div>
            <h1 className="text-4xl font-semibold">{pad.title}</h1>
            <div className="flex flex-wrap gap-2">
              {pad.mode === 'think' ? (
                <Button onClick={() => setPapers(true)} icon={<FileText className="size-4" aria-hidden />}>
                  명세와 결정 기록
                </Button>
              ) : null}
              {pad.state === 'promoted' && pad.projectId ? (
                <Button variant="primary" onClick={() => onOpen({ kind: 'project', id: pad.projectId! })}>
                  프로젝트 열기
                </Button>
              ) : null}
              {open ? (
                <Button busy={archive.busy} onClick={() => void archive.run()} icon={<Archive className="size-4" aria-hidden />}>
                  보관
                </Button>
              ) : null}
            </div>
            {archive.error ? <Problem>{archive.error}</Problem> : null}
          </header>

          <ol className="flex flex-col">
            {entries.map((entry) => {
              // An answer is shown on the question it answers, not as a line of its own.
              if (entry.response && entry.blocks.length === 0 && !entry.text) return null;
              return (
                <Entry key={entry.seq} who={entry.author === 'owner' ? '나' : entry.author === 'agent' ? '스튜디오' : '기록'} at={entry.at}>
                  {entry.text ? entry.author === 'owner' ? <OwnWords>{entry.text}</OwnWords> : <p className="text-lg">{entry.text}</p> : null}
                  {entry.blocks.map((block, i) => (
                    <Block key={i} block={block} labels={LABELS} answer={answerable(block) ? answers.get(block.id) : undefined} onRespond={open && answerable(block) && !answers.has(block.id) ? respond.run : undefined} />
                  ))}
                </Entry>
              );
            })}
            {data.thinking ? <Working>스튜디오가 생각하는 중</Working> : null}
            {running.map((job) => (
              <Working key={job.id}>
                {job.kind === 'research' ? '조사' : '문서 작성'}: {steps[job.id] ?? '시작'}
              </Working>
            ))}
          </ol>

          <div className="flex flex-col gap-6 px-4 pt-8 md:px-10">
            {respond.error ? <Problem>{respond.error}</Problem> : null}
            {turnError ? <Problem>스튜디오가 이 차례를 마치지 못했습니다. {turnError}</Problem> : null}
            {data.jobs.filter((j) => j.state !== 'running').map((job) => (
              <JobResult key={job.id} job={job} />
            ))}
            {pad.mode === 'think' && open ? <Promote scratchId={scratchId} ready={data.readiness.ready} missing={data.readiness.missing} busy={data.thinking} onOpen={onOpen} onChanged={onChanged} /> : null}
          </div>
        </article>
      </div>

      {open ? (
        <Composer
          placeholder={pad.mode === 'think' ? '이어서 적거나, 방향을 바꿔 보세요' : '덧붙일 질문이나 요청'}
          sendLabel="보내기"
          onSend={say.run}
          error={say.error ?? move.error}
          above={
            pad.mode === 'think' ? (
              <div className="flex flex-wrap gap-1 border-b border-border pb-2">
                {MOVES.map((m) => (
                  <button key={m.id} type="button" title={m.does} disabled={move.busy || data.thinking} onClick={() => void move.run(m.id)} className="min-h-11 rounded-md px-3 text-sm font-medium text-fg-muted hover:bg-sunken hover:text-fg disabled:opacity-60">
                    {m.label}
                  </button>
                ))}
              </div>
            ) : null
          }
        />
      ) : null}

      <Sheet open={papers} onOpenChange={setPapers} title="명세와 결정 기록" description="만들기로 넘어갈 때 이 두 문서가 그대로 프로젝트에 들어갑니다." wide>
        <Papers spec={data.spec} decisionLog={data.decisionLog} />
      </Sheet>
    </>
  );
}

function Papers({ spec, decisionLog }: { spec: string; decisionLog: string }) {
  const [which, setWhich] = useState<'spec' | 'log'>('spec');
  const source = which === 'spec' ? spec : decisionLog;
  return (
    <div className="flex flex-col gap-6 p-6">
      <Segmented label="문서" value={which} onChange={setWhich} options={[{ id: 'spec', label: '기획 명세' }, { id: 'log', label: '결정 기록' }]} />
      {source.trim() ? <Markdown source={source} /> : <p className="text-base text-fg-muted">{which === 'spec' ? '아직 적힌 내용이 없습니다. 이야기가 진행되면 스튜디오가 채워 갑니다.' : '아직 기록된 결정이 없습니다.'}</p>}
    </div>
  );
}

/** What still stands between this note and a build, as the daemon computed it, and the step across once nothing does. */
function Promote({ scratchId, ready, missing, busy, onOpen, onChanged }: { scratchId: string; ready: boolean; missing: string[]; busy: boolean; onOpen: (route: Route) => void; onChanged: () => void }) {
  const { backend } = useStudio();
  const [template, setTemplate] = useState<Template>('web-vite-react');
  const [documentKind, setDocumentKind] = useState<DocumentKind>('prd');
  const build = useAction(async () => {
    const result = await backend.call('scratch.promote', { scratchId, target: 'build', template });
    onChanged();
    if (result.project) onOpen({ kind: 'project', id: result.project.id });
  });
  const write = useAction(async () => {
    await backend.call('scratch.promote', { scratchId, target: 'document', documentKind });
    onChanged();
  });

  if (!ready) {
    return (
      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold">만들기 전에 남은 것</h2>
        <ul className="flex flex-col">
          {missing.map((item) => (
            <li key={item} className="flex items-start gap-3 border-t border-border py-3 text-base">
              <span className="mt-1 size-5 shrink-0 border border-control-border" aria-hidden />
              {item}
            </li>
          ))}
        </ul>
      </section>
    );
  }
  return (
    <section className="flex flex-col gap-6 border-l-4 border-accent pl-5">
      <div className="flex flex-col gap-1">
        <h2 className="text-2xl font-semibold">만들 준비가 됐습니다</h2>
        <p className="text-base text-fg-muted">기획 명세와 결정 기록이 프로젝트의 docs 폴더와 첫 작업 지시에 그대로 들어갑니다.</p>
      </div>
      {build.error ? <Problem>{build.error}</Problem> : null}
      {write.error ? <Problem>{write.error}</Problem> : null}
      <div className="flex flex-col gap-3">
        <Segmented label="무엇으로 만들지" value={template} options={TEMPLATES} onChange={setTemplate} />
        <Button variant="primary" busy={build.busy} disabled={busy || write.busy} onClick={() => void build.run()} className="self-start">
          이 기획으로 프로젝트 빌드 시작
        </Button>
      </div>
      <div className="flex flex-col gap-3 border-t border-border pt-6">
        <Segmented label="문서 종류" value={documentKind} options={DOCUMENTS} onChange={setDocumentKind} />
        <Button busy={write.busy} disabled={busy || build.busy} onClick={() => void write.run()} className="self-start">
          정식 기획서 발행
        </Button>
      </div>
    </section>
  );
}

/** A finished research or writing job: what it cost, why it failed if it did, and the document as a file. */
function JobResult({ job }: { job: KnowledgeJob }) {
  const { backend } = useStudio();
  const [file, setFile] = useState<string | null>(null);
  const exportPdf = useAction(async () => {
    const { artifactId } = await backend.call('documents.export', { jobId: job.id });
    setFile(await backend.artifactUrl(artifactId));
  });
  if (job.state === 'failed') {
    return (
      <Problem>
        {job.kind === 'research' ? '조사' : '문서 작성'}를 마치지 못했습니다. {job.error}
      </Problem>
    );
  }
  return (
    <section className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-t border-border pt-6">
      <p className="text-base text-fg-muted">
        {job.kind === 'research' ? '조사' : '문서'} 완료, 토큰 {tokens(job.spentTokens)} 사용
      </p>
      {exportPdf.error ? <Problem>{exportPdf.error}</Problem> : null}
      {file ? (
        <a href={file} download={`${job.title}.pdf`} className="inline-flex min-h-11 items-center gap-2 rounded-md bg-accent px-4 text-sm font-medium text-on-accent">
          <FileDown className="size-4" aria-hidden />
          PDF 받기
        </a>
      ) : (
        <Button busy={exportPdf.busy} onClick={() => void exportPdf.run()} icon={<FileDown className="size-4" aria-hidden />}>
          PDF로 만들기
        </Button>
      )}
    </section>
  );
}
