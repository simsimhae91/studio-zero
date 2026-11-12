// Production bundle of the daemon. Development runs the TypeScript sources directly (no build step); this
// exists because a process that never has to strip types at runtime idles about 25 MB lighter, which matters
// for something meant to run around the clock.
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { cpSync, rmSync } from 'node:fs';
import { basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const daemon = fileURLToPath(new URL('../packages/daemon/', import.meta.url));
rmSync(`${daemon}dist`, { recursive: true, force: true });

await build({
  absWorkingDir: daemon,
  entryPoints: { daemon: 'src/main.ts', sz: 'src/cli.ts', mcpShim: 'src/bridge/mcpShim.ts' },
  outdir: 'dist',
  outExtension: { '.js': '.mjs' },
  bundle: true,
  splitting: true, // keeps dynamic imports (Kirby's analyser) as separate chunks, loaded on demand
  format: 'esm',
  platform: 'node',
  target: 'node24',
  // Resolved from packages/daemon/node_modules at runtime. The first three are deliberately loaded lazily.
  external: ['playwright-core', 'typescript-classic', '@anthropic-ai/sdk', '@anthropic-ai/sdk/*', 'fastify', '@fastify/websocket', 'pino'],
  legalComments: 'none',
  logLevel: 'info',
});

// The AX kit is written into every project the daemon provisions, as source: ship it beside the bundle.
// The mobile kit goes the same way into every mobile project.
cpSync(fileURLToPath(new URL('../packages/ax/src/', import.meta.url)), `${daemon}dist/ax-kit`, { recursive: true, filter: (src) => !basename(src).startsWith('.') });
cpSync(fileURLToPath(new URL('../packages/design/src/mobile/', import.meta.url)), `${daemon}dist/mobile-kit`, { recursive: true, filter: (src) => !basename(src).startsWith('.') });

// A daemon started from the previous bundle still holds its main chunk in memory but loads the rest on demand,
// from files this build has just replaced. If the LaunchAgent is loaded, say so instead of leaving it half-stale.
try {
  execFileSync('launchctl', ['print', `gui/${process.getuid()}/zero.studio.daemon`], { stdio: 'ignore' });
  console.log('\nThe Studio Zero LaunchAgent is running the old bundle. Restart it:  pnpm daemon:restart');
} catch {
  // Not installed as a LaunchAgent (or not macOS): nothing to restart.
}
