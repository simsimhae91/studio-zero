import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { SZ_DIR, type Contract } from './contract.ts';

/**
 * What is known and not yet done: what a verifier noticed outside its contract, what could not be checked, what
 * a look over the product found, what the owner wrote down. A plain list the owner can read and edit by hand;
 * the next piece of work is picked from it instead of from nowhere.
 */
export const BACKLOG_FILE = `${SZ_DIR}/backlog.md`;

const HEAD = `# 남은 일

일하다 눈에 띈 것, 확인하지 못한 것, 돌보다 찾은 것, 주인이 적어 둔 것. 한 줄에 하나.
끝난 줄은 \`[x]\`로 바꾸고 무엇으로 끝났는지(계약이나 커밋) 뒤에 적는다. 하지 않기로 한 줄은 지운다.

`;

const oneLine = (text: string): string => text.replace(/\s+/g, ' ').trim();
const OPEN = /^\s*- \[ \] /;

/** Adds lines that are not there yet (by their words). Says how many were added. */
export function addToBacklog(projectDir: string, items: { text: string; from: string }[]): number {
  const file = join(projectDir, BACKLOG_FILE);
  let body = existsSync(file) ? readFileSync(file, 'utf8') : HEAD;
  let added = 0;
  for (const item of items) {
    const text = oneLine(item.text);
    // The same words on a line that is still open: already there. A line that was ticked does not stop the
    // same thing being written again when it is seen again.
    const open = body.split('\n').filter((line) => OPEN.test(line)).map((line) => line.replace(OPEN, ''));
    if (text === '' || open.some((line) => line === text || line.startsWith(`${text} (`))) continue;
    body = `${body.replace(/\n*$/, '\n')}- [ ] ${text}${item.from ? ` (${oneLine(item.from)})` : ''}\n`;
    added++;
  }
  if (added > 0) {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, body);
  }
  return added;
}

/** The lines still open, in the order they are written. */
export function openBacklog(projectDir: string): string[] {
  const file = join(projectDir, BACKLOG_FILE);
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => OPEN.test(line))
    .map((line) => line.replace(OPEN, ''));
}

/**
 * Ticks the one open line that has these words and writes after it what ended it (a contract, a commit). Work
 * that resolves something the list already names says so here: a list nobody ticks stops being believed.
 */
export function doneInBacklog(projectDir: string, words: string, by: string): string {
  const file = join(projectDir, BACKLOG_FILE);
  const want = oneLine(words);
  const ended = oneLine(by);
  if (want === '') throw new Error('say which line: some of its words');
  if (ended === '') throw new Error('say what ended it: the contract or the commit');
  const lines = existsSync(file) ? readFileSync(file, 'utf8').split('\n') : [];
  const hits = lines.flatMap((line, at) => (OPEN.test(line) && oneLine(line.replace(OPEN, '')).includes(want) ? [{ at, text: oneLine(line.replace(OPEN, '')) }] : []));
  if (hits.length === 0) throw new Error(`no open line of ${BACKLOG_FILE} has the words "${want}"`);
  if (hits.length > 1) throw new Error(`${hits.length} open lines of ${BACKLOG_FILE} have the words "${want}": give more of the one you mean\n${hits.map((hit) => `  - ${hit.text}`).join('\n')}`);
  const hit = hits[0]!;
  lines[hit.at] = `- [x] ${hit.text} — 끝남: ${ended}`;
  writeFileSync(file, lines.join('\n'));
  return hit.text;
}

/** What closing a contract leaves for later: what was noticed outside it, and what nobody could show. */
export function leftBy(contract: Contract): { text: string; from: string }[] {
  return [
    ...contract.noticed.map((item) => ({ text: item.text, from: `계약 ${contract.id} 검증 중 눈에 띔` })),
    ...contract.claims
      .filter((claim) => claim.status === 'unchecked')
      .map((claim) => ({ text: `${claim.shownBy.kind === 'owner' ? '주인이 볼 것' : '확인 못 함'}: ${claim.says}${claim.note ? `: ${claim.note}` : ''}`, from: `계약 ${contract.id}` })),
  ];
}
