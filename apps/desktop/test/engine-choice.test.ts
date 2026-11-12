import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveChoice, type EngineCatalog } from '../src/lib/engineChoice.ts';

const engines = [{ id: 'claude-code', available: true }, { id: 'cursor', available: true }, { id: 'codex', available: false }];
const claude: EngineCatalog = { models: [{ id: 'opus', label: 'Claude Opus' }, { id: 'haiku', label: 'Claude Haiku' }], efforts: ['low', 'medium', 'high', 'xhigh', 'max'] };
const cursor: EngineCatalog = { models: [{ id: 'composer-2.5', label: 'Composer 2.5' }], efforts: [] };
const none = { model: null, modelLabel: null, effort: null };

test('a remembered pick: sent as made while the lists are on their way, dropped once a list says it is not there', () => {
  assert.deepEqual(resolveChoice({ engine: 'auto', model: 'default', effort: 'default' }, engines, undefined), { engine: null, ...none });
  assert.deepEqual(resolveChoice({ engine: 'claude-code', model: 'haiku', effort: 'max' }, engines, claude), { engine: 'claude-code', model: 'haiku', modelLabel: 'Claude Haiku', effort: 'max' });
  assert.deepEqual(resolveChoice({ engine: 'claude-code', model: 'default', effort: 'default' }, engines, claude), { engine: 'claude-code', ...none });

  // Nothing has arrived yet (the app has just opened): a task sent now still goes where the owner had pointed.
  assert.deepEqual(resolveChoice({ engine: 'claude-code', model: 'haiku', effort: 'low' }, undefined, undefined), { engine: 'claude-code', model: 'haiku', modelLabel: 'haiku', effort: 'low' });
  assert.deepEqual(resolveChoice({ engine: 'claude-code', model: 'haiku', effort: 'low' }, engines, undefined), { engine: 'claude-code', model: 'haiku', modelLabel: 'haiku', effort: 'low' }, 'what an engine offers takes seconds to read on some CLIs');

  // The lists are here and say otherwise: what is shown is what is sent.
  assert.deepEqual(resolveChoice({ engine: 'claude-code', model: 'sonnet-9', effort: 'high' }, engines, claude), { engine: 'claude-code', model: null, modelLabel: null, effort: 'high' }, 'a model the vendor no longer lists');
  assert.deepEqual(resolveChoice({ engine: 'codex', model: 'gpt-5.6-sol', effort: 'max' }, engines, undefined), { engine: null, ...none }, 'an engine that cannot run now takes its model and effort with it');
  assert.deepEqual(resolveChoice({ engine: 'antigravity', model: 'gemini-4-argon-high', effort: 'default' }, engines, undefined), { engine: null, ...none }, 'an engine the daemon does not list');
});

test('effort is a choice only where the engine has it as a setting, and it outlives a change of model', () => {
  // The level was picked on another engine; this one carries it in its model names.
  assert.deepEqual(resolveChoice({ engine: 'cursor', model: 'composer-2.5', effort: 'max' }, engines, cursor), { engine: 'cursor', model: 'composer-2.5', modelLabel: 'Composer 2.5', effort: null });
  assert.equal(resolveChoice({ engine: 'claude-code', model: 'default', effort: 'xhigh' }, engines, claude).effort, 'xhigh', 'the level stands whichever model runs');
  assert.equal(resolveChoice({ engine: 'auto', model: 'default', effort: 'max' }, engines, undefined).effort, null, 'with the engine left to the studio, so is the level');
});

test('whatever is in storage is not trusted to be a choice', () => {
  assert.deepEqual(resolveChoice({ engine: 'rm -rf', model: 'x', effort: 'max' }, undefined, undefined), { engine: null, ...none });
  assert.deepEqual(resolveChoice({ engine: 'claude-code', model: '--dangerously-skip-permissions', effort: 'ultra' }, undefined, undefined), { engine: 'claude-code', ...none });
});
