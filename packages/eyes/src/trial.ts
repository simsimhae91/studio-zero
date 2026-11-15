import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { SZ_DIR, localDay } from './contract.ts';
import { PAGE_STYLE, esc, inlinePicture } from './evidence.ts';

/**
 * Whether a product is worth paying for is not a claim a check can prove, and people to try it on are hard to
 * find. What can be done before any of them is spent: someone who has not seen the code uses the product as a
 * particular person would, the whole way (arriving, the first use, coming back the next day and the next week,
 * the moment it asks for money), and writes down what they wanted, what the screen gave them and where they
 * would have left. A trial is one such sitting: who the people were, each one's journal with the screen at each
 * step, what each concluded, and what stands between a person and paying, most telling first.
 *
 * A stand-in is not a user. It finds where a person is stopped or left with nothing; it cannot know whether
 * they would want the thing. So every entry says whether it was seen or guessed, and a trial ends with what
 * only real people can tell.
 */
export const TRIALS_DIR = `${SZ_DIR}/trials`;

/** One person the product says it is for, or one who doubts it. */
export const Persona = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,30}$/),
  /** Who they are and the moment they arrive in: what they were doing, what they want. */
  who: z.string().min(8).max(600),
  /** What they use for this now. A product is compared with that, not with nothing. */
  instead: z.string().max(400).default(''),
  /** What would have to be true for them to pay. */
  paysIf: z.string().max(400).default(''),
});
export type Persona = z.infer<typeof Persona>;

/** How a step left the person: stopped, lost, neither here nor there, or glad. */
export const Felt = z.enum(['stuck', 'lost', 'fine', 'glad']);
export type Felt = z.infer<typeof Felt>;

/** One step of a person's use, as they would tell it. */
export const Note = z.object({
  persona: z.string(),
  /** When in their use: "첫날", "다음 날", "3일 뒤", "결제 앞". */
  when: z.string().min(1).max(40),
  wanted: z.string().min(1).max(600),
  /** What the screen showed and what they did about it. */
  saw: z.string().max(900).default(''),
  did: z.string().max(600).default(''),
  felt: Felt,
  /** The screen at that moment, relative to the trial's folder. */
  picture: z.string().max(300).nullable().default(null),
  at: z.string(),
});
export type Note = z.infer<typeof Note>;

export const Verdict = z.object({
  persona: z.string(),
  /** Did they get the one thing the product is for. */
  reached: z.enum(['yes', 'no']),
  /** Did they come back and find a reason to. `untried` when no later day could be reached. */
  returned: z.enum(['yes', 'no', 'untried']),
  /** At the moment it asks for money (or would): would this person pay. */
  pay: z.enum(['yes', 'no', 'not-yet', 'never-asked']),
  why: z.string().min(8).max(900),
  /** What would have to be different for a yes. */
  needs: z.string().max(900).default(''),
});
export type Verdict = z.infer<typeof Verdict>;

/**
 * What stands between a person and paying, by where it stands: `block` (they cannot get to the one thing),
 * `return` (they get it once and have no reason to come back), `worth` (what is behind the price is not worth
 * it yet), `pay` (they want it and the paying itself fails or frightens).
 */
export const TrialKind = z.enum(['block', 'return', 'worth', 'pay']);
export type TrialKind = z.infer<typeof TrialKind>;

export const TrialFinding = z.object({
  text: z.string().min(8).max(900),
  kind: TrialKind,
  size: z.enum(['S', 'M', 'L']),
  /** `seen`: it happened on the product. `guessed`: the stand-in's reading of how a person would take it. */
  basis: z.enum(['seen', 'guessed']),
  evidence: z.array(z.string().max(300)).max(8).default([]),
});
export type TrialFinding = z.infer<typeof TrialFinding>;

export const Trial = z.object({
  id: z.string(),
  startedAt: z.string(),
  personas: z.array(Persona).max(6).default([]),
  notes: z.array(Note).max(400).default([]),
  verdicts: z.array(Verdict).max(6).default([]),
  findings: z.array(TrialFinding).max(40).default([]),
  /** What only real people can tell: the questions to put to the first ones. */
  ask: z.array(z.string().max(400)).max(8).default([]),
});
export type Trial = z.infer<typeof Trial>;

const file = (folder: string): string => join(folder, 'trial.json');

export function readTrial(folder: string): Trial {
  return Trial.parse(JSON.parse(readFileSync(file(folder), 'utf8')));
}

function writeTrial(folder: string, trial: Trial): void {
  mkdirSync(folder, { recursive: true });
  writeFileSync(file(folder), `${JSON.stringify(Trial.parse(trial), null, 2)}\n`);
}

/** Starts a trial and says where it is kept: `.sz/trials/<date>-<n>`. */
export function newTrial(projectDir: string, at: string): string {
  const dir = join(projectDir, TRIALS_DIR);
  mkdirSync(dir, { recursive: true });
  const day = localDay(at);
  const n = readdirSync(dir).filter((name) => name.startsWith(`${day}-`)).length + 1;
  const folder = join(dir, `${day}-${n}`);
  writeTrial(folder, { id: `${day}-${n}`, startedAt: at, personas: [], notes: [], verdicts: [], findings: [], ask: [] });
  return folder;
}

/** The latest trial of a project, or null. */
export function latestTrial(projectDir: string): string | null {
  const dir = join(projectDir, TRIALS_DIR);
  if (!existsSync(dir)) return null;
  const names = readdirSync(dir).filter((name) => existsSync(join(dir, name, 'trial.json')));
  // By day, then by the number after it: the tenth of a day comes after the ninth.
  names.sort((a, b) => a.slice(0, 10).localeCompare(b.slice(0, 10)) || Number(a.slice(11)) - Number(b.slice(11)));
  return names.length > 0 ? join(dir, names.at(-1)!) : null;
}

const known = (trial: Trial, persona: string): void => {
  if (!trial.personas.some((p) => p.id === persona)) throw new Error(`no such person in this trial: "${persona}". They are: ${trial.personas.map((p) => p.id).join(', ') || '(none yet: sz-eyes trial persona ...)'}`);
};

export function addPersona(folder: string, persona: Persona): void {
  const trial = readTrial(folder);
  writeTrial(folder, { ...trial, personas: [...trial.personas.filter((p) => p.id !== persona.id), Persona.parse(persona)] });
}

export function addNote(folder: string, note: Note): void {
  const trial = readTrial(folder);
  known(trial, note.persona);
  if (note.picture && !existsSync(join(folder, note.picture))) throw new Error(`${join(folder, note.picture)}: no such picture. A picture is a file under the trial's folder`);
  writeTrial(folder, { ...trial, notes: [...trial.notes, Note.parse(note)] });
}

export function setVerdict(folder: string, verdict: Verdict): void {
  const trial = readTrial(folder);
  known(trial, verdict.persona);
  writeTrial(folder, { ...trial, verdicts: [...trial.verdicts.filter((v) => v.persona !== verdict.persona), Verdict.parse(verdict)] });
}

export function addFinding(folder: string, finding: TrialFinding): void {
  const trial = readTrial(folder);
  for (const path of finding.evidence) if (!existsSync(join(folder, path))) throw new Error(`${join(folder, path)}: no such file. Evidence is a file under the trial's folder`);
  if (trial.findings.some((f) => f.text === finding.text)) return;
  writeTrial(folder, { ...trial, findings: [...trial.findings, TrialFinding.parse(finding)] });
}

export function addAsk(folder: string, question: string): void {
  const trial = readTrial(folder);
  if (!trial.ask.includes(question.trim())) writeTrial(folder, { ...trial, ask: [...trial.ask, question.trim()] });
}

/** Where a finding stands on the way to paying: the earlier it stops a person, the sooner it is dealt with. */
const ORDER: Record<TrialKind, number> = { block: 0, return: 1, worth: 2, pay: 3 };
const KIND: Record<TrialKind, string> = { block: '한 가지 일까지 못 간다', return: '다시 올 까닭이 없다', worth: '값 뒤에 있는 것이 아직 값을 못 한다', pay: '내려는데 내는 일이 막는다' };
const FELT: Record<Felt, string> = { stuck: '막힘', lost: '헷갈림', fine: '무난', glad: '좋음' };
const PAY: Record<Verdict['pay'], string> = { yes: '낸다', no: '안 낸다', 'not-yet': '아직은 안 낸다', 'never-asked': '돈을 내라는 순간이 없었다' };

/** The findings in the order they are dealt with: by where they stand, what was seen before what was guessed. */
export const ranked = (trial: Trial): TrialFinding[] => [...trial.findings].sort((a, b) => ORDER[a.kind] - ORDER[b.kind] || Number(b.basis === 'seen') - Number(a.basis === 'seen'));

/** Why a trial is not finished, as lines; empty when it is. A page over half a trial reads as a whole one. */
export function unfinished(trial: Trial): string[] {
  const lines: string[] = [];
  if (trial.personas.length === 0) lines.push('nobody tried the product: no person is written down');
  for (const persona of trial.personas) {
    const notes = trial.notes.filter((n) => n.persona === persona.id);
    if (notes.length === 0) lines.push(`${persona.id}: no step of their use is written down`);
    else if (new Set(notes.map((n) => n.when)).size < 2) lines.push(`${persona.id}: only one moment of their use ("${notes[0]!.when}") is written down: a person who comes once and one who comes back are told apart by the later days`);
    if (!trial.verdicts.some((v) => v.persona === persona.id)) lines.push(`${persona.id}: no verdict (did they get the one thing, did they come back, would they pay)`);
  }
  if (trial.findings.length === 0) lines.push('nothing is written down as standing between a person and paying. If the trial found nothing, say that as a finding with what was tried');
  if (trial.ask.length === 0) lines.push('nothing is written down as what only real people can tell (sz-eyes trial ask ...): a stand-in cannot know whether they would want it');
  return lines;
}

export function renderTrial(trial: Trial, folder: string): string {
  const lines: string[] = [`trial ${trial.id} (${folder})`];
  for (const persona of trial.personas) {
    const verdict = trial.verdicts.find((v) => v.persona === persona.id);
    lines.push('', `${persona.id}: ${persona.who}${persona.instead ? `\n  now uses: ${persona.instead}` : ''}${persona.paysIf ? `\n  pays if: ${persona.paysIf}` : ''}`);
    for (const note of trial.notes.filter((n) => n.persona === persona.id)) lines.push(`  [${note.when}] ${FELT[note.felt]}: wanted ${note.wanted}${note.saw ? ` | saw ${note.saw}` : ''}${note.did ? ` | did ${note.did}` : ''}${note.picture ? ` (${note.picture})` : ''}`);
    lines.push(verdict ? `  verdict: reached ${verdict.reached}, came back ${verdict.returned}, pay ${verdict.pay}: ${verdict.why}${verdict.needs ? ` | for a yes: ${verdict.needs}` : ''}` : '  no verdict yet');
  }
  const found = ranked(trial);
  if (found.length > 0) lines.push('', 'between a person and paying, first to deal with first:', ...found.map((f, i) => `  ${i + 1}. [${f.kind}, ${f.basis}, ${f.size}] ${f.text}`));
  if (trial.ask.length > 0) lines.push('', 'what only real people can tell:', ...trial.ask.map((q) => `  - ${q}`));
  const left = unfinished(trial);
  if (left.length > 0) lines.push('', 'not finished:', ...left.map((line) => `  - ${line}`));
  return lines.join('\n');
}

/** The page the owner reads: who tried it, what became of each, and what to do first so that a person would pay. */
export function trialPage(trial: Trial, folder: string): string {
  const found = ranked(trial);
  const people = trial.personas
    .map((persona) => {
      const verdict = trial.verdicts.find((v) => v.persona === persona.id);
      const notes = trial.notes.filter((n) => n.persona === persona.id);
      const paid = verdict?.pay === 'yes';
      return `<section class="claim ${verdict ? (paid ? 'proven' : verdict.pay === 'no' || verdict.reached === 'no' ? 'refuted' : '') : ''}">
  <header><span class="mark">${verdict ? `${verdict.reached === 'yes' ? '한 가지 일까지 감' : '한 가지 일까지 못 감'} · ${verdict.returned === 'yes' ? '다시 옴' : verdict.returned === 'no' ? '다시 오지 않음' : '다시 오는 날은 못 봄'} · ${PAY[verdict.pay]}` : '결론 없음'}</span><h2>${esc(persona.who)}</h2></header>
  ${persona.instead ? `<p class="how">지금 쓰는 것: ${esc(persona.instead)}</p>` : ''}
  ${persona.paysIf ? `<p class="how">이러면 낸다: ${esc(persona.paysIf)}</p>` : ''}
  ${verdict ? `<p class="note">${esc(verdict.why)}</p>${verdict.needs ? `<p class="note"><b>낸다고 하려면:</b> ${esc(verdict.needs)}</p>` : ''}` : ''}
  <div class="steps">${notes
    .map((note) => `<div class="step ${note.felt}"><p class="when">${esc(note.when)} · <b>${FELT[note.felt]}</b></p><p class="note">${esc(note.wanted)}</p>${note.saw ? `<p class="how">${esc(note.saw)}</p>` : ''}${note.did ? `<p class="how">→ ${esc(note.did)}</p>` : ''}${note.picture ? inlinePicture(folder, note.picture) : ''}</div>`)
    .join('')}</div>
</section>`;
    })
    .join('\n');
  const left = unfinished(trial);
  return `<title>써 보기 ${esc(trial.id)}</title>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="claude:viewport-fit-sides" content="cover">
<style>${PAGE_STYLE}
.steps { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 12px; align-items: start }
.step { border: 1px solid var(--line); border-top: 3px solid var(--line); border-radius: 8px; padding: 10px; display: flex; flex-direction: column; gap: 6px; min-width: 0 }
.step.stuck { border-top-color: var(--bad) } .step.lost { border-top-color: var(--wait) } .step.glad { border-top-color: var(--ok) }
.when { color: var(--muted); font-size: 13px }
.rank { counter-reset: n; display: flex; flex-direction: column; gap: 10px; padding: 0; list-style: none }
.rank li { counter-increment: n; background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 14px 16px 14px 52px; position: relative }
.rank li::before { content: counter(n); position: absolute; left: 16px; top: 12px; font-size: 22px; font-weight: 700; color: var(--muted) }
</style>
<main>
  <p class="meta">써 보기 ${esc(trial.id)} · 사람 ${trial.personas.length}명 · 걸음 ${trial.notes.length}개</p>
  <h1>사람이 돈을 낼 만한가: 대신 써 본 기록</h1>
  <p class="note">코드를 보지 않은 대역이 각 사람이 되어 처음부터 끝까지 써 봤습니다. 대역은 사람이 어디서 막히고 무엇을 못 얻는지는 찾지만, 그 사람이 이것을 원할지는 알지 못합니다. 그래서 줄마다 본 것인지 짐작인지 적었고, 맨 아래에 진짜 사람에게만 물을 수 있는 것을 적었습니다.</p>
  ${left.length > 0 ? `<section><h2>아직 끝나지 않은 기록</h2><ul>${left.map((line) => `<li>${esc(line)}</li>`).join('')}</ul></section>` : ''}
  <section><h2>사람과 결제 사이에 있는 것, 먼저 할 순서로</h2>
  ${found.length > 0 ? `<ol class="rank">${found.map((f) => `<li><p class="mark">${KIND[f.kind]} · ${f.basis === 'seen' ? '제품에서 본 것' : '대역의 짐작'} · ${f.size}</p><p class="note">${esc(f.text)}</p>${f.evidence.length > 0 ? `<div class="shots">${f.evidence.map((path) => inlinePicture(folder, path)).join('')}</div>` : ''}</li>`).join('')}</ol>` : '<p class="how">적힌 것이 없습니다.</p>'}
  </section>
  <section><h2>써 본 사람들</h2></section>
  ${people}
  ${trial.ask.length > 0 ? `<section><h2>진짜 사람에게만 물을 수 있는 것</h2><ul>${trial.ask.map((q) => `<li>${esc(q)}</li>`).join('')}</ul></section>` : ''}
</main>
`;
}

export function writeTrialPage(folder: string): string {
  const path = join(folder, 'report.html');
  writeFileSync(path, trialPage(readTrial(folder), folder));
  return path;
}
