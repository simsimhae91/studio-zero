import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { build } from 'esbuild';
import { AX_DIR, forBundlers, kitFiles } from '../src/harness/axKit.ts';
import { codingSystemPrompt } from '../src/harness/prompts.ts';
import { sampleProject, tempDir, testDaemon } from './helpers.ts';

test('the AX kit as a project receives it: complete, extensionless, and it bundles with only react and zod outside', async () => {
  const files = await kitFiles();
  assert.deepEqual(files.map((f) => f.path), ['README.md', 'blocks.ts', 'index.ts', 'react/Blocks.tsx', 'react/Flow.tsx', 'react/Markdown.tsx', 'react/index.ts', 'react/useAgentStream.ts', 'stream.ts', 'telemetry.ts']);
  assert.equal(forBundlers(`import { a } from './stream.ts';\nexport * from "../blocks.ts";\nimport { B } from './Blocks.tsx';\nimport { z } from 'zod';\nconst s = './not-an-import.ts';`), `import { a } from './stream';\nexport * from "../blocks";\nimport { B } from './Blocks';\nimport { z } from 'zod';\nconst s = './not-an-import.ts';`);
  for (const file of files.filter((f) => !f.path.endsWith('.md'))) assert.doesNotMatch(file.content, /from\s+['"]\.{1,2}\/[^'"]+\.tsx?['"]/, file.path);

  // Built the way a scaffolded app would build it: from a plain folder, by a bundler.
  const out = tempDir('sz-kit-');
  try {
    for (const file of files) {
      mkdirSync(dirname(join(out.dir, file.path)), { recursive: true });
      writeFileSync(join(out.dir, file.path), file.content);
    }
    const result = await build({ absWorkingDir: out.dir, entryPoints: ['index.ts', 'react/index.ts'], bundle: true, write: false, format: 'esm', jsx: 'automatic', external: ['react', 'react/jsx-runtime', 'zod'], logLevel: 'silent', outdir: 'out', metafile: true });
    assert.equal(result.errors.length, 0);
    const imported = new Set(Object.values(result.metafile.outputs).flatMap((o) => o.imports.filter((i) => i.external).map((i) => i.path)));
    assert.deepEqual([...imported].sort(), ['react', 'react/jsx-runtime', 'zod']);
    const renderer = result.outputFiles.find((f) => f.path.endsWith('react/index.js'))!.text;
    assert.doesNotMatch(renderer, /dangerouslySetInnerHTML|innerHTML/, 'model output only ever becomes elements and text');
  } finally {
    out.cleanup();
  }
  assert.match(codingSystemPrompt('web-vite-react'), /The AX kit is already in \.studio-zero\/ax \(read its README\.md first/);
});

test('every provisioned project gets the kit once, in its first commit, and keeps its own copy after that', async () => {
  const d = await testDaemon();
  await d.daemon.start();
  try {
    const project = sampleProject();
    d.daemon.store.insertProject(project);
    await d.daemon.provisioner.ensure(project);
    const kit = join(d.workspace, AX_DIR);
    for (const path of ['index.ts', 'react/Blocks.tsx', 'README.md']) assert.ok(existsSync(join(kit, path)), path);
    assert.match(readFileSync(join(kit, 'index.ts'), 'utf8'), /export \* from '\.\/blocks';/);
    const log = async (): Promise<string> => (await d.daemon.sandboxes.exec(project, 'git log --format=%s')).stdout.trim();
    assert.match(await log(), /^chore: add Studio Zero theme, project file, AX kit and agent instructions\n/);
    assert.equal((await d.daemon.sandboxes.exec(project, 'git status --porcelain')).stdout, '');

    // The project changes its copy; provisioning again leaves it alone.
    writeFileSync(join(kit, 'index.ts'), '// ours now\n');
    await d.daemon.sandboxes.commitAll(project, 'feat: adapt the kit');
    await d.daemon.provisioner.ensure(project);
    assert.equal(readFileSync(join(kit, 'index.ts'), 'utf8'), '// ours now\n');
    assert.match(await log(), /^feat: adapt the kit\nchore: add Studio Zero theme/);
  } finally {
    await d.cleanup();
  }
});
