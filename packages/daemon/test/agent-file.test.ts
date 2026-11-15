// The note for whoever works on a project's repository outside the studio: a block of the repository's own
// AGENTS.md. It is replaced whole and nothing around it is touched.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isEmptyProject } from '../src/kirby/reader.ts';
import { AGENT_FILE, CLAUDE_FILE, agentBlock, claudeFile, hasBlock, isStudioNote, withBlock } from '../src/repo/agentFile.ts';
import { sampleProject, testDaemon } from './helpers.ts';

const OWNER = { type: 'owner', via: 'desktop' } as const;

test('the block says where the product is, how work is exchanged and what a walk needs, for the project it is written for', () => {
  const adopted = agentBlock({ slug: 'credeal', root: 'app', adopted: { path: '/Users/someone/credeal', base: 'main' } });
  assert.match(adopted, /project `credeal`/);
  assert.match(adopted, /\*\*Where the product is\.\*\* In `app\/`/);
  assert.match(adopted, /`app\/docs\/screens\.json`, when it is there, is the plan/);
  assert.match(adopted, /`git push studio <branch>`[^\n]*`main` moves forward only/);
  assert.match(adopted, /dataSet=\{\{ step: 'S:k' \}\}/);
  assert.match(adopted, /built elsewhere and brought in/);
  assert.ok(!adopted.includes('supabase/'), 'the house\'s backend is not this product\'s');
  assert.match(adopted, /sz check credeal/);

  const house = agentBlock(sampleProject('ledger'));
  assert.ok(!house.includes('Where the product is'), 'at the root there is nothing to say');
  assert.match(house, /`docs\/screens\.json`, when it is there/);
  assert.match(house, /supabase\/migrations\//);
  assert.ok(!house.includes('built elsewhere'));
  // No dash of the kind the house does not write, in either.
  for (const text of [adopted, house]) assert.ok(!/[–—]/.test(text));
});

test('the block is added after what a file says, replaced whole when it is there, and nothing else is touched', () => {
  const block = agentBlock(sampleProject('ledger'));
  assert.equal(withBlock('', block), block);
  const theirs = 'This is an Expo app.\n\n## Commands\n\nnpx expo start\n';
  const added = withBlock(theirs, block);
  assert.ok(added.startsWith('This is an Expo app.\n\n## Commands\n\nnpx expo start\n\n<!-- studio-zero:begin'));
  assert.ok(hasBlock(added) && !hasBlock(theirs));
  // Written again for a project that changed (its folder), with the owner's own lines above and below it kept.
  const edited = `${added}\n## Our own rules\n\nNo default exports.\n`;
  const again = withBlock(edited, agentBlock({ ...sampleProject('ledger'), root: 'app' }));
  assert.equal(again.match(/studio-zero:begin/g)?.length, 1);
  assert.match(again, /In `app\/`/);
  assert.ok(again.startsWith('This is an Expo app.') && again.endsWith('## Our own rules\n\nNo default exports.\n'));
  // A replacement string is text, whatever it holds.
  assert.ok(withBlock(added, 'a $& b $1\n').includes('a $& b $1'));

  assert.equal(claudeFile(null), '@AGENTS.md\n');
  assert.equal(claudeFile('  \n'), '@AGENTS.md\n');
  assert.equal(claudeFile('Read AGENTS.md first.\n'), null, 'one that already points there is left alone');
  assert.equal(claudeFile('# Notes\n\nUse pnpm.\n'), '# Notes\n\nUse pnpm.\n\n@AGENTS.md\n');
});

test('the studio\'s own note is not what a project has in it', () => {
  const block = agentBlock(sampleProject('ledger'));
  assert.equal(isStudioNote(AGENT_FILE, block), true);
  assert.equal(isStudioNote(AGENT_FILE, `Our rules.\n\n${block}`), false, 'the owner wrote in it');
  assert.equal(isStudioNote(CLAUDE_FILE, '@AGENTS.md\n'), true);
  assert.equal(isStudioNote(CLAUDE_FILE, '# Notes\n\n@AGENTS.md\n'), false);
  assert.equal(isStudioNote('src/AGENTS.md', block), false);
  const file = (path: string, content: string) => ({ path, content, size: content.length }) as never;
  assert.equal(isEmptyProject([file('.studio-zero/theme.css', 'x'), file(AGENT_FILE, block), file(CLAUDE_FILE, '@AGENTS.md\n')]), true);
  assert.equal(isEmptyProject([file(AGENT_FILE, block), file('src/main.tsx', 'x')]), false);
});

test('a project the studio starts gets the note with its other studio files, once', async () => {
  const d = await testDaemon();
  try {
    const { studio, sandboxes } = d.daemon;
    const project = await studio.createProjectAndProvision(OWNER, { name: 'Ledger', slug: 'ledger', template: 'web-vite-react' });
    const agents = (await sandboxes.readFile(project, AGENT_FILE)).content;
    assert.ok(hasBlock(agents));
    assert.match(agents, /project `ledger`/);
    assert.equal((await sandboxes.readFile(project, CLAUDE_FILE)).content, '@AGENTS.md\n');
    const log = async (): Promise<string> => (await sandboxes.exec(project, 'git log --format=%s')).stdout.trim();
    assert.equal((await sandboxes.exec(project, 'git status --porcelain')).stdout.trim(), '', 'committed with the rest');
    const before = await log();
    await d.daemon.provisioner.ensure(project);
    assert.equal(await log(), before, 'a second look writes nothing');
    // An engine that scaffolds over it (a template with an AGENTS.md of its own) does not lose the note for long.
    await sandboxes.writeFile(project, AGENT_FILE, 'This is a Vite app.\n');
    await d.daemon.provisioner.ensure(project);
    const healed = (await sandboxes.readFile(project, AGENT_FILE)).content;
    assert.ok(healed.startsWith('This is a Vite app.\n') && hasBlock(healed));
  } finally {
    await d.cleanup();
  }
});
