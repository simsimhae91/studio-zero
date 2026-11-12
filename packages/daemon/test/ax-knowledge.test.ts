import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import type Anthropic from '@anthropic-ai/sdk';
import { chromium } from 'playwright-core';
import { lintText } from '@studio-zero/design';
import type { KnowledgeJob } from '@studio-zero/protocol';
import { ConfidenceCalibration } from '../src/ax/Calibration.ts';
import { Store } from '../src/db/Store.ts';
import { checkCitations } from '../src/knowledge/DocumentCompiler.ts';
import { documentHtml } from '../src/knowledge/exportPdf.ts';
import { retrieved, verifyFindings } from '../src/knowledge/ResearchPipeline.ts';
import { PromotionWorkflow } from '../src/scratch/PromotionWorkflow.ts';
import { sleep } from '../src/util/core.ts';
import { testDaemon } from './helpers.ts';

const OWNER = { type: 'owner', via: 'desktop' } as const;
type Params = Anthropic.Beta.MessageCreateParams;
const usage = { input_tokens: 300, output_tokens: 100, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
const base = { id: 'msg', type: 'message', role: 'assistant', model: 'claude-fable-5-2', stop_details: null, stop_sequence: null, usage };
const use = (id: string, name: string, input: unknown): unknown => ({ type: 'tool_use', id, name, input });
const say = (text: string): unknown => ({ type: 'text', text, citations: null });

/** A model whose turns are scripted. `stream` answers from `turns`; `parse` from `structured`. Every request is kept. */
function scripted(turns: (unknown[] | ((params: Params) => unknown[]))[], structured: (system: string) => unknown = () => ({})): { sdk: Anthropic; requests: Params[] } {
  const requests: Params[] = [];
  const sdk = {
    beta: {
      messages: {
        stream: (params: Params) => {
          requests.push(structuredClone(params));
          const next = turns.shift();
          if (!next) throw new Error('script ran out of turns');
          const content = typeof next === 'function' ? next(params) : next;
          return { finalMessage: async () => ({ ...base, content, stop_reason: content.some((b) => (b as { type: string }).type === 'tool_use') ? 'tool_use' : 'end_turn' }) };
        },
        parse: async (params: Params) => ({ ...base, content: [], stop_reason: 'end_turn', parsed_output: structured(String(params.system)) }),
      },
    },
  } as unknown as Anthropic;
  return { sdk, requests };
}
const lastToolResults = (params: Params): { content: string; is_error: boolean }[] => (params.messages.at(-1)!.content as { type: string; content: string; is_error: boolean }[]).filter((b) => b.type === 'tool_result');

// ---------------------------------------------------------- text guardrails

const SLOPPY_DOC = `# AI 인프라 시장 보고서

## 서론

오늘날 급변하는 시대에 AI 인프라는 혁신적인 패러다임의 변화를 이끌고 있습니다. 많은 기업이 상당한 투자를 하고 있습니다!

## 특징

- 확장성
- 유연성
- 안정성
- 효율성
- 보안성

\`\`\`mermaid
A --> B
\`\`\`
`;

const CLEAN_DOC = `# AI 인프라 투자 브리핑

## 결론

2026년 3분기 상위 4개 클라우드의 설비 투자는 합계 1,120억 달러로, 전년 같은 분기보다 38% 늘었다 [1]. 증가분의 대부분은 GPU 서버와 전력 설비다 [2].

## 근거

| 항목 | 2025 3분기 | 2026 3분기 |
| --- | --- | --- |
| 설비 투자 합계 | 810억 달러 [1] | 1,120억 달러 [1] |

\`\`\`mermaid
flowchart LR
  capex[설비 투자] --> gpu[GPU 서버]
\`\`\`

## 한계와 리스크

분기 수치는 회사마다 회계 기준이 달라 직접 비교에 5% 안팎의 오차가 있다 [2].

## 다음 단계

11월 20일 실적 발표에서 4분기 가이던스를 확인한다.

## 출처

[1] Example Filing https://example.com/filing
[2] Example Analysis https://example.org/analysis
`;

test('text guardrails: generated-sounding writing is caught line by line; a direct, sourced document passes', () => {
  const findings = lintText(SLOPPY_DOC, { kind: 'report' });
  const rules = [...new Set(findings.map((f) => f.rule))].sort();
  assert.deepEqual(rules, ['text/cliche', 'text/empty-list', 'text/exclamation', 'text/mermaid-syntax', 'text/no-bluf', 'text/no-numbers', 'text/structure', 'text/throat-clearing', 'text/vague-quantity']);
  assert.equal(findings.find((f) => f.rule === 'text/throat-clearing')!.line, 5);
  assert.match(findings.find((f) => f.rule === 'text/cliche')!.message, /급변하는|혁신적인|패러다임/);
  assert.equal(findings.find((f) => f.rule === 'text/empty-list')!.line, 9);
  assert.ok(findings.filter((f) => f.rule === 'text/structure').length >= 3, 'a report needs its sections');

  assert.deepEqual(lintText(CLEAN_DOC, { kind: 'report', requireCitations: true }), []);
  assert.deepEqual(checkCitations(CLEAN_DOC, 2, true), []);
  assert.match(checkCitations(CLEAN_DOC.replace('[2].', '[7].'), 2, true)[0]!.message, /\[7\] does not match any source/);
  assert.equal(lintText(CLEAN_DOC.replace(' [1]. 증가분', '. 증가분'), { kind: 'report', requireCitations: true })[0]!.rule, 'text/unsourced-figure');
});

// --------------------------------------------------------------- research

test('research: a claim is only as good as the pages actually retrieved', () => {
  const blocks = [
    { type: 'web_search_tool_result', tool_use_id: 's1', content: [{ type: 'web_search_result', url: 'https://www.example.com/filing/', title: 'Example Filing', encrypted_content: 'x', page_age: null }] },
    { type: 'web_fetch_tool_result', tool_use_id: 'f1', content: { type: 'web_fetch_result', url: 'https://example.org/analysis', retrieved_at: null, content: { type: 'document', title: 'Analysis', citations: null, source: { type: 'text', media_type: 'text/plain', data: 'Capital  expenditure rose 38% year over year.' } } } },
    { type: 'web_search_tool_result', tool_use_id: 's2', content: { type: 'web_search_tool_result_error', error_code: 'max_uses_exceeded' } },
  ] as unknown as Anthropic.Beta.BetaContentBlock[];
  const seen = retrieved(blocks);
  assert.equal(seen.searches, 2);
  assert.deepEqual([...seen.urls.keys()], ['https://www.example.com/filing', 'https://example.org/analysis']);

  const { facts, dropped } = verifyFindings(
    [
      { claim: 'Capex rose 38%.', conflict: false, sources: [{ url: 'https://example.org/analysis', title: '', quote: 'capital expenditure rose 38% year over year' }, { url: 'https://www.example.com/filing', title: 'Filing', quote: 'not checkable from a search hit' }] },
      { claim: 'Single source.', conflict: false, sources: [{ url: 'https://example.org/analysis', title: 'A', quote: 'words that are not on the page at all' }] },
      { claim: 'Sources disagree.', conflict: true, sources: [{ url: 'https://example.org/analysis', title: 'A', quote: 'x' }, { url: 'https://www.example.com/filing', title: 'B', quote: 'y' }] },
      { claim: 'Cited from memory.', conflict: false, sources: [{ url: 'https://never-fetched.example/page', title: 'Ghost', quote: 'made up' }] },
    ],
    seen,
  );
  assert.deepEqual(facts.map((f) => [f.claim, f.confidence]), [['Capex rose 38%.', 'high'], ['Single source.', 'medium'], ['Sources disagree.', 'speculative']]);
  assert.deepEqual(facts[0]!.sources.map((s) => [s.domain, s.quoteVerified]), [['example.org', true], ['example.com', false]], 'a quote is verified only against a fetched page');
  assert.equal(facts[1]!.sources[0]!.quoteVerified, false);
  assert.deepEqual(dropped, [{ claim: 'Cited from memory.', reason: 'none of its sources were among the pages retrieved' }]);
});

test('research errand end to end: plan, gather, verify, and a briefing that had to pass the linter', async () => {
  const gather = (id: string) => [
    { type: 'server_tool_use', id: `st_${id}`, name: 'web_search', input: { query: 'q' } },
    { type: 'web_search_tool_result', tool_use_id: `st_${id}`, content: [{ type: 'web_search_result', url: 'https://example.com/filing', title: 'Example Filing', encrypted_content: 'x', page_age: null }, { type: 'web_search_result', url: 'https://example.org/analysis', title: 'Example Analysis', encrypted_content: 'x', page_age: null }] },
    use(`tu_${id}`, 'report_findings', { findings: [{ claim: '설비 투자 합계는 1,120억 달러다.', conflict: false, sources: [{ url: 'https://example.com/filing', title: 'Example Filing', quote: 'total capex of $112 billion' }, { url: 'https://example.org/analysis', title: 'Example Analysis', quote: 'capex reached $112B' }] }, { claim: '출처 없는 주장.', conflict: false, sources: [{ url: 'https://invented.example/x', title: 'x', quote: 'x' }] }], gaps: ['4분기 가이던스는 확인하지 못함'] }),
  ];
  const model = scripted([gather('a'), [say(SLOPPY_DOC)], [say(CLEAN_DOC)]], (system) => (system.startsWith('Split a research question') ? { subQuestions: [{ question: '투자 규모', queries: ['capex 2026 Q3'] }] } : {}));
  const d = await testDaemon({}, { anthropic: model.sdk });
  await d.daemon.start();
  try {
    const job = await d.daemon.studio.startResearch({ type: 'owner', via: 'telegram' }, { question: '이번 분기 AI 인프라 투자 규모를 조사해줘', depth: 'brief' }, 'telegram');
    await d.daemon.knowledge.idle();
    const result = d.daemon.studio.getKnowledge(job.id);
    assert.equal(result.job.state, 'succeeded', result.job.error ?? '');
    assert.equal(result.job.origin, 'telegram');
    assert.ok(result.job.spentTokens > 0);
    assert.deepEqual(result.report!.facts.map((f) => [f.claim, f.confidence, f.sources.length]), [['설비 투자 합계는 1,120억 달러다.', 'high', 2]]);
    assert.equal(result.report!.dropped.length, 1);
    assert.deepEqual(result.report!.gaps, ['4분기 가이던스는 확인하지 못함']);
    assert.equal(result.markdown, CLEAN_DOC.trim(), 'the first draft was rejected by the linter; the second is what is kept');
    assert.deepEqual(result.lint, []);

    const [, firstDraft, secondDraft] = model.requests;
    assert.deepEqual((model.requests[0]!.tools as { type?: string; name: string }[]).map((t) => t.type ?? t.name), ['report_findings', 'web_search_20260209', 'web_fetch_20260209']);
    assert.match(String(firstDraft!.messages[0]!.content), /<untrusted-data id="[0-9a-f]{24}" source="browser-page">\n- 설비 투자 합계는 1,120억 달러다\. \[1\]\[2\] \(근거 수준: high\)/, 'facts reach the writer as data, numbered');
    const feedback = String(secondDraft!.messages.at(-1)!.content);
    assert.match(feedback, /line 5: The document opens by describing itself/);
    assert.match(feedback, /does not start with a diagram type/);
    assert.ok(!d.daemon.studio.listProjects().some((p) => p.id === 'prj_studio'), 'the studio budget scope is not a project the owner sees');
    assert.equal(d.daemon.store.projectTokensSince('prj_studio', 0), result.job.spentTokens);
  } finally {
    await d.cleanup();
  }
});

// ------------------------------------------------- scratchpad → promotion

test('scratchpad to build: questions, a calibration gate, a decision log, and lossless promotion', async () => {
  const choice = { type: 'choice', id: 'platform', question: '어디서 먼저 쓰이나요?', options: [{ id: 'web', label: '웹', detail: '설치 없이 시작' }, { id: 'mobile', label: '모바일 앱', detail: null }], recommended: 'web', confidence: 'medium', allowOther: true };
  const model = scripted([
    // Turn 1: tries to settle a medium-confidence question by itself, is refused by the daemon, then asks.
    [use('t1', 'record_decision', { question: '플랫폼', chosen: '웹', why: '빠르다', rejected: [], confidence: 'medium', answersBlockId: null })],
    (params) => {
      assert.match(lastToolResults(params)[0]!.content, /At this confidence the decision is the owner's/);
      assert.equal(lastToolResults(params)[0]!.is_error, true);
      return [use('t2', 'present', { blocks: [{ type: 'text', markdown: '플랫폼부터 정하면 나머지가 좁혀집니다.' }, choice] })];
    },
    [say('')],
    // Turn 2 (after the owner answers): record it, fill the spec.
    (params) => {
      assert.match(String(params.messages.at(-2)!.content), /The owner answered "어디서 먼저 쓰이나요\?": 모바일 앱/);
      return [
        use('t3', 'record_decision', { question: '첫 플랫폼', chosen: '모바일 앱', why: '현장에서 쓰는 도구라서', rejected: [{ option: '웹', why: '현장에서 노트북을 펴지 않는다' }], confidence: 'high', answersBlockId: 'platform' }),
        use('t4', 'update_spec', { section: 'problem', content: '현장 기사가 미결제 청구서를 사무실에 돌아와서야 확인한다.' }),
        use('t5', 'update_spec', { section: 'users', content: '하루 5~8곳을 방문하는 설비 기사.' }),
        use('t6', 'update_spec', { section: 'scope_in', content: '- 미결제 청구서 목록\n- 청구서 다시 보내기' }),
        use('t7', 'update_spec', { section: 'requirements', content: '1. 목록은 2초 안에 열린다.' }),
      ];
    },
    [say('')],
    // After promotion: the build task's own turns.
    [say('Built.')],
  ], (system) => (system.startsWith('You are planning') ? { summary: 'Build it.', steps: ['Scaffold'], auditRoutes: [], openQuestions: [] } : { outcome: 'clean', rootCauses: [], lessons: [], harmfulLessonIds: [], evalSuggestions: [] }));
  const d = await testDaemon({}, { anthropic: model.sdk });
  await d.daemon.start();
  const { studio, scratch } = d.daemon;
  try {
    const before = d.docker.calls.length;
    const pad = await studio.createScratchpad(OWNER, { opening: '현장 기사용 청구서 앱', mode: 'think' }, 'desktop');
    await scratch.idle();
    assert.equal(d.docker.calls.length, before, 'a scratchpad starts no container');

    let view = studio.scratchView(pad.id);
    assert.deepEqual(view.entries.map((e) => [e.author, e.blocks.map((b) => b.type).join('+') || 'text']), [['owner', 'text'], ['agent', 'text+choice']]);
    assert.deepEqual(view.readiness.missing, ['기획 명세의 "문제" 항목', '기획 명세의 "사용자" 항목', '기획 명세의 "범위: 포함" 항목', '기획 명세의 "요구사항" 항목', '기록된 결정 1건 이상', '답하지 않은 질문 1건']);
    await assert.rejects(studio.promoteScratchpad(OWNER, { scratchId: pad.id, target: 'build' }, 'desktop'), /not ready to promote/);

    // The owner overrides the recommendation: that is recorded against the agent's stated confidence.
    studio.scratchRespond(pad.id, { kind: 'choice', blockId: 'platform', optionId: 'mobile', other: null });
    assert.throws(() => studio.scratchRespond(pad.id, { kind: 'choice', blockId: 'platform', optionId: 'web', other: null }), /already been answered/);
    await scratch.idle();
    assert.deepEqual(studio.calibration().levels.medium, { total: 1, overridden: 1 });

    view = studio.scratchView(pad.id);
    assert.equal(view.scratchpad.state, 'ready');
    assert.deepEqual(view.readiness, { ready: true, missing: [] });
    assert.match(view.decisionLog, /## 1\. 첫 플랫폼\n\n- 결정: 모바일 앱\n- 결정한 쪽: 소유자\n- 이유: 현장에서 쓰는 도구라서\n- 기각한 대안:\n  - 웹: 현장에서 노트북을 펴지 않는다/);
    assert.match(view.spec, /^# 현장 기사용 청구서 앱\n\n## 문제\n\n현장 기사가[\s\S]*## 요구사항\n\n1\. 목록은 2초 안에 열린다\.\n$/);
    assert.equal(view.entries.at(-1)!.blocks[0]!.type, 'decision');

    // Publishing the plan as a document is something the note produced, not its end: it stays ready to be built.
    const publisher = new PromotionWorkflow({
      scratch,
      policy: d.daemon.policy,
      sandboxes: d.daemon.sandboxes,
      host: { createProjectAndProvision: async () => assert.fail('no project for a document'), submitTask: async () => assert.fail('no task for a document'), publishedPlan: () => null, compileDocument: async (_actor, p) => ({ id: 'job_doc', kind: 'document', title: p.title }) as KnowledgeJob },
    });
    const published = await publisher.promote(OWNER, pad.id, 'document', { documentKind: 'prd' }, 'desktop');
    assert.deepEqual([published.scratchpad.state, published.job?.id, published.project], ['ready', 'job_doc', null]);
    assert.equal(studio.scratchView(pad.id).scratchpad.state, 'ready', 'and it can be published again, or built');
    await publisher.promote(OWNER, pad.id, 'document', { documentKind: 'brief' }, 'desktop');

    // The document that was published and read is what the build goes from: it is the reconciled, approved text.
    assert.equal(studio.publishedPlan(pad.id), null, 'nothing has finished publishing yet');
    const planJob: KnowledgeJob = { id: 'job_plan', kind: 'document', title: '현장 기사용 청구서 앱', state: 'running', origin: 'desktop', scratchId: pad.id, error: null, spentTokens: 0, createdAt: 5, finishedAt: null };
    d.daemon.store.insertKnowledgeJob(planJob, {});
    d.daemon.store.finishKnowledgeJob(planJob.id, { markdown: '# 현장 기사용 청구서 앱 기획서\n\n## 결론\n\n요구사항은 R1~R10이다. R11은 없다.\n', report: null, lint: [] }, 6);
    assert.match(studio.publishedPlan(pad.id) ?? '', /^# 현장 기사용 청구서 앱 기획서/);

    // Promotion: project, sandbox, both documents in the repository and in the builder's first request.
    const visual = (id: string) => studio.setEvalEnabled(OWNER, studio.listEvals(id).find((e) => e.name === 'visual-audit')!.id, false);
    // The first build runs on what the owner picked for it. A pick that could never start is refused before a
    // project exists, and the note is still there to be built.
    const projects = studio.listProjects().length;
    await assert.rejects(studio.promoteScratchpad(OWNER, { scratchId: pad.id, target: 'build', model: 'haiku' }, 'desktop'), /together with the engine/);
    await assert.rejects(studio.promoteScratchpad(OWNER, { scratchId: pad.id, target: 'build', engine: 'cursor', effort: 'max' }, 'desktop'), /no effort setting/);
    assert.deepEqual([studio.listProjects().length, studio.scratchView(pad.id).scratchpad.state], [projects, 'ready']);
    const promoted = await studio.promoteScratchpad(OWNER, { scratchId: pad.id, target: 'build', template: 'mobile-expo', engine: 'native-claude', model: 'claude-opus-5-5', effort: 'max' }, 'desktop');
    assert.deepEqual([promoted.task!.enginePref, promoted.task!.modelPref, promoted.task!.effortPref], ['native-claude', 'claude-opus-5-5', 'max'], 'engine, model and effort reach the first build task');
    await visual(promoted.project!.id);
    assert.equal(promoted.scratchpad.state, 'promoted');
    assert.equal(promoted.scratchpad.projectId, promoted.project!.id);
    assert.equal(promoted.project!.template, 'mobile-expo');
    assert.equal(readFileSync(join(d.workspace, 'docs/spec.md'), 'utf8'), view.spec);
    assert.equal(readFileSync(join(d.workspace, 'docs/decision_log.md'), 'utf8'), view.decisionLog);
    assert.match(promoted.task!.prompt, /<spec>\n# 현장 기사용 청구서 앱[\s\S]*<\/spec>\n\n<decision_log>\n# 결정 기록[\s\S]*웹: 현장에서 노트북을 펴지 않는다\n<\/decision_log>$/);
    assert.match((await d.daemon.sandboxes.exec(promoted.project!, 'git log --format=%s -3')).stdout, /docs: spec and decision log from scratchpad scr_/);
    assert.match(promoted.task!.prompt, /read it before starting the build; it is in the repository as docs\/plan\.md\.[\s\S]*the plan is the later text and the one that was approved: follow it\.\n\n<plan>\n# 현장 기사용 청구서 앱 기획서[\s\S]*R11은 없다\.\n<\/plan>\n/);
    assert.equal(readFileSync(join(d.workspace, 'docs/plan.md'), 'utf8'), '# 현장 기사용 청구서 앱 기획서\n\n## 결론\n\n요구사항은 R1~R10이다. R11은 없다.');
    assert.throws(() => studio.scratchSay(pad.id, '하나 더'), /promoted/);
    for (let i = 0; i < 400 && !['succeeded', 'failed'].includes(studio.getTask(promoted.task!.id).state); i++) await sleep(20);
  } finally {
    await d.cleanup();
  }
});

test('confidence calibration: "high" stops being taken at face value once the owner keeps overriding it', () => {
  const store = new Store(':memory:');
  const calibration = new ConfidenceCalibration(store, () => 1);
  for (let i = 0; i < 7; i++) calibration.record('high', true);
  assert.equal(calibration.effective('high'), 'high', 'too few samples to judge');
  for (let i = 0; i < 3; i++) calibration.record('high', false);
  assert.deepEqual([calibration.highDemoted(), calibration.effective('high'), calibration.effective('medium')], [true, 'medium', 'medium']);
  assert.deepEqual(calibration.stats().levels.high, { total: 10, overridden: 3 });
  for (let i = 0; i < 20; i++) calibration.record('high', true);
  assert.equal(calibration.effective('high'), 'high', 'and it earns the trust back');
});

// ------------------------------------------------- steering & time travel

test('steering reaches a running task at its next turn; every changing turn is a checkpoint that can be forked', async () => {
  let d!: Awaited<ReturnType<typeof testDaemon>>;
  let taskId = '';
  const model = scripted([
    () => {
      // The owner types while the engine is busy with this turn.
      void d.daemon.studio.steerTask(OWNER, taskId, '버튼은 화면 아래쪽에 두세요');
      return [use('t1', 'write_file', { path: 'notes.md', content: 'v1\n' })];
    },
    (params) => {
      const content = params.messages.at(-1)!.content as { type: string; text?: string }[];
      assert.deepEqual(content.map((b) => b.type), ['tool_result', 'text'], 'the message rides along with the tool results');
      assert.match(content[1]!.text!, /The owner sent this while you were working[\s\S]*- 버튼은 화면 아래쪽에 두세요/);
      return [use('t2', 'write_file', { path: 'notes.md', content: 'v2 with the button at the bottom\n' })];
    },
    [say('Done.')],
    [say('Continued from the fork.')],
  ], (system) => (system.startsWith('You are planning') ? { summary: 'Write notes.', steps: ['Write'], auditRoutes: [], openQuestions: [] } : { outcome: 'clean', rootCauses: [], lessons: [], harmfulLessonIds: [], evalSuggestions: [] }));
  d = await testDaemon({}, { anthropic: model.sdk });
  await d.daemon.start();
  const { studio, events, sandboxes } = d.daemon;
  try {
    const project = studio.createProject(OWNER, { name: 'Ledger', slug: 'ledger', template: 'web-vite-react' });
    await studio.setEvalEnabled(OWNER, studio.listEvals(project.id).find((e) => e.name === 'visual-audit')!.id, false);
    const task = await studio.submitTask(OWNER, { projectId: project.id, kind: 'build', prompt: 'Write notes' }, 'desktop');
    taskId = task.id;
    for (let i = 0; i < 400 && !['succeeded', 'failed'].includes(studio.getTask(task.id).state); i++) await sleep(20);
    assert.equal(studio.getTask(task.id).state, 'succeeded', studio.getTask(task.id).error ?? '');
    const trace = events.history({ taskId: task.id }, 0, 300).map((e) => e.body);
    assert.deepEqual(trace.flatMap((b) => (b.type === 'steer.queued' || b.type === 'steer.delivered' ? [b.type] : [])), ['steer.queued', 'steer.delivered']);
    await assert.rejects(studio.steerTask(OWNER, task.id, 'too late'), /nothing to steer/);
    await assert.rejects(studio.steerTask({ type: 'agent', taskId: task.id }, task.id, 'self'), /nothing to steer|only the owner/);

    // Time travel: one checkpoint before the task and one after each turn that changed files.
    const labels = studio.listCheckpoints(project.id).map((c) => c.label).reverse();
    assert.deepEqual(labels.map((l) => l.replace(/tsk_\w+/, 'tsk')), ['before build tsk', '1턴: write_file notes.md', '2턴: write_file notes.md']);
    const afterFirstTurn = studio.listCheckpoints(project.id).find((c) => c.label.startsWith('1턴'))!;
    const branch = await studio.forkCheckpoint(OWNER, project.id, afterFirstTurn.id);
    assert.match(branch, /^fork\/[a-z0-9_]{10}$/);
    assert.equal(await studio.forkCheckpoint(OWNER, project.id, afterFirstTurn.id), branch, 'forking the same point twice gives the same branch');
    assert.equal((await sandboxes.exec(project, `git show ${branch}:notes.md`)).stdout, 'v1\n', 'the fork holds the workspace as it was after turn one');
    assert.equal((await sandboxes.exec(project, `git show ${studio.getTask(task.id).branch}:notes.md`)).stdout, 'v2 with the button at the bottom\n', 'and the original line of work is untouched');

    // A new task can continue from the fork.
    const continued = await studio.submitTask(OWNER, { projectId: project.id, kind: 'build', prompt: 'Try another direction', baseBranch: branch }, 'desktop');
    for (let i = 0; i < 400 && !['succeeded', 'failed'].includes(studio.getTask(continued.id).state); i++) await sleep(20);
    assert.equal(studio.getTask(continued.id).state, 'succeeded', studio.getTask(continued.id).error ?? '');
    assert.equal((await sandboxes.exec(project, `git merge-base --is-ancestor ${branch} ${studio.getTask(continued.id).branch} && echo yes`)).stdout.trim(), 'yes');
  } finally {
    await d.cleanup();
  }
});

// ------------------------------------------------------------- PDF export

test('a compiled document prints to PDF with scripts and network off', async (t) => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true, timeout: 15_000 }).catch(() => null);
  if (!browser) return t.skip('headless Chrome cannot be launched here');
  const model = scripted([[say(CLEAN_DOC)]]);
  const d = await testDaemon({}, {
    anthropic: model.sdk,
    renderPdf: async (html) => {
      const context = await browser.newContext({ javaScriptEnabled: false, offline: true });
      const page = await context.newPage();
      await page.setContent(html, { waitUntil: 'load' });
      const pdf = await page.pdf({ format: 'A4', printBackground: true, preferCSSPageSize: true });
      await context.close();
      return pdf;
    },
  });
  await d.daemon.start();
  try {
    const job = await d.daemon.studio.compileDocument(OWNER, { title: 'AI 인프라 투자 브리핑', kind: 'report', brief: '3분기 투자 규모를 한 장으로' }, 'desktop');
    await d.daemon.knowledge.idle();
    assert.equal(d.daemon.studio.getKnowledge(job.id).job.state, 'succeeded');
    const html = documentHtml('t', '<script>document.title="ran"</script>\n\n## 결론\n\n본문');
    assert.match(html, /<h2>결론<\/h2>/);
    const artifactId = await d.daemon.studio.exportDocument(job.id);
    const artifact = d.daemon.store.getArtifact(artifactId)!;
    assert.equal(artifact.mime, 'application/pdf');
    assert.ok(existsSync(artifact.file));
    assert.equal(readFileSync(artifact.file).subarray(0, 5).toString(), '%PDF-');
  } finally {
    await d.cleanup();
    await browser.close();
  }
});
