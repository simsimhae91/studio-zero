import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';
import { Secret } from '../src/util/core.ts';
import { runCommand } from '../src/util/run.ts';
import { KeychainVault } from '../src/vault/KeychainVault.ts';
import { tempDir } from './helpers.ts';

/**
 * Round trip against the real macOS Keychain, in a throwaway keychain file.
 *
 * Opt-in (`SZ_TEST_REAL_KEYCHAIN=1 pnpm test`) because `security create-keychain` adds the new keychain to your
 * keychain search list until `delete-keychain` removes it again. Your login keychain is never read or written.
 */
test('KeychainVault against the real security CLI', { skip: process.env.SZ_TEST_REAL_KEYCHAIN !== '1' && 'set SZ_TEST_REAL_KEYCHAIN=1 to run' }, async () => {
  const tmp = tempDir('sz-kc-');
  const keychain = join(tmp.dir, 'studio-zero-test.keychain-db');
  const security = (...args: string[]) => runCommand('/usr/bin/security', args, { timeoutMs: 15_000 });
  assert.equal((await security('create-keychain', '-p', 'test-only', keychain)).exitCode, 0);
  try {
    await security('unlock-keychain', '-p', 'test-only', keychain);
    const vault = new KeychainVault({ service: 'studio-zero-test', keychain });
    const value = 'sk-ant-api03-한글 "quotes" $(subshell) `ticks` \\ backslash\ttab';

    assert.equal(await vault.get('provider/anthropic/api-key'), null);
    await vault.set('provider/anthropic/api-key', new Secret(value));
    assert.equal((await vault.get('provider/anthropic/api-key'))?.expose(), value);

    await vault.set('provider/anthropic/api-key', new Secret('rotated'));
    assert.equal((await vault.get('provider/anthropic/api-key'))?.expose(), 'rotated', '-U updates in place');

    assert.equal(await vault.delete('provider/anthropic/api-key'), true);
    assert.equal(await vault.delete('provider/anthropic/api-key'), false);
    assert.equal(await vault.get('provider/anthropic/api-key'), null);
  } finally {
    await security('delete-keychain', keychain);
    tmp.cleanup();
  }
});
