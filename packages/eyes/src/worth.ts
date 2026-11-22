import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { SZ_DIR } from './contract.ts';
import type { Seen } from './cite.ts';
import { PAGE_STYLE, esc, inlinePicture } from './evidence.ts';

/**
 * A harness that proves a product was built as agreed says nothing about whether it was the thing to build.
 * Which service is made matters more than how many: so the case for a service is held to what a contract is
 * held to. It is a fixed set of lines, the same for every service, each a claim that is shown or is not; a
 * line about the world is shown only by words quoted from pages anyone can open, which this fetches again and
 * looks for (see cite.ts); someone who did not write the case tries to knock it down; and what only real
 * people can answer is said to be so. The default for an idea is that it is not built.
 *
 * Kinds of ground are never mixed, because they are not worth the same:
 *   world     words on public pages, seen there by this
 *   owner     what the owner knows at first hand, in their words
 *   product   shown on the running product (a standing claim, a picture)
 *   stand-in  what agents using the product as its people found: where a person is stopped, never whether they want it
 *   real      what real people did: visits, returns, money
 */
export const WORTH_DIR = `${SZ_DIR}/worth`;

export const WORLD_LINES = ['who', 'now', 'pays', 'gap', 'switch', 'reach'] as const;
export const DESIGN_LINES = ['edge', 'price', 'runs'] as const;
export const AFTER_LINES = ['does', 'returns', 'paid'] as const;
export const LINES = [...WORLD_LINES, ...DESIGN_LINES, ...AFTER_LINES] as const;
export const LineId = z.enum(LINES);
export type LineId = z.infer<typeof LineId>;

/** What each line asks, as the owner reads it. */
export const ASKS: Record<LineId, string> = {
  who: '누가, 어떤 순간에 이것이 필요한가',
  now: '그 사람은 지금 무엇으로 그 일을 하나',
  pays: '그 일에 이미 돈이 오가는가',
  gap: '지금 쓰는 것이 어디서 그 사람을 실망시키나',
  switch: '이 일에서 사람들이 갈아탄 적이 있는가, 무엇이 붙잡고 있는가',
  reach: '그 사람을 어디서 만날 수 있나',
  edge: '우리 것이 분명히 더 잘하는 한 가지',
  price: '얼마를 받고, 그 값이 왜 믿을 만한가',
  runs: '혼자 만들고 굴릴 수 있나 (비용, 법, 남의 플랫폼)',
  does: '써 본 사람이 그 한 가지를 얻는가',
  returns: '다시 오는가',
  paid: '실제로 돈을 냈는가',
};

export const Basis = z.enum(['world', 'owner', 'product', 'stand-in', 'real']);
export type Basis = z.infer<typeof Basis>;
export const BASIS: Record<Basis, string> = { world: '세상의 글', owner: '주인이 아는 것', product: '제품에서 본 것', 'stand-in': '대역이 써 본 것', real: '진짜 사람의 숫자' };

export const LineStatus = z.enum(['open', 'shown', 'refuted', 'waived']);
export type LineStatus = z.infer<typeof LineStatus>;

export const Line = z.object({
  /** The claim, as the owner would say it, with the figure where there is one. */
  says: z.string().max(900).default(''),
  status: LineStatus.default('open'),
  basis: Basis.nullable().default(null),
  /** What was run or read and what it showed; for a line waived, why; for the owner's ground, their words. */
  note: z.string().max(900).default(''),
  at: z.string().nullable().default(null),
});
export type Line = z.infer<typeof Line>;

/** Words from a page out in the world, with whether this found them there. */
export const Cite = z.object({
  id: z.string(),
  line: z.union([LineId, z.literal('others')]),
  url: z.string(),
  host: z.string(),
  quote: z.string().min(4).max(1200),
  /** What the words show, in a line. */
  shows: z.string().min(2).max(400),
  /** It speaks against the line it is filed under. */
  against: z.boolean().default(false),
  by: z.enum(['scout', 'skeptic', 'lead']).default('scout'),
  seen: z.object({ at: z.string(), by: z.enum(['fetch', 'chrome']), excerpt: z.string(), title: z.string(), shot: z.string().nullable() }).nullable(),
  /** Why the words were not found, when they were not. Such a quotation counts for nothing. */
  failed: z.string().nullable().default(null),
  /**
   * That the words are on the page is not that they mean what the line says. Whoever did not file it reads it
   * where it stands and says whether it supports its line; one that does not counts for nothing either.
   */
  weighed: z.object({ supports: z.boolean(), why: z.string().max(400), at: z.string() }).nullable().default(null),
  /**
   * Whoever filed it took it back: it was filed under the wrong line or the wrong side, or it says something else
   * than was written beside it. It stays where the owner can read it and counts for nothing, for or against.
   */
  withdrawn: z.object({ why: z.string().max(400), at: z.string() }).nullable().default(null),
});
export type Cite = z.infer<typeof Cite>;

/** What a person would use for the job if this did not exist: a product, or a way of getting by. */
export const Other = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,30}$/),
  name: z.string().min(1).max(120),
  url: z.string().max(600).default(''),
  kind: z.enum(['product', 'workaround']),
  price: z.string().max(200).default(''),
  /** The sign that people pay for it or use it in numbers: reviews, sales, rank. */
  sign: z.string().max(300).default(''),
  cites: z.array(z.string()).max(12).default([]),
});
export type Other = z.infer<typeof Other>;

/**
 * One thing a person needs somewhere along the whole job, with who already gives it. `stake`: what the things
 * people pay for have in common, so a person assumes it. `must`: what has to be there whoever else has it (the
 * law or a store asks for it, or a product with accounts is not whole without it). `edge`: the one thing this
 * is better at. `more`: anything else, built only when asked.
 *
 * A row is `have` when it is there the way the best of the others has it: with its empty, full and failed
 * states, something entered can be changed and taken back, and what it keeps is really kept. There on one
 * screen and no further is `thin`, which is what a product that "ends in a page or two" is made of.
 */
export const Row = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,40}$/),
  /** Where along the job: 처음, 준비, 하기, 확인, 고치기, 마무리, 다시 올 때, 함께, 믿음. */
  where: z.string().min(1).max(40),
  need: z.string().min(4).max(400),
  kind: z.enum(['stake', 'must', 'edge', 'more']),
  has: z.record(z.string(), z.enum(['yes', 'no', '?'])).default({}),
  cites: z.array(z.string()).max(12).default([]),
  ours: z.enum(['unknown', 'planned', 'have', 'thin', 'lack', 'not-doing']).default('unknown'),
  /** For `have`: the standing claim or the picture that shows it. For `thin`: what it lacks. For `not-doing`: why. For `planned`: the milestone. */
  by: z.string().max(400).default(''),
});
export type Row = z.infer<typeof Row>;

export const Objection = z.object({
  about: z.union([LineId, z.literal('whole')]),
  text: z.string().min(12).max(900),
  /** `fatal`: if true, the service should not be built as stated. */
  weight: z.enum(['fatal', 'serious', 'minor']),
  cites: z.array(z.string()).max(8).default([]),
  answer: z.string().max(900).nullable().default(null),
  conceded: z.boolean().default(false),
});
export type Objection = z.infer<typeof Objection>;

export const Case = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,40}$/),
  createdAt: z.string(),
  /** In a line: for whom, in what moment, it does what. */
  service: z.string().min(8).max(400),
  /** Where the idea came from: the owner's words, or what a hunt found. */
  seed: z.string().max(900).default(''),
  lines: z.record(LineId, Line),
  cites: z.array(Cite).max(300).default([]),
  others: z.array(Other).max(40).default([]),
  rows: z.array(Row).max(80).default([]),
  objections: z.array(Objection).max(40).default([]),
  /** What only real people can answer, each with the cheapest way to ask and what answer means what. */
  asks: z
    .array(
      z.object({
        question: z.string().min(8).max(400),
        /** The cheapest way to ask. */
        test: z.string().max(600).default(''),
        /** Written before the answer comes: how many must be asked, and the share that means go and that means no. */
        sample: z.number().int().positive().nullable().default(null),
        goAt: z.number().min(0).max(100).nullable().default(null),
        noAt: z.number().min(0).max(100).nullable().default(null),
        /** What came back: of how many, how many did it. The reading follows from what was written before. */
        heard: z.object({ of: z.number().int().nonnegative(), did: z.number().int().nonnegative(), reading: z.enum(['go', 'no', 'cannot tell']), note: z.string().max(600).default(''), at: z.string() }).nullable().default(null),
      }),
    )
    .max(10)
    .default([]),
  /** The call of whoever led the case, after it was attacked. */
  call: z.object({ call: z.enum(['go', 'narrow', 'no']), why: z.string().min(12).max(900), at: z.string() }).nullable().default(null),
  /** What the owner decided, in their words. Theirs alone. */
  owner: z.object({ call: z.enum(['build', 'not', 'later']), said: z.string().min(1).max(900), at: z.string() }).nullable().default(null),
});
export type Case = z.infer<typeof Case>;

export const caseFolder = (projectDir: string, id: string): string => join(projectDir, WORTH_DIR, id);
const file = (folder: string): string => join(folder, 'case.json');

export function readCase(folder: string): Case {
  if (!existsSync(file(folder))) throw new Error(`no case at ${folder}: sz-eyes worth new <id> --service "<for whom, in what moment, it does what>"`);
  // A case written before a line was added to the set has that line open, not missing.
  const raw = JSON.parse(readFileSync(file(folder), 'utf8')) as { lines?: Record<string, unknown> };
  return Case.parse({ ...raw, lines: { ...Object.fromEntries(LINES.map((line) => [line, {}])), ...raw.lines } });
}

function writeCase(folder: string, value: Case): void {
  mkdirSync(folder, { recursive: true });
  writeFileSync(file(folder), `${JSON.stringify(Case.parse(value), null, 2)}\n`);
}

export function newCase(projectDir: string, id: string, service: string, seed: string, at: string): string {
  const folder = caseFolder(projectDir, id);
  if (existsSync(file(folder))) throw new Error(`there is already a case "${id}" (${folder})`);
  writeCase(folder, { id, createdAt: at, service, seed, lines: Object.fromEntries(LINES.map((line) => [line, Line.parse({})])) as Record<LineId, Line>, cites: [], others: [], rows: [], objections: [], asks: [], call: null, owner: null });
  return folder;
}

/** Every case of a project, oldest first. */
export function allCases(projectDir: string): { folder: string; case: Case }[] {
  const dir = join(projectDir, WORTH_DIR);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => existsSync(file(join(dir, name))))
    .map((name) => ({ folder: join(dir, name), case: readCase(join(dir, name)) }))
    .sort((a, b) => a.case.createdAt.localeCompare(b.case.createdAt) || a.case.id.localeCompare(b.case.id));
}

/** The site a page is on, without the `www.`: two quotations from one site are one voice. */
export const hostOf = (url: string): string => new URL(url).hostname.toLowerCase().replace(/^(www|m|mobile)\./, '');

/** Files a quotation under a line, with what the look for it on its page found. Says the id it was given. */
export function addCite(folder: string, cite: { line: Cite['line']; url: string; quote: string; shows: string; against: boolean; by: Cite['by'] }, found: { seen: Seen | null; why: string | null }): Cite {
  const value = readCase(folder);
  const same = value.cites.find((c) => c.url === cite.url && c.quote === cite.quote && c.line === cite.line);
  const id = same?.id ?? `c${value.cites.reduce((max, c) => Math.max(max, Number(c.id.slice(1)) || 0), 0) + 1}`;
  const made = Cite.parse({ ...cite, id, host: hostOf(cite.url), seen: found.seen, failed: found.seen ? null : (found.why ?? 'not found') });
  writeCase(folder, { ...value, cites: [...value.cites.filter((c) => c.id !== id), made] });
  return made;
}

/** What a reader who did not file a quotation makes of it: does it support the line it is under. */
export function weighCite(folder: string, id: string, supports: boolean, why: string, at: string): Cite {
  const value = readCase(folder);
  const cite = value.cites.find((c) => c.id === id);
  if (!cite) throw new Error(`no quotation ${id} in this case. They are: ${value.cites.map((c) => c.id).join(', ') || '(none)'}`);
  if (!supports && why.trim().length < 8) throw new Error('say why it does not support its line: --why "<another person, another year, a free download and not a sale, ...>"');
  const next = { ...cite, weighed: { supports, why: why.trim(), at } };
  writeCase(folder, { ...value, cites: value.cites.map((c) => (c.id === id ? next : c)) });
  return next;
}

/**
 * Takes a quotation back, by whoever filed it. Filing the same words from the same page under the same line
 * again makes it a quotation again, as it is then written.
 */
export function withdrawCite(folder: string, id: string, why: string, at: string): Cite {
  const value = readCase(folder);
  const cite = value.cites.find((c) => c.id === id);
  if (!cite) throw new Error(`no quotation ${id} in this case. They are: ${value.cites.map((c) => c.id).join(', ') || '(none)'}`);
  if (why.trim().length < 8) throw new Error('say what was wrong with it: --why "<the wrong side, the wrong line, a count that does not hold, ...>"');
  const next = { ...cite, withdrawn: { why: why.trim(), at } };
  writeCase(folder, { ...value, cites: value.cites.map((c) => (c.id === id ? next : c)) });
  return next;
}

/** The quotations that count for a line: found on their page, speaking for it, and not taken back. */
export const groundsOf = (value: Case, line: Cite['line']): Cite[] => value.cites.filter((c) => c.line === line && c.seen !== null && !c.against && c.withdrawn === null && c.weighed?.supports !== false);

/**
 * What the world has to show before a line about it is called shown: how many quotations that were found on
 * their pages, and from how many different sites. One page saying a thing is one voice, however often.
 */
export const NEEDS: Partial<Record<LineId, { cites: number; hosts: number; what: string }>> = {
  who: { cites: 3, hosts: 2, what: 'three places where such people describe that moment in their own words, on two sites or more' },
  now: { cites: 2, hosts: 1, what: 'two places that show what they use for it today' },
  pays: { cites: 3, hosts: 1, what: 'a price on the seller\'s own page for something that does this job, and two signs that people buy it (a count of sales or of reviews by buyers, a rank among what earns, a buyer saying what they pay)' },
  gap: { cites: 5, hosts: 2, what: 'five complaints by different people about what they use today, on two sites or more (a pattern, not three unhappy people)' },
  switch: { cites: 2, hosts: 1, what: 'two places where someone says they moved from one way of doing this to another, or says what keeps them where they are' },
  reach: { cites: 1, hosts: 1, what: 'one page with a figure for how many look for this or gather where the owner can speak' },
  price: { cites: 1, hosts: 1, what: 'one price people already pay for the nearest thing' },
};

const SIMULATED: LineId[] = ['does', 'returns'];

/** Why the world does not carry a line yet, or null when it does. */
export function shortOf(value: Case, id: LineId): string | null {
  const need = NEEDS[id];
  if (!need) return null;
  const grounds = groundsOf(value, id);
  const hosts = new Set(grounds.map((c) => c.host)).size;
  if (grounds.length >= need.cites && hosts >= need.hosts) return null;
  const lost = value.cites.filter((c) => c.line === id && !c.against);
  const unseen = lost.filter((c) => c.seen === null).length;
  const refused = lost.filter((c) => c.weighed?.supports === false).length;
  const back = lost.filter((c) => c.withdrawn !== null).length;
  return `it needs ${need.what}. Counting so far: ${grounds.length} quotation(s) from ${hosts} site(s)${unseen > 0 ? `; ${unseen} not found on their page do not count` : ''}${refused > 0 ? `; ${refused} were read and judged not to support it` : ''}${back > 0 ? `; ${back} taken back by whoever filed them` : ''}`;
}

/** Sets what a line claims and where it stands. Refuses a standing the ground does not carry. */
export function setLine(folder: string, id: LineId, change: { says?: string; status?: LineStatus; basis?: Basis; note?: string }, at: string): Line {
  const value = readCase(folder);
  const before = value.lines[id];
  const next: Line = { ...before, ...(change.says !== undefined ? { says: change.says } : {}), ...(change.note !== undefined ? { note: change.note } : {}) };
  // What the line claims is kept even when the standing asked for is refused: the claim is what the ground is then sought for.
  if (change.says !== undefined && change.status) writeCase(folder, { ...value, lines: { ...value.lines, [id]: Line.parse({ ...before, says: change.says }) } });
  if (change.status) {
    const note = (change.note ?? '').trim();
    if (change.status === 'shown') {
      if (next.says.trim().length < 4) throw new Error(`say what the line claims first: --says "<${ASKS[id]}>"`);
      const basis = change.basis ?? (NEEDS[id] ? 'world' : null);
      if (!basis) throw new Error(`say what ${id} stands on: --basis ${Basis.options.join('|')}`);
      if (id === 'paid' && basis !== 'real') throw new Error('paid is shown only by real money: --basis real, with the figure and where it was read in --note. Nothing else stands for it');
      if (basis === 'stand-in' && !SIMULATED.includes(id)) throw new Error(`stand-ins find where a person is stopped; they do not show ${id}. Only does and returns may stand on them, and are marked as such`);
      if (basis === 'world') {
        if (!NEEDS[id]) throw new Error(`${id} is not a line about the world: --basis ${id === 'edge' ? 'product (the standing claim or the trial that shows it, in --note)' : 'owner|product|real, with what shows it in --note'}`);
        const short = shortOf(value, id);
        if (short) throw new Error(`${id} is not shown yet: ${short}. sz-eyes worth cite ${value.id} ${id} --url ... --quote "..." --shows "..."`);
      } else if (note.length < 8) throw new Error(basis === 'owner' ? 'the owner\'s ground is their own words: --note "<what they said>"' : `say what shows it: --note "<the standing claim, the trial, or the figure and where it was read>"`);
      Object.assign(next, { status: 'shown', basis, at });
    } else if (change.status === 'refuted') {
      if (note.length < 12 && !value.cites.some((c) => c.line === id && c.against && c.seen && c.withdrawn === null)) throw new Error('say what refutes it: --note "<what was found>", or a quotation filed against it (worth cite ... --against)');
      Object.assign(next, { status: 'refuted', basis: change.basis ?? null, at });
    } else if (change.status === 'waived') {
      if (note.length < 12) throw new Error('a line is waived with a reason the owner reads: --note "<why it does not apply, or who decided to go on without it>"');
      Object.assign(next, { status: 'waived', basis: change.basis ?? null, at });
    } else Object.assign(next, { status: 'open', basis: null, at });
  }
  writeCase(folder, { ...value, lines: { ...value.lines, [id]: Line.parse(next) } });
  return next;
}

export function setOther(folder: string, other: Other): void {
  const value = readCase(folder);
  for (const id of other.cites) if (!value.cites.some((c) => c.id === id)) throw new Error(`no quotation ${id} in this case`);
  writeCase(folder, { ...value, others: [...value.others.filter((o) => o.id !== other.id), Other.parse(other)] });
}

/** Takes one out of the things people use instead, and out of every row that named it. */
export function removeOther(folder: string, id: string): void {
  const value = readCase(folder);
  if (!value.others.some((o) => o.id === id)) throw new Error(`no such thing in the reference class: "${id}". They are: ${value.others.map((o) => o.id).join(', ') || '(none)'}`);
  writeCase(folder, { ...value, others: value.others.filter((o) => o.id !== id), rows: value.rows.map((row) => ({ ...row, has: Object.fromEntries(Object.entries(row.has).filter(([other]) => other !== id)) })) });
}

/** Sets a row of the whole job. Refuses what would let a product be called deep on its builder's word. */
export function setRow(folder: string, row: Partial<Row> & { id: string }, standing: (key: string) => boolean): Row {
  const value = readCase(folder);
  const before = value.rows.find((r) => r.id === row.id);
  if (!before && (!row.where || !row.need || !row.kind)) throw new Error('a new row says where along the job it is, what a person needs there, and its kind: --where "<...>" --need "<...>" --kind stake|must|edge|more');
  const next = Row.parse({ ...before, ...row, has: { ...before?.has, ...row.has } });
  for (const other of Object.keys(next.has)) if (!value.others.some((o) => o.id === other)) throw new Error(`no such thing in the reference class: "${other}". They are: ${value.others.map((o) => o.id).join(', ') || '(none yet: sz-eyes worth other ...)'}`);
  for (const id of next.cites) if (!value.cites.some((c) => c.id === id)) throw new Error(`no quotation ${id} in this case`);
  const yes = Object.values(next.has).filter((has) => has === 'yes').length;
  if (next.kind === 'stake' && yes < 2) throw new Error(`"${next.id}" is called a stake, and ${yes} of the things people use have it: a stake is what two or more of them have in common (--has <other>=yes). What only one has is "more", or the edge of that one`);
  if (next.ours === 'have') {
    const shown = next.by.trim();
    if (shown === '') throw new Error('"have" is shown, not said: --by <contract>/<claim> (a claim that stands) or --by <a picture under the case folder> taken on the running product');
    if (!standing(shown) && !existsSync(join(folder, shown))) throw new Error(`${shown} is neither a claim that stands in this project nor a file under ${folder}`);
  }
  if (next.ours === 'not-doing' && next.by.trim().length < 12) throw new Error('"not-doing" carries the reason the owner reads: --by "<why this product does not do it>"');
  if (next.ours === 'thin' && next.by.trim().length < 8) throw new Error('"thin" says what it lacks next to the best of the others: --by "<no way to change an entry, nothing when empty, ...>"');
  writeCase(folder, { ...value, rows: [...value.rows.filter((r) => r.id !== next.id), next] });
  return next;
}

export function addObjection(folder: string, objection: Objection): number {
  const value = readCase(folder);
  for (const id of objection.cites) if (!value.cites.some((c) => c.id === id)) throw new Error(`no quotation ${id} in this case`);
  writeCase(folder, { ...value, objections: [...value.objections, Objection.parse(objection)] });
  return value.objections.length + 1;
}

/** Answers an objection, or grants it. A fatal one that is granted refutes the line it is about. */
export function answerObjection(folder: string, n: number, answer: string | null, at: string): Objection {
  const value = readCase(folder);
  const objection = value.objections[n - 1];
  if (!objection) throw new Error(`no objection ${n}. There are ${value.objections.length}`);
  const conceded = answer === null;
  if (!conceded && answer.trim().length < 12) throw new Error('an answer says what is wrong with the objection, or what was changed because of it');
  const next = { ...objection, answer: conceded ? objection.answer : answer.trim(), conceded };
  const lines = { ...value.lines };
  if (conceded && objection.weight === 'fatal' && objection.about !== 'whole') lines[objection.about] = { ...lines[objection.about], status: 'refuted', note: `반박을 받아들임: ${objection.text}`.slice(0, 900), at };
  writeCase(folder, { ...value, lines, objections: value.objections.map((o, i) => (i === n - 1 ? next : o)) });
  return next;
}

export function addAsk(folder: string, question: string, test: string, bar: { sample?: number; goAt?: number; noAt?: number } = {}): number {
  const value = readCase(folder);
  const at = value.asks.findIndex((a) => a.question === question.trim());
  if (bar.goAt !== undefined && bar.noAt !== undefined && bar.noAt >= bar.goAt) throw new Error('the share that means no is below the share that means go; what falls between cannot be told');
  const ask = { question: question.trim(), test: test.trim(), sample: bar.sample ?? null, goAt: bar.goAt ?? null, noAt: bar.noAt ?? null, heard: null };
  writeCase(folder, { ...value, asks: at === -1 ? [...value.asks, ask] : value.asks.map((a, i) => (i === at ? { ...ask, heard: a.heard } : a)) });
  return at === -1 ? value.asks.length + 1 : at + 1;
}

/**
 * What real people did, read by what was written down before they were asked: go, no, or it cannot be told.
 * Fewer than were to be asked cannot be told, whatever the share: three of five is a story, not a rate.
 */
export function hearAsk(folder: string, n: number, of: number, did: number, note: string, at: string): NonNullable<Case['asks'][number]['heard']> {
  const value = readCase(folder);
  const ask = value.asks[n - 1];
  if (!ask) throw new Error(`no question ${n}. There are ${value.asks.length}`);
  if (did > of) throw new Error(`${did} of ${of}: more did it than were asked`);
  if (ask.sample === null || ask.goAt === null || ask.noAt === null) throw new Error(`question ${n} was asked without saying what answer would mean what. Say it first, as it would have been said before asking: sz-eyes worth ask ${value.id} "${ask.question.slice(0, 40)}..." --sample <how many> --go-at <percent> --no-at <percent>`);
  const share = of === 0 ? 0 : (did / of) * 100;
  const reading = of < ask.sample ? 'cannot tell' : share >= ask.goAt ? 'go' : share <= ask.noAt ? 'no' : 'cannot tell';
  const heard = { of, did, reading, note: note.trim(), at } as const;
  writeCase(folder, { ...value, asks: value.asks.map((a, i) => (i === n - 1 ? { ...a, heard } : a)) });
  return heard;
}

export function setCall(folder: string, call: NonNullable<Case['call']>): void {
  const value = readCase(folder);
  const open = unanswered(value);
  if (call.call === 'go' && open.length > 0) throw new Error(`not "go" yet:\n${open.map((line) => `  - ${line}`).join('\n')}`);
  writeCase(folder, { ...value, call });
}

export function setOwner(folder: string, owner: NonNullable<Case['owner']>): void {
  writeCase(folder, { ...readCase(folder), owner });
}

/** How deep the product is against what people already use: the stakes it has, lacks and leaves out on purpose. */
export function depthOf(value: Case): { stakes: number; have: number; thin: Row[]; lack: Row[]; unknown: Row[]; out: Row[]; edge: Row[] } {
  const stakes = value.rows.filter((r) => r.kind === 'stake' || r.kind === 'must');
  return {
    stakes: stakes.length,
    have: stakes.filter((r) => r.ours === 'have').length,
    thin: stakes.filter((r) => r.ours === 'thin'),
    lack: stakes.filter((r) => r.ours === 'lack' || r.ours === 'planned'),
    unknown: stakes.filter((r) => r.ours === 'unknown'),
    out: stakes.filter((r) => r.ours === 'not-doing'),
    edge: value.rows.filter((r) => r.kind === 'edge'),
  };
}

/** What still stands between the case and "go", as lines; empty when nothing does. */
export function unanswered(value: Case): string[] {
  const left: string[] = [];
  for (const id of WORLD_LINES) {
    const line = value.lines[id];
    if (line.status === 'refuted') left.push(`${id} is refuted: ${line.note || line.says}`);
    else if (line.status === 'open') left.push(`${id} is not shown (${ASKS[id]}): ${NEEDS[id]?.what ?? ''}`);
    else if (line.status === 'shown' && line.basis === 'world') {
      const short = shortOf(value, id);
      if (short) left.push(`${id} was called shown and its ground no longer carries it: ${short}`);
      const unread = groundsOf(value, id).filter((c) => c.weighed === null).map((c) => c.id);
      if (unread.length > 0) left.push(`${id}: ${unread.join(', ')} were found on their pages and nobody but whoever filed them has read them there (the sz:skeptic agent: sz-eyes worth weigh ${value.id} <cN> --supports yes|no --why "...")`);
    }
  }
  for (const id of DESIGN_LINES) {
    const line = value.lines[id];
    if (line.status === 'refuted') left.push(`${id} is refuted: ${line.note || line.says}`);
    else if (line.says.trim().length < 4) left.push(`${id} is not said (${ASKS[id]})`);
  }
  if (value.others.filter((o) => o.kind === 'product').length + value.others.filter((o) => o.kind === 'workaround').length < 2) left.push('fewer than two things a person would use instead are named (sz-eyes worth other ...): a service is judged against those, never against nothing');
  if (value.rows.filter((r) => r.kind === 'stake').length === 0) left.push('no row says what a person assumes such a product has (sz-eyes worth row ... --kind stake): how deep it has to be is not known');
  if (value.rows.filter((r) => r.kind === 'edge').length === 0) left.push('no row is the edge: the one thing this does that the others do not');
  value.objections.forEach((o, i) => {
    if (o.weight !== 'minor' && o.answer === null && !o.conceded) left.push(`objection ${i + 1} (${o.weight}, about ${o.about}) is not answered: ${o.text.slice(0, 140)}`);
    if (o.weight === 'fatal' && o.conceded && o.about === 'whole') left.push(`a fatal objection to the whole was granted: ${o.text.slice(0, 140)}`);
  });
  if (value.objections.length === 0) left.push('nobody has tried to knock the case down (the sz:skeptic agent, who did not write it)');
  if (value.asks.length === 0) left.push('nothing is written down as what only real people can answer, with the cheapest way to ask them (sz-eyes worth ask ...)');
  return left;
}

/**
 * Where the case stands, read off its lines and never above its ground: `no` when a line about the world or
 * the design is refuted or a fatal objection was granted; `case` when the world lines are shown, the design is
 * said and every serious objection is answered; `thin` otherwise. A `case` is a reason to build, not a sale.
 */
export function standingOf(value: Case): 'no' | 'thin' | 'case' {
  if (value.asks.some((a) => a.heard?.reading === 'no')) return 'no';
  const core: LineId[] = [...WORLD_LINES, ...DESIGN_LINES];
  if (core.some((id) => value.lines[id].status === 'refuted') || value.objections.some((o) => o.weight === 'fatal' && o.conceded)) return 'no';
  return unanswered(value).length === 0 ? 'case' : 'thin';
}

const STANDING: Record<ReturnType<typeof standingOf>, string> = { no: '짓지 않는다', thin: '근거가 모자란다', case: '지을 근거가 있다' };
const STATUS: Record<LineStatus, string> = { open: '아직', shown: '보임', refuted: '아님', waived: '넘어감' };
/** A line's name where many cases stand side by side. */
const SHORT: Record<LineId, string> = { who: '누가', now: '지금 쓰는 것', pays: '돈', gap: '실망', switch: '갈아탐', reach: '만남', edge: '더 잘하는 한 가지', price: '값', runs: '혼자 굴리기', does: '얻는가', returns: '다시 오는가', paid: '낸 돈' };
export const standingWord = (value: Case): string => STANDING[standingOf(value)];

export function renderCase(value: Case, folder: string): string {
  const lines: string[] = [`case ${value.id} (${folder}): ${standingOf(value)}`, `  ${value.service}`];
  if (value.seed) lines.push(`  from: ${value.seed}`);
  for (const id of LINES) {
    const line = value.lines[id];
    const cites = value.cites.filter((c) => c.line === id);
    lines.push('', `${id} [${line.status}${line.basis ? `, ${line.basis}` : ''}] ${ASKS[id]}`, ...(line.says ? [`  says: ${line.says}`] : []), ...(line.note ? [`  note: ${line.note}`] : []));
    for (const c of cites) lines.push(`  ${c.id} ${c.seen ? 'seen' : 'NOT SEEN'}${c.withdrawn ? ` TAKEN BACK (${c.withdrawn.why})` : ''}${c.against ? ' AGAINST' : ''}${c.weighed ? (c.weighed.supports ? ' read:supports' : ` read:DOES NOT SUPPORT (${c.weighed.why})`) : ''} (${c.by}) ${c.host}: "${c.quote.slice(0, 160)}" → ${c.shows}${c.seen ? '' : ` [${c.failed}]`}\n      ${c.url}`);
  }
  if (value.others.length > 0) lines.push('', 'instead of it, a person uses:', ...value.others.map((o) => `  ${o.id} (${o.kind}) ${o.name}${o.price ? `, ${o.price}` : ''}${o.sign ? `, ${o.sign}` : ''}${o.url ? `  ${o.url}` : ''}`));
  if (value.rows.length > 0) {
    const depth = depthOf(value);
    lines.push('', `the whole job (${depth.stakes} stakes: ${depth.have} have, ${depth.thin.length} thin, ${depth.lack.length} lack, ${depth.out.length} left out on purpose, ${depth.unknown.length} not looked at):`);
    for (const row of value.rows) lines.push(`  ${row.id} [${row.kind}, ours: ${row.ours}] ${row.where}: ${row.need}  (${Object.entries(row.has).map(([other, has]) => `${other}=${has}`).join(' ') || 'nobody marked'})${row.by ? `  by: ${row.by}` : ''}`);
  }
  if (value.objections.length > 0) lines.push('', 'objections:', ...value.objections.map((o, i) => `  ${i + 1}. [${o.weight}, about ${o.about}] ${o.text}${o.conceded ? '\n     GRANTED' : o.answer ? `\n     answer: ${o.answer}` : '\n     not answered'}`));
  if (value.asks.length > 0) lines.push('', 'what only real people can answer:', ...value.asks.map((a, i) => `  ${i + 1}. ${a.question}${a.test ? `\n     cheapest test: ${a.test}` : ''}${a.sample !== null ? `\n     said beforehand: of ${a.sample} or more, ${a.goAt}% or more is go, ${a.noAt}% or fewer is no` : ''}${a.heard ? `\n     heard: ${a.heard.did} of ${a.heard.of}: ${a.heard.reading}${a.heard.note ? ` (${a.heard.note})` : ''}` : ''}`));
  if (value.call) lines.push('', `call: ${value.call.call}: ${value.call.why}`);
  if (value.owner) lines.push(`the owner: ${value.owner.call}: "${value.owner.said}"`);
  const left = unanswered(value);
  if (left.length > 0) lines.push('', 'between this and "go":', ...left.map((line) => `  - ${line}`));
  return lines.join('\n');
}

/** One line for each case of a project: what a session and the owner see first. */
export function renderCases(cases: { folder: string; case: Case }[]): string {
  if (cases.length === 0) return 'no case in this project (sz-eyes worth new ...)';
  return cases.map(({ case: value }) => `${value.id}: ${standingOf(value)}${value.owner ? ` (the owner: ${value.owner.call})` : value.call ? ` (call: ${value.call.call})` : ''}  ${value.service}`).join('\n');
}


// ---------------------------------------------------------------------------------------------------------
// The page the owner reads.


const KIND: Record<Row['kind'], string> = { stake: '기본기', must: '어디에나 있어야 함', edge: '우리의 한 가지', more: '그 밖' };
const OURS: Record<Row['ours'], string> = { unknown: '안 봄', planned: '예정', have: '있음', thin: '얕음', lack: '없음', 'not-doing': '안 함' };
const READING: Record<'go' | 'no' | 'cannot tell', string> = { go: '간다', no: '안 간다', 'cannot tell': '아직 알 수 없다' };
const WEIGHT: Record<Objection['weight'], string> = { fatal: '치명적', serious: '무거움', minor: '가벼움' };
const HAS: Record<'yes' | 'no' | '?', string> = { yes: '●', no: '–', '?': '?' };
const day = (iso: string): string => new Date(iso).toLocaleDateString('sv-SE');

const WORTH_STYLE = `
blockquote { margin: 0; padding: 8px 12px; border-left: 3px solid var(--line); background: var(--code); border-radius: 0 8px 8px 0; font-size: 14px; overflow-wrap: anywhere }
blockquote.against { border-left-color: var(--bad) } blockquote.unseen { opacity: .6; text-decoration: line-through; text-decoration-color: var(--muted) }
.src { color: var(--muted); font-size: 12px; overflow-wrap: anywhere } .src a { color: inherit }
.big { font-size: 30px; font-weight: 700; line-height: 1.2 } .big.case { color: var(--ok) } .big.no { color: var(--bad) } .big.thin { color: var(--wait) }
.scroll { overflow-x: auto } table { border-collapse: collapse; font-size: 14px; min-width: 100% } th, td { border-bottom: 1px solid var(--line); padding: 6px 10px; text-align: left; vertical-align: top } th { color: var(--muted); font-weight: 600; white-space: nowrap } td.c { text-align: center; white-space: nowrap }
.have { color: var(--ok); font-weight: 600 } .lack { color: var(--bad); font-weight: 600 } .tag { font-size: 12px; color: var(--muted); border: 1px solid var(--line); border-radius: 99px; padding: 0 8px; white-space: nowrap }
.grades { display: flex; flex-wrap: wrap; gap: 6px 16px; font-size: 13px; color: var(--muted) }
`;

function quote(c: Cite, folder: string): string {
  return `<blockquote class="${c.against ? 'against' : ''} ${c.seen && !c.withdrawn ? '' : 'unseen'}">"${esc(c.quote)}"</blockquote>
<p class="src">${c.against ? '<b>반대 증거</b> · ' : ''}${esc(c.shows)} · <a href="${esc(c.url)}">${esc(c.host)}</a> · ${c.seen ? `${day(c.seen.at)}에 그 페이지에서 확인 (${c.seen.by === 'chrome' ? '브라우저로' : '받은 그대로'})` : `<b>그 페이지에서 찾지 못함: 근거로 세지 않음</b> (${esc(c.failed ?? '')})`}${c.weighed ? (c.weighed.supports ? ' · 쓴 쪽이 아닌 이가 읽음: 이 줄을 받친다' : ` · <b>쓴 쪽이 아닌 이가 읽음: 이 줄을 받치지 않는다, 세지 않음</b> (${esc(c.weighed.why)})`) : ''}${c.withdrawn ? ` · <b>낸 쪽이 거두어들임: 세지 않음</b> (${esc(c.withdrawn.why)})` : ''}</p>${c.seen?.shot ? inlinePicture(folder, c.seen.shot) : ''}`;
}

function lineCard(value: Case, id: LineId, folder: string): string {
  const line = value.lines[id];
  const cites = value.cites.filter((c) => c.line === id);
  return `<section class="claim ${line.status === 'shown' ? 'proven' : line.status === 'refuted' ? 'refuted' : ''}">
  <header><span class="mark">${STATUS[line.status]}${line.basis ? ` · ${BASIS[line.basis]}` : ''}</span><h2>${esc(ASKS[id])}</h2></header>
  ${line.says ? `<p class="note">${esc(line.says)}</p>` : '<p class="how">아직 말해진 것이 없습니다.</p>'}
  ${line.note ? `<p class="how">${esc(line.note)}</p>` : ''}
  ${cites.map((c) => quote(c, folder)).join('\n')}
</section>`;
}

/** The whole job as a table: what a person needs along it, who gives it already, and whether this does. */
function depthTable(value: Case): string {
  if (value.rows.length === 0) return '<p class="how">아직 적힌 것이 없습니다.</p>';
  const depth = depthOf(value);
  const places = [...new Set(value.rows.map((r) => r.where))];
  const body = places
    .map((where) => {
      const rows = value.rows.filter((r) => r.where === where);
      return rows
        .map((row, i) => `<tr>${i === 0 ? `<th rowspan="${rows.length}">${esc(where)}</th>` : ''}<td>${esc(row.need)} <span class="tag">${KIND[row.kind]}</span></td>${value.others.map((o) => `<td class="c">${HAS[row.has[o.id] ?? '?']}</td>`).join('')}<td class="c ${row.ours === 'have' ? 'have' : row.ours === 'lack' || row.ours === 'thin' ? 'lack' : ''}">${OURS[row.ours]}</td><td class="how">${esc(row.by)}</td></tr>`)
        .join('');
    })
    .join('');
  return `<p class="note">사람들이 당연히 있다고 여기는 것(기본기) ${depth.stakes}개 중: <span class="have">있음 ${depth.have}</span> · <span class="lack">얕음 ${depth.thin.length} · 없음 ${depth.lack.length}</span> · 일부러 안 함 ${depth.out.length} · 아직 안 봄 ${depth.unknown.length}</p>
<div class="scroll"><table><thead><tr><th>일의 어디</th><th>사람에게 필요한 것</th>${value.others.map((o) => `<th>${esc(o.name)}</th>`).join('')}<th>우리 것</th><th>무엇으로 / 왜</th></tr></thead><tbody>${body}</tbody></table></div>`;
}

export function casePage(value: Case, folder: string): string {
  const stand = standingOf(value);
  const left = unanswered(value);
  return `<title>${esc(value.id)} 근거</title>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="claude:viewport-fit-sides" content="cover">
<style>${PAGE_STYLE}${WORTH_STYLE}</style>
<main>
  <p class="meta">이 서비스를 지을 만한가 · ${esc(value.id)} · ${day(value.createdAt)}</p>
  <h1>${esc(value.service)}</h1>
  <p class="big ${stand}">${STANDING[stand]}</p>
  ${value.call ? `<p class="note"><b>판단 (${value.call.call === 'go' ? '짓자' : value.call.call === 'narrow' ? '좁혀서' : '짓지 말자'}):</b> ${esc(value.call.why)}</p>` : ''}
  ${value.owner ? `<p class="note"><b>주인의 결정 (${day(value.owner.at)}):</b> "${esc(value.owner.said)}"</p>` : ''}
  ${value.seed ? `<p class="how">어디서 나온 생각인가: ${esc(value.seed)}</p>` : ''}
  <p class="grades"><span>근거의 종류는 섞지 않습니다:</span><span><b>세상의 글</b> 누구나 열 수 있는 페이지의 문장, 그 페이지에서 다시 확인한 것만</span><span><b>대역이 써 본 것</b> 막히는 곳은 찾지만 원하는지는 모름</span><span><b>진짜 사람의 숫자</b> 돈을 냈는가는 이것으로만</span></p>
  ${left.length > 0 && stand !== 'no' ? `<section><h2>"짓자"까지 남은 것</h2><ul>${left.map((line) => `<li>${esc(line)}</li>`).join('')}</ul></section>` : ''}
  <section><h2>세상: 이미 있는 수요인가</h2></section>
  ${WORLD_LINES.map((id) => lineCard(value, id, folder)).join('\n')}
  <section><h2>대신 쓰는 것</h2>
  ${value.others.length > 0 ? `<div class="scroll"><table><thead><tr><th>이름</th><th>종류</th><th>값</th><th>사람들이 쓰거나 산다는 표시</th></tr></thead><tbody>${value.others.map((o) => `<tr><td>${o.url ? `<a href="${esc(o.url)}">${esc(o.name)}</a>` : esc(o.name)}</td><td>${o.kind === 'product' ? '제품' : '임시방편'}</td><td>${esc(o.price)}</td><td>${esc(o.sign)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="how">아직 적힌 것이 없습니다.</p>'}
  ${value.cites.filter((c) => c.line === 'others').map((c) => quote(c, folder)).join('\n')}
  </section>
  <section><h2>설계: 우리는 무엇으로 이기나</h2></section>
  ${DESIGN_LINES.map((id) => lineCard(value, id, folder)).join('\n')}
  <section><h2>깊이: 일의 처음부터 끝까지</h2>${depthTable(value)}</section>
  <section><h2>반박과 답</h2>
  ${value.objections.length > 0 ? value.objections.map((o) => `<div class="claim ${o.conceded ? 'refuted' : o.answer ? 'proven' : ''}"><span class="mark">${WEIGHT[o.weight]} · ${o.about === 'whole' ? '전체' : esc(ASKS[o.about])}${o.conceded ? ' · 받아들임' : o.answer ? '' : ' · 답 없음'}</span><p class="note">${esc(o.text)}</p>${o.cites.map((id) => value.cites.find((c) => c.id === id)).filter((c): c is Cite => c !== undefined).map((c) => quote(c, folder)).join('')}${o.answer ? `<p class="note"><b>답:</b> ${esc(o.answer)}</p>` : ''}</div>`).join('\n') : '<p class="how">아직 아무도 이 근거를 뒤집어 보지 않았습니다.</p>'}
  </section>
  <section><h2>제품이 생긴 뒤에만 알 수 있는 것</h2></section>
  ${AFTER_LINES.map((id) => lineCard(value, id, folder)).join('\n')}
  <section><h2>진짜 사람만 답할 수 있는 것</h2>
  ${value.asks.length > 0 ? `<ul>${value.asks.map((a) => `<li>${esc(a.question)}${a.test ? `<br><span class="how">가장 싸게 묻는 법: ${esc(a.test)}</span>` : ''}${a.sample !== null ? `<br><span class="how">묻기 전에 적어 둔 기준: ${a.sample}명 이상에게 물어 ${a.goAt}% 이상이면 간다, ${a.noAt}% 이하면 안 간다. 그 사이와 ${a.sample}명 미만은 알 수 없다.</span>` : ''}${a.heard ? `<br><b>${a.heard.of}명 중 ${a.heard.did}명${a.heard.of >= 100 ? ` (${((a.heard.did / a.heard.of) * 100).toFixed(1)}%)` : ''}: ${READING[a.heard.reading]}</b>${a.heard.note ? ` <span class="how">${esc(a.heard.note)}</span>` : ''}` : ''}</li>`).join('')}</ul>` : '<p class="how">아직 적힌 것이 없습니다.</p>'}
  </section>
</main>
`;
}

/** Every case of a project on one page: what there is ground to build first, what was dropped and why. */
export function casesPage(cases: { folder: string; case: Case }[]): string {
  const order = { case: 0, thin: 1, no: 2 } as const;
  // Within a standing, the cases that were looked into furthest come first.
  const looked = (value: Case): number => value.cites.filter((c) => c.seen !== null && c.withdrawn === null).length;
  const sorted = [...cases].sort((a, b) => order[standingOf(a.case)] - order[standingOf(b.case)] || looked(b.case) - looked(a.case));
  const card = ({ case: value }: { folder: string; case: Case }): string => {
    const stand = standingOf(value);
    const depth = depthOf(value);
    const seen = value.cites.filter((c) => c.seen !== null && c.withdrawn === null).length;
    const why = value.call?.why ?? (stand === 'no' ? (value.objections.find((o) => o.weight === 'fatal' && o.conceded)?.text ?? [...WORLD_LINES, ...DESIGN_LINES].map((id) => value.lines[id]).find((line) => line.status === 'refuted')?.note ?? '') : (unanswered(value)[0] ?? ''));
    return `<section class="claim ${stand === 'case' ? 'proven' : stand === 'no' ? 'refuted' : ''}">
  <header><span class="mark">${STANDING[stand]}${value.owner ? ` · 주인: "${esc(value.owner.said)}"` : ''}</span><h2><a href="${esc(value.id)}/page.html">${esc(value.service)}</a></h2></header>
  ${why ? `<p class="note">${esc(why)}</p>` : ''}
  ${[...WORLD_LINES, ...DESIGN_LINES].filter((id) => value.lines[id].status === 'refuted' && (value.lines[id].note || value.lines[id].says)).map((id) => `<p class="how"><b>걸린 줄: ${SHORT[id]}</b> ${esc(value.lines[id].note || value.lines[id].says)}</p>`).join('\n  ')}
  ${[...WORLD_LINES, ...DESIGN_LINES].filter((id) => value.lines[id].status === 'shown' && value.lines[id].says).map((id) => `<p class="how"><b>보인 줄: ${SHORT[id]}</b> ${esc(value.lines[id].says)}</p>`).join('\n  ')}
  <p class="how">${WORLD_LINES.map((id) => `${SHORT[id]}: ${STATUS[value.lines[id].status]}`).join(' · ')}${depth.stakes > 0 ? ` · 기본기 ${depth.stakes}개` : ''}</p>
  ${value.seed || seen > 0 ? `<p class="how">${esc(value.seed)}${seen > 0 ? `${value.seed ? ' · ' : ''}그 페이지에서 확인한 인용 ${seen}개` : ''}</p>` : ''}
</section>`;
  };
  return `<title>무엇을 지을까</title>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="claude:viewport-fit-sides" content="cover">
<style>${PAGE_STYLE}${WORTH_STYLE}</style>
<main>
  <p class="meta">무엇을 지을까 · 후보 ${cases.length}개</p>
  <h1>지을 근거가 있는 것 ${sorted.filter((c) => standingOf(c.case) === 'case').length}개, 버린 것 ${sorted.filter((c) => standingOf(c.case) === 'no').length}개</h1>
  <p class="note">후보마다 같은 줄을 물었습니다: 누가, 지금 무엇으로, 이미 돈이 오가는가, 어디서 실망하는가, 어디서 만나는가. 세상에 대한 줄은 누구나 열 수 있는 페이지의 문장으로만 보였다고 하고, 그 문장이 그 페이지에 있는지 다시 열어 확인했습니다. "지을 근거가 있다"는 팔린다는 뜻이 아닙니다: 돈을 내는지는 진짜 사람만 답합니다.</p>
  ${sorted.map(card).join('\n')}
</main>
`;
}

export function writeCasePage(folder: string): string {
  const path = join(folder, 'page.html');
  writeFileSync(path, casePage(readCase(folder), folder));
  return path;
}

export function writeCasesPage(projectDir: string): string {
  const cases = allCases(projectDir);
  for (const { folder } of cases) writeCasePage(folder);
  const path = join(projectDir, WORTH_DIR, 'index.html');
  mkdirSync(join(projectDir, WORTH_DIR), { recursive: true });
  writeFileSync(path, casesPage(cases));
  return path;
}
