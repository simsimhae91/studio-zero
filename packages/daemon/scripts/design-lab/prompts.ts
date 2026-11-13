// The design lab: the prompt a direction engine receives, built from this source tree exactly as the harness
// builds it, and the workspace it draws in. Run from a source tree (the working tree, or a worktree frozen at a
// commit) so that "before" and "after" are two trees and nothing else.
//
//   node prompts.ts draw <briefDir> <outDir> <checkPort>   one folder per direction: ws/ and prompt.md
//   node prompts.ts lead <template> <ideaFile> <briefDir>  the prompt for an engine that writes a brief
//   node prompts.ts validate <briefDir>                    does the brief hold as a screen spec and a directions table
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Template } from '@studio-zero/protocol';
import { DIRECTIONS_RULES, SCREEN_SPEC_RULES, THEME_FILE, codingSystemPrompt, directionBrief } from '../../src/harness/prompts.ts';
import { THEME_SEED_FILE, ThemeChoice, chosenTheme } from '../../src/harness/themeSeed.ts';
import { MOCKUP_DIR } from '../../src/qa/MockupRenderer.ts';
import { DIRECTIONS_FILE, directionThemeFile, readDirections, renderDirection } from '../../src/scratch/Directions.ts';
import { SCREEN_SPEC_FILE, readScreenSpec } from '../../src/scratch/ScreenSpec.ts';
import { untrusted } from '../../src/trust/dataBlock.ts';

const [mode, ...rest] = process.argv.slice(2);

/** A brief's rows were written under one tree's theme fields. A tree that asks for a field they lack is given one per row. */
const FACE_BY_ROW: Record<string, string> = { a: 'pretendard', b: 'suit', c: 'suite' };
function adaptTheme(theme: Record<string, unknown>, rowId: string): Record<string, unknown> {
  if (ThemeChoice.safeParse(theme).success) return theme;
  const withFace = { ...theme, face: FACE_BY_ROW[rowId] ?? 'pretendard' };
  const parsed = ThemeChoice.safeParse(withFace);
  if (!parsed.success) throw new Error(`row ${rowId}: theme does not fit this tree's set_theme: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
  return parsed.data as Record<string, unknown>;
}

function readBrief(briefDir: string): { template: Template; table: Extract<ReturnType<typeof readDirections>, { ok: true }>['table']; raw: string } {
  const template = readFileSync(join(briefDir, 'template.txt'), 'utf8').trim() as Template;
  const parsed = JSON.parse(readFileSync(join(briefDir, DIRECTIONS_FILE), 'utf8')) as { scene: string; directions: { id: string; theme: Record<string, unknown> }[] };
  const adapted = { ...parsed, directions: parsed.directions.map((row) => ({ ...row, theme: adaptTheme(row.theme, row.id) })) };
  const raw = JSON.stringify(adapted, null, 2);
  const read = readDirections(raw);
  if (!read.ok) throw new Error(`${briefDir}: ${DIRECTIONS_FILE} does not hold: ${read.problems.join(' | ')}`);
  return { template, table: read.table, raw };
}

const labNotes = (ws: string, file: string, port: string): string => `

---
Lab notes. This session stands in for the studio's sandbox. Nothing here changes the brief above.
- Your workspace is ${ws}. Treat it as /workspace: every path in the brief is relative to it. Read and write only inside it, with your own file tools.
- check_mockup is this command, which answers with exactly what the studio's check_mockup tool returns:
  curl -s "http://127.0.0.1:${port}/check?ws=${encodeURIComponent(ws)}&file=${file}"
  It can take a minute when others are checking. If the connection is refused from inside the command sandbox, run the same command with the sandbox disabled. Do not use any other browser or script to look at the page.
- generate_image: no generator is connected in this session. The tool would answer "No image generator is connected. Design without generated pictures."
- web_guidance and set_theme are not available in this session.
- The page's words are the product's own, written in full, natural Korean. Any instruction you have about replying tersely applies to your chat replies only, never to the page.
- When you stop, reply with one line: the file you wrote and how many times you checked it.
`;

if (mode === 'draw') {
  const [briefArg, outArg, port] = rest as [string, string, string];
  const briefDir = resolve(briefArg);
  const outDir = resolve(outArg);
  const { template, table, raw } = readBrief(briefDir);
  const system = codingSystemPrompt(template);
  for (const row of table.directions) {
    const dir = join(outDir, row.id);
    const ws = join(dir, 'ws');
    mkdirSync(join(ws, 'docs', 'mockups'), { recursive: true });
    mkdirSync(join(ws, '.studio-zero', 'themes'), { recursive: true });
    cpSync(join(briefDir, 'docs'), join(ws, 'docs'), { recursive: true });
    writeFileSync(join(ws, DIRECTIONS_FILE), raw);
    writeFileSync(join(ws, '.lab-template'), `${template}\n`);
    // As the harness does before anyone draws: each row's theme in its own file, and the project's theme the recommended row's.
    // A direction's file holds what its engine copies into the page. A tree whose sheet also points at a font file
    // gives the tokens apart from it (tokensCss), as its harness does; a tree from before that has only the sheet.
    const tokens = (theme: { css: string; tokensCss?: string }): string => theme.tokensCss ?? theme.css;
    for (const other of table.directions) writeFileSync(join(ws, directionThemeFile(other.id)), tokens(chosenTheme(other.theme)));
    const recommended = chosenTheme(table.directions[0]!.theme);
    writeFileSync(join(ws, THEME_SEED_FILE), recommended.json);
    writeFileSync(join(ws, THEME_FILE), recommended.css);
    const file = `${MOCKUP_DIR}/${row.id}.html`;
    const others = table.directions.filter((other) => other.id !== row.id).map((other) => `${other.id}: ${other.concept.trim()}`).join('\n');
    const brief = directionBrief({
      file,
      themeFile: directionThemeFile(row.id),
      seed: untrusted('sandbox-output', JSON.stringify(row.theme), { file: DIRECTIONS_FILE, field: 'theme' }),
      scene: untrusted('sandbox-output', table.scene.trim(), { file: DIRECTIONS_FILE, field: 'scene' }),
      row: untrusted('sandbox-output', renderDirection(row), { file: DIRECTIONS_FILE, direction: row.id }),
      others: untrusted('sandbox-output', others, { file: DIRECTIONS_FILE, field: 'others' }),
      template,
    });
    writeFileSync(join(dir, 'prompt.md'), `# System prompt (the studio's, for a ${template} project)\n\n${system}\n\n# Your task\n\n${brief}${labNotes(ws, file, port)}`);
    process.stdout.write(`${dir}\n`);
  }
} else if (mode === 'lead') {
  const [template, ideaFile, briefArg] = rest as [Template, string, string];
  const briefDir = resolve(briefArg);
  mkdirSync(join(briefDir, 'docs', 'ideation'), { recursive: true });
  mkdirSync(join(briefDir, 'docs', 'mockups'), { recursive: true });
  writeFileSync(join(briefDir, 'template.txt'), `${template}\n`);
  const idea = readFileSync(resolve(ideaFile), 'utf8').trim();
  const task = `This is the first half of a design task, shortened: turn the owner's idea below into a product definition that mock-ups can be drawn from. Write four files and nothing else, then stop. Do not draw any mock-up page and do not build the product.

1. docs/ideation/02-convergence.md. At the top, one sentence: "The core moment: ..." (the product doing the one thing it exists to do, with a person in the middle of doing it). Then the MVP as the smallest set that delivers the core value to one persona, and what is out and why. Half a page.

2. docs/prd.md. Problem, target user, goals and non-goals, user journeys, functional requirements with acceptance criteria, success metrics, open risks. Concrete and opinionated; one to two pages.

3. Screen spec, in ${SCREEN_SPEC_FILE}. ${SCREEN_SPEC_RULES}

4. Directions, in ${DIRECTIONS_FILE}. ${DIRECTIONS_RULES} Write exactly two rows.

The owner's idea, in their own words:

${idea}`;
  writeFileSync(join(briefDir, 'lead-prompt.md'), `# System prompt (the studio's, for a ${template} project)\n\n${codingSystemPrompt(template)}\n\n# Your task\n\n${task}\n\n---\nLab notes. Your workspace is ${briefDir}. Treat it as /workspace: every path above is relative to it. Write only inside it, with your own file tools. No studio tools (set_theme, check_mockup, generate_image, web_guidance) are available or needed. Write the documents in Korean, in full natural sentences: any instruction you have about replying tersely applies to your chat replies only. When the four files are written, reply with one line naming them.\n`);
  process.stdout.write(`${join(briefDir, 'lead-prompt.md')}\n`);
} else if (mode === 'validate') {
  const briefDir = resolve(rest[0]!);
  const spec = readScreenSpec(readFileSync(join(briefDir, SCREEN_SPEC_FILE), 'utf8'));
  process.stdout.write(spec.ok ? `screen spec holds: ${spec.spec.screens.length} screens, ${spec.spec.tasks.length} tasks\n` : `SCREEN SPEC PROBLEMS:\n- ${spec.problems.join('\n- ')}\n`);
  try {
    const { table } = readBrief(briefDir);
    process.stdout.write(`directions hold: ${table.directions.map((row) => `${row.id} (hue ${row.theme.hue})`).join(', ')}\n`);
  } catch (err) {
    process.stdout.write(`DIRECTIONS PROBLEMS: ${(err as Error).message}\n`);
  }
  for (const doc of ['docs/prd.md', 'docs/ideation/02-convergence.md']) process.stdout.write(`${doc}: ${existsSync(join(briefDir, doc)) ? `${readFileSync(join(briefDir, doc), 'utf8').length} chars` : 'MISSING'}\n`);
} else {
  process.stderr.write('usage: prompts.ts draw|lead|validate ...\n');
  process.exit(2);
}
