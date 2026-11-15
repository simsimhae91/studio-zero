import { isAdopted, rootOf, type Project } from '@studio-zero/protocol';
import { SCREEN_DOC_FILE, SCREEN_SPEC_FILE } from '../scratch/ScreenSpec.ts';

/** The file agents of every vendor read at the root of a repository, and the one Claude Code reads. */
export const AGENT_FILE = 'AGENTS.md';
export const CLAUDE_FILE = 'CLAUDE.md';

const BEGIN = '<!-- studio-zero:begin (written by Studio Zero; write outside this block, it is replaced whole) -->';
const END = '<!-- studio-zero:end -->';
const BLOCK = /<!-- studio-zero:begin[^\n]*-->[\s\S]*?<!-- studio-zero:end -->\n?/;

/**
 * What a session that works on a project's repository from outside the studio has to know to keep the
 * studio's contract: an agent in the owner's IDE, on a clone of the repository. It is a block of the
 * repository's own AGENTS.md, so it travels with the code and is read without anyone pointing at it.
 *
 * Only what holds for as long as the project does: where the product is, how work is exchanged, what the walk
 * needs of a screen and what is measured on it. Nothing that changes from one commit to the next.
 */
export function agentBlock(project: Pick<Project, 'slug' | 'root' | 'adopted'>): string {
  const root = rootOf(project);
  const at = (file: string): string => (root === '' ? file : `${root}/${file}`);
  const lines = [
    BEGIN,
    '## Studio Zero',
    '',
    `This repository is also worked on by Studio Zero (project \`${project.slug}\`), a studio on the owner's Mac that builds this product in a sandbox, walks it in a browser as its users would, and measures every screen it stands on. You are working on a clone of it. Keep to the following so that what you change still passes there.`,
    '',
    '**Exchanging work.** The studio and this clone meet at the git remote `studio`, and only there.',
    '- `git fetch studio` gets the studio\'s work: its main is `studio/main`, and each task\'s branch is `studio/sz/<task id>`.',
    '- `git push studio <branch>` hands a branch to the studio. `main` moves forward only: when a push to it is refused, fetch, put your commits on top of `studio/main`, and push again. Do not force it.',
    '- After a push to main the studio walks the whole product and records what it measures, so a defect you bring is found there and named as yours.',
    '',
    ...(root === '' ? [] : [`**Where the product is.** In \`${root}/\`. The paths below are from the repository's root.`, '']),
    `**The screen plan.** \`${at(SCREEN_SPEC_FILE)}\`, when it is there, is the plan the studio walks the product by: its screens, and its scenarios as steps a browser carries out.`,
    '- The root of every screen carries `data-screen` with its id in the plan (`data-screen="H-01"`). The control for press k of step S carries `data-step="S:k"`, and what is on screen only once the step\'s outcome is true carries `data-done="S"`. In React Native these are `dataSet={{ screen: \'H-01\' }}`, `dataSet={{ step: \'S:k\' }}` and `dataSet={{ done: \'S\' }}`. A field the walk fills carries `data-sample` with what a person would type.',
    '- A control you move keeps its mark. A control you replace hands its mark on. A screen or a step you add is added to the plan in the same commit, with its marks; one you remove is removed from it.',
    `- \`${at(SCREEN_DOC_FILE)}\` is written from the plan by the studio. Do not edit it.`,
    '',
    '**What is measured on every screen.** Text contrast, touch targets of 44px, nothing cut off, nothing that scrolls sideways, a button\'s or a tab\'s label on one line. Look at a screen in the state your change shows in, not only as it opens.',
    '',
    ...(isAdopted(project)
      ? ['**This product was built elsewhere and brought in.** Its stack, its structure and its design are its own, and the studio does not replace them. Neither should you, unless that is what you were asked.', '']
      : [
          '**The backend** is this project\'s own Supabase, run by the studio. The schema is `supabase/migrations/`: a migration that has been applied is never edited, a change is a new file numbered after the last. Rows a person made are closed to everyone else by row level security.',
          '**Generated files.** `.studio-zero/theme.css` is generated from `.studio-zero/theme.json`: change the look through the seed, never the sheet. `.env.local` is this machine\'s and is not committed.',
          '',
        ]),
    `**Asking the studio.** From the owner's Mac: \`sz check ${project.slug}\` walks all of main with no engine and says what it finds; \`sz edit ${project.slug} "<what to change>"\` has the studio make a small change, check the screens it touches and put it on main; \`sz repo ${project.slug}\` shows the branches.`,
    END,
  ];
  return `${lines.join('\n')}\n`;
}

/**
 * A file with the studio's block in it: the block that is there replaced, or the block added after what the
 * file already says. Everything outside the block is the repository's own and is kept as it is.
 */
export function withBlock(existing: string, block: string): string {
  if (BLOCK.test(existing)) return existing.replace(BLOCK, () => block);
  const before = existing.trimEnd();
  return before === '' ? block : `${before}\n\n${block}`;
}

/** Whether a file already carries the studio's block. */
export const hasBlock = (text: string): boolean => BLOCK.test(text);

/**
 * CLAUDE.md as it has to be for Claude Code to read the block: a file that brings AGENTS.md in. One that
 * already speaks of AGENTS.md is left alone (null: nothing to write).
 */
export function claudeFile(existing: string | null): string | null {
  if (existing === null || existing.trim() === '') return `@${AGENT_FILE}\n`;
  if (existing.includes(AGENT_FILE)) return null;
  return `${existing.trimEnd()}\n\n@${AGENT_FILE}\n`;
}

/**
 * Whether a file at a repository's root is one the studio wrote and nobody added to: AGENTS.md that holds its
 * block and nothing else, or the CLAUDE.md that only brings it in. Such a file says nothing of what a project
 * has in it: a project with these and no code is still an empty project.
 */
export function isStudioNote(path: string, content: string | null): boolean {
  if (content === null) return false;
  if (path === AGENT_FILE) return hasBlock(content) && content.replace(BLOCK, '').trim() === '';
  if (path === CLAUDE_FILE) return content.trim() === `@${AGENT_FILE}`;
  return false;
}
