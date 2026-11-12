import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveChoice } from '../src/lib/engineChoice.ts';

const engines = [{ id: 'claude-code', available: true }, { id: 'codex', available: false }];
const models = [{ id: 'opus', label: 'Claude Opus' }, { id: 'haiku', label: 'Claude Haiku' }];

test('a remembered pick: sent as made while the lists are on their way, dropped once a list says it is not there', () => {
  assert.deepEqual(resolveChoice({ engine: 'auto', model: 'default' }, engines, undefined), { engine: null, model: null, modelLabel: null });
  assert.deepEqual(resolveChoice({ engine: 'claude-code', model: 'haiku' }, engines, models), { engine: 'claude-code', model: 'haiku', modelLabel: 'Claude Haiku' });
  assert.deepEqual(resolveChoice({ engine: 'claude-code', model: 'default' }, engines, models), { engine: 'claude-code', model: null, modelLabel: null });

  // Nothing has arrived yet (the app has just opened): a task sent now still goes where the owner had pointed.
  assert.deepEqual(resolveChoice({ engine: 'claude-code', model: 'haiku' }, undefined, undefined), { engine: 'claude-code', model: 'haiku', modelLabel: 'haiku' });
  assert.deepEqual(resolveChoice({ engine: 'claude-code', model: 'haiku' }, engines, undefined), { engine: 'claude-code', model: 'haiku', modelLabel: 'haiku' }, 'the list of models takes seconds on some CLIs');

  // The lists are here and say otherwise: what is shown is what is sent.
  assert.deepEqual(resolveChoice({ engine: 'claude-code', model: 'sonnet-9' }, engines, models), { engine: 'claude-code', model: null, modelLabel: null }, 'a model the vendor no longer lists');
  assert.deepEqual(resolveChoice({ engine: 'codex', model: 'gpt-5.6-sol' }, engines, undefined), { engine: null, model: null, modelLabel: null }, 'an engine that cannot run now takes its model with it');
  assert.deepEqual(resolveChoice({ engine: 'cursor', model: 'composer-2.5' }, engines, undefined), { engine: null, model: null, modelLabel: null }, 'an engine the daemon does not list');

  // Whatever is in storage is not trusted to be a choice.
  assert.deepEqual(resolveChoice({ engine: 'rm -rf', model: 'x' }, undefined, undefined), { engine: null, model: null, modelLabel: null });
  assert.deepEqual(resolveChoice({ engine: 'claude-code', model: '--dangerously-skip-permissions' }, undefined, undefined), { engine: 'claude-code', model: null, modelLabel: null });
});
