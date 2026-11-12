import assert from 'node:assert/strict';
import { test } from 'node:test';
import { elapsed } from '../src/lib/format.ts';

test('elapsed: how long a task ran, in whole units a person reads at a glance', () => {
  assert.equal(elapsed(0), '0초');
  assert.equal(elapsed(48_900), '48초');
  assert.equal(elapsed(60_000), '1분 0초');
  assert.equal(elapsed(12 * 60_000 + 3_999), '12분 3초');
  assert.equal(elapsed(59 * 60_000 + 59_999), '59분 59초', 'never "60초"');
  assert.equal(elapsed(87 * 60_000 + 30_000), '1시간 27분');
  assert.equal(elapsed(-5_000), '0초', 'a clock that runs behind the daemon\'s does not show a negative time');
});
