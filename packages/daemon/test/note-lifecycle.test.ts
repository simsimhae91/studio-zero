// What a person expects of a thing they made: a work note can be renamed, put away and brought back, deleted,
// and stopped while it is thinking; a research or document job can be stopped, and a failed one run again.
// The model is scripted; the daemon, its store and its events are real.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type Anthropic from '@anthropic-ai/sdk';
import { testDaemon } from './helpers.ts';

const OWNER = { type: 'owner', via: 'desktop' } as const;
const base = { id: 'msg', type: 'message', role: 'assistant', model: 'claude-fable-5-2', stop_details: null, stop_sequence: null, usage: { input_tokens: 30, output_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } };
const done = { finalMessage: async () => ({ ...base, content: [{ type: 'text', text: '', citations: null }], stop_reason: 'end_turn' }) };
/** A model that answers at once, or (`hang`) one that never answers until it is aborted. */
/** Lets go of whatever a test left hanging on the model that never answers, so the daemon can shut down. */
function release(daemon: Awaited<ReturnType<typeof testDaemon>>['daemon']): void {
  for (const pad of [...daemon.studio.listScratchpads(), ...daemon.studio.listScratchpads(true)]) daemon.studio.stopScratchpad(pad.id);
  for (const job of daemon.studio.listKnowledge()) if (job.state === 'running') daemon.knowledge.cancel(job.id);
}

function model(mode: { hang: boolean }): Anthropic {
  return {
    beta: {
      messages: {
        stream: (_params: unknown, opts?: { signal?: AbortSignal }) =>
          mode.hang
            ? {
                // As the SDK does: refuse at once when already aborted, otherwise when the abort comes.
                finalMessage: () =>
                  new Promise((_resolve, reject) => {
                    const refuse = (): void => reject(new Error('Request was aborted.'));
                    if (opts?.signal?.aborted) refuse();
                    else opts?.signal?.addEventListener('abort', refuse, { once: true });
                  }),
              }
            : done,
        parse: async () => ({ ...base, content: [], stop_reason: 'end_turn', parsed_output: {} }),
      },
    },
  } as unknown as Anthropic;
}

test('a note can be renamed, put away and brought back, and deleted with everything it holds', async () => {
  const d = await testDaemon({}, { anthropic: model({ hang: false }) });
  try {
    const { studio, store, scratch, events } = d.daemon;
    const pad = await studio.createScratchpad(OWNER, { opening: '현장 기사가 쓰는 청구서 앱을 생각 중인데 어디서부터 정해야 할지 모르겠다', mode: 'think' }, 'desktop');
    await scratch.idle();
    assert.ok(store.listScratchEntries(pad.id).length > 0);

    assert.equal(studio.renameScratchpad(pad.id, '  현장 청구서 앱  ').title, '현장 청구서 앱');
    assert.equal(studio.listScratchpads()[0]!.title, '현장 청구서 앱');

    // Put away: out of the list in use, and in the list of what was put away. Never in both.
    assert.equal(studio.archiveScratchpad(pad.id).state, 'archived');
    assert.deepEqual([studio.listScratchpads().length, studio.listScratchpads(true).map((p) => p.id)], [0, [pad.id]]);
    assert.equal(studio.restoreScratchpad(pad.id).state, 'exploring', 'a note that comes back can be talked to again');
    assert.deepEqual([studio.listScratchpads().map((p) => p.id), studio.listScratchpads(true).length], [[pad.id], 0]);
    assert.throws(() => studio.restoreScratchpad(pad.id), /보관한 노트가 아닙니다/);
    // A note that was handed off and has no project (a published document) is as removable as any other.
    store.updateScratchpad(pad.id, { state: 'promoted' }, Date.now());
    assert.equal(studio.archiveScratchpad(pad.id).state, 'archived');
    studio.restoreScratchpad(pad.id);

    studio.deleteScratchpad(pad.id);
    assert.deepEqual([studio.listScratchpads().length, studio.listScratchpads(true).length, store.listScratchEntries(pad.id).length, store.getScratchpad(pad.id)], [0, 0, 0, null], 'gone, with its conversation');
    assert.throws(() => studio.deleteScratchpad(pad.id), /scratchpad/);
    const changes = events.history({}, 0, 500).flatMap((e) => (e.body.type === 'scratch.changed' ? [e.body.change] : []));
    assert.deepEqual(changes, ['renamed', 'deleted'], 'lists of notes are told');
  } finally {
    release(d.daemon);
    await d.cleanup();
  }
});

test('a note that is thinking can be stopped, and is not deleted from under its own turn', async () => {
  const d = await testDaemon({}, { anthropic: model({ hang: true }) });
  try {
    const { studio, scratch, events } = d.daemon;
    const pad = await studio.createScratchpad(OWNER, { opening: '두 사람이 2주 동안 같이 하는 식단 기록을 어떻게 시작하게 할지', mode: 'think' }, 'desktop');
    assert.equal(studio.scratchView(pad.id).thinking, true);
    assert.throws(() => studio.deleteScratchpad(pad.id), /아직 생각하는 중인 노트입니다/);

    assert.equal(studio.stopScratchpad(pad.id), true);
    await scratch.idle();
    assert.equal(studio.scratchView(pad.id).thinking, false);
    const thinking = events.history({}, 0, 500).flatMap((e) => (e.body.type === 'scratch.thinking' ? [[e.body.active, e.body.error]] : []));
    assert.deepEqual(thinking, [[true, null], [false, null]], 'stopping is not reported as a failure');
    assert.equal(studio.stopScratchpad(pad.id), false, 'nothing to stop twice');
    studio.deleteScratchpad(pad.id);
  } finally {
    release(d.daemon);
    await d.cleanup();
  }
});

test('a running document job can be stopped, its note is not deleted meanwhile, and a failed job can be run again', async () => {
  const d = await testDaemon({}, { anthropic: model({ hang: true }) });
  try {
    const { studio, knowledge } = d.daemon;
    const pad = await studio.createScratchpad(OWNER, { opening: '분기 인프라 투자 규모를 정리한 보고서를 써 줘', mode: 'document' }, 'desktop');
    const [job] = studio.listKnowledge();
    assert.ok(job && job.state === 'running' && job.scratchId === pad.id);
    assert.throws(() => studio.deleteScratchpad(pad.id), /조사나 문서 작업이 아직 진행 중입니다/);
    await assert.rejects(studio.retryKnowledge(OWNER, job.id), /실패한 작업만 다시 시도할 수 있습니다/);

    studio.cancelKnowledge(job.id);
    await knowledge.idle();
    const stopped = studio.getKnowledge(job.id).job;
    assert.deepEqual([stopped.state, stopped.error], ['failed', '중단했습니다.'], 'it says it was stopped, not that it broke');
    assert.throws(() => studio.cancelKnowledge(job.id), /진행 중인 작업이 아닙니다/);

    // Run again from what it was asked: a new job for the same note, with the failed one still on record.
    const again = await studio.retryKnowledge(OWNER, job.id);
    assert.deepEqual([again.id !== job.id, again.kind, again.title, again.scratchId, again.state], [true, 'document', job.title, pad.id, 'running']);
    assert.equal(studio.listKnowledge().length, 2);
    studio.cancelKnowledge(again.id);
    await knowledge.idle();
    studio.deleteScratchpad(pad.id);
    assert.equal(studio.getKnowledge(job.id).job.scratchId, null, 'the job stays on record without its note');
  } finally {
    release(d.daemon);
    await d.cleanup();
  }
});
