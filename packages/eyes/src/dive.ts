import { spawnSync } from 'node:child_process';
import { existsSync, globSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { z } from 'zod';
import { SZ_DIR, localDay } from './contract.ts';
import { findQuote, type Seen } from './cite.ts';
import { codexHeard } from './codex-heard.ts';
import { SandboxError } from './web.ts';

/**
 * A dive starts from one line the owner said ("this annoys me", "I read a report") and goes on, round after
 * round, until what they want is clear in their own head. "Clear" is not how the session feels about it: it is a
 * fixed set of lines, each settled by the owner's own words or left open by them on purpose, and the dive does
 * not close until every line is one or the other and the owner has said what they make of the one page.
 *
 * Whose words are whose is kept apart by machine. What the dive proposes is its own (`says`); what settles a
 * line is the owner's (`said`), and it is taken only when it is found in what the owner actually typed or chose:
 * the plugin's hook keeps what they type while a dive is asked for or under way, and the session's transcript
 * keeps what they chose in a question box. A sentence of the session's cannot be recorded as theirs. (On
 * 2026-11-22 a line a session wrote in the owner's place was recorded as "주인:" in a contract.)
 */
export const DIVE_DIR = `${SZ_DIR}/dive`;

export const COMMON_LINES = ['moment', 'now', 'core', 'first', 'back', 'not', 'feel', 'done'] as const;
export const APP_LINES = ['pain', 'home'] as const;
export const GAME_LINES = ['loop', 'stakes', 'depth', 'lens'] as const;
export const DiveLineId = z.enum([...COMMON_LINES, ...APP_LINES, ...GAME_LINES]);
export type DiveLineId = z.infer<typeof DiveLineId>;
export const DiveKind = z.enum(['app', 'game', 'plain']);
export type DiveKind = z.infer<typeof DiveKind>;

/** The required headings in the page the designer and builder execute, in reading order. */
export const BRIEF_FILE = 'brief.md';
export const BRIEF_SECTIONS: Record<DiveKind, string[]> = {
  app: ['## 북극성', '## 첫 1분과 핵심 여정', '## 채울 것', '## 비워 둘 것', '## 톤과 제약', '## 완료 기준'],
  game: ['## 북극성과 손맛', '## 코어 동사', '## 시간축 루프', '## 승패와 밸런스', '## 채울 것', '## 비워 둘 것', '## sz:game 연결', '## 완료 기준'],
  plain: ['## 북극성', '## 채울 것', '## 비워 둘 것', '## 완료 기준'],
};

/** The lines of each kind of dive, in the order the owner reads them. */
const ORDER: Record<DiveKind, DiveLineId[]> = {
  app: ['moment', 'pain', 'now', 'home', 'core', 'first', 'back', 'not', 'feel', 'done'],
  game: ['moment', 'now', 'lens', 'core', 'loop', 'stakes', 'first', 'back', 'depth', 'not', 'feel', 'done'],
  plain: ['moment', 'now', 'core', 'first', 'back', 'not', 'feel', 'done'],
};
export const linesOf = (kind: DiveKind): DiveLineId[] => ORDER[kind];

/** What each line asks, as the owner reads it. */
export const ASKS: Record<DiveLineId, string> = {
  moment: '누가, 어떤 순간에 필요한가: 언제, 어디서, 무엇을 하다가',
  now: '그 순간 지금은 무엇으로 하고, 그게 어디서 모자란가',
  core: '그 한 가지: 사람이 얻는 것 한 문장 (게임은 플레이어의 동사와 재미 한 문장)',
  first: '처음 1분에 무슨 일이 일어나나',
  back: '내일, 다음 주에 왜 다시 여나',
  not: '일부러 하지 않는 것 셋 이상',
  feel: '닮고 싶은 제품이나 게임 하나와 그 이유',
  done: '다 됐을 때 "이거다"라고 알아보는 기준: 누구에게 보여 주며 뭐라고 말하나',
  pain: '마지막으로 불편했던 때: 언제, 무엇을 하다가, 그래서 어떻게 했나',
  home: '기존 앱에 붙는 기능인가, 따로 서는 앱인가 (남의 앱이면 그 앱은 왜 이걸 안 만들었을까)',
  loop: '30초, 5분, 한 시간 단위로 반복되는 것',
  stakes: '무엇으로 이기고 지나, 한 판은 얼마나 걸리나',
  depth: '백 시간째에도 새로운 것',
  lens: '보고서의 공통점 중 정면으로 노리는 것과 버리는 것, 각각의 이유',
};

export const LineStatus = z.enum(['open', 'proposed', 'settled', 'waived']);
export type LineStatus = z.infer<typeof LineStatus>;

export const DiveLine = z.object({
  status: LineStatus.default('open'),
  /** What the line holds, in the dive's words: a proposal, or what the owner's words settled. */
  says: z.string().max(1200).default(''),
  /** The owner's words that settled or waived it, exactly as they typed or chose them. Theirs alone. */
  said: z.string().max(1200).default(''),
  /** The owner settled it by taking the proposal as it stood ("네", "1번"). */
  accepted: z.boolean().default(false),
  at: z.string().nullable().default(null),
});
export type DiveLine = z.infer<typeof DiveLine>;

/** A way the idea could go, shown so the owner has something to react to: taken, folded into another, or dropped. */
export const Direction = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,30}$/),
  name: z.string().min(1).max(120),
  what: z.string().max(900).default(''),
  status: z.enum(['offered', 'taken', 'merged', 'dropped']).default('offered'),
  /** The owner's words that took, merged or dropped it. */
  said: z.string().max(900).default(''),
  /** The dive's own note: what it was merged into, what the owner's choice turned on. */
  note: z.string().max(600).default(''),
  at: z.string(),
});
export type Direction = z.infer<typeof Direction>;

/** Words read out in the world or in a file the owner gave (a report), with whether they were found there. */
export const Saw = z.object({
  id: z.string(),
  line: DiveLineId.nullable().default(null),
  url: z.string().nullable().default(null),
  file: z.string().nullable().default(null),
  page: z.number().int().positive().nullable().default(null),
  quote: z.string().min(2).max(1200),
  shows: z.string().min(2).max(400),
  seen: z.object({ at: z.string(), excerpt: z.string() }).nullable(),
  failed: z.string().nullable().default(null),
});
export type Saw = z.infer<typeof Saw>;

export const Dive = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,40}$/),
  createdAt: z.string(),
  kind: DiveKind,
  /** The owner's first words, as they said them. */
  seed: z.string().min(2).max(2000),
  lines: z.partialRecord(DiveLineId, DiveLine),
  directions: z.array(Direction).max(30).default([]),
  saw: z.array(Saw).max(200).default([]),
  /** The idea in one line, in the dive's words, written at the close. */
  summary: z.string().max(300).default(''),
  /** The owner's words on the one page, which close the dive. */
  closed: z.object({ said: z.string(), at: z.string() }).nullable().default(null),
});
export type Dive = z.infer<typeof Dive>;

// ---------------------------------------------------------------------------------------------------------
// Where a dive is kept.

/** Dives started where no product lives (the home folder, the harness's own repository) are kept here. */
export const divesDir = (env: NodeJS.ProcessEnv = process.env): string => (env.SZ_DIVES_DIR ? resolve(env.SZ_DIVES_DIR) : join(homedir(), '.studio-zero', 'dives'));
/** What the owner said while a dive was asked for or under way, one file a session, written by the plugin's hook. */
export const heardDir = (env: NodeJS.ProcessEnv = process.env): string => join(divesDir(env), '.heard');

const HARNESS = resolve(import.meta.dirname, '..', '..', '..');
const real = (path: string): string => {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
};

/**
 * A dive lives with the product it is about: `.sz/dive/` of the folder it was started in, empty or not. Started in
 * the home folder or in the harness's repository, where no product will live, it is kept under `divesDir` with the
 * day in its name, never in a scratch folder: the owner opens it later (a restart once wiped a night's work).
 */
export function diveRoot(projectDir: string, env: NodeJS.ProcessEnv = process.env, home = homedir()): { root: string; durable: boolean } {
  const here = real(projectDir);
  const harness = real(HARNESS);
  if (here === real(home) || here === harness || here.startsWith(`${harness}${sep}`)) return { root: divesDir(env), durable: true };
  return { root: join(projectDir, DIVE_DIR), durable: false };
}

const stateFile = (folder: string): string => join(folder, 'dive.json');

const refused = (err: unknown): string | null => {
  const code = (err as NodeJS.ErrnoException).code;
  return code === 'EPERM' || code === 'EACCES' ? code : null;
};

/** Why the dives kept outside any product cannot be listed by this command (a sandbox that lets it see the folder and not read it), or null. */
export function outsideDivesRefused(env: NodeJS.ProcessEnv = process.env): string | null {
  const dir = divesDir(env);
  try {
    if (existsSync(dir)) readdirSync(dir);
    return null;
  } catch (err) {
    const code = refused(err);
    if (code === null) throw err;
    return `${dir} could not be read here (${code}): the dives kept outside any product are not listed`;
  }
}

/**
 * Every dive this project can work from, oldest first: those kept under `.sz/dive/` of the product, and those started
 * where no product lived (`divesDir`), which a product finds only here, since nothing copies them into it. A dive of
 * the same id in both places is the product's copy. (Until 2026-11-26 only the first place was read: a brief written
 * before the product had a folder was not seen by its plan, its drawing or its builder, and `dive show` and
 * `dive brief` could not name it from inside the product.) What a sandbox does not let this command read of the
 * second place is left out, and `outsideDivesRefused` says so; the product's own dives are listed all the same.
 */
export function allDives(projectDir: string, env: NodeJS.ProcessEnv = process.env, home = homedir()): { folder: string; dive: Dive }[] {
  const { root } = diveRoot(projectDir, env, home);
  const outside = divesDir(env);
  const byId = new Map<string, { folder: string; dive: Dive }>();
  for (const dir of real(root) === real(outside) ? [root] : [root, outside]) {
    let names: string[];
    try {
      names = existsSync(dir) ? readdirSync(dir) : [];
    } catch (err) {
      if (dir === outside && refused(err) !== null) continue;
      throw err;
    }
    for (const name of names.filter((entry) => !entry.startsWith('.') && existsSync(stateFile(join(dir, entry))))) {
      const dive = readDive(join(dir, name));
      if (!byId.has(dive.id)) byId.set(dive.id, { folder: join(dir, name), dive });
    }
  }
  return [...byId.values()].sort((a, b) => a.dive.createdAt.localeCompare(b.dive.createdAt));
}

/** The folder of a dive that exists. */
export function diveFolder(projectDir: string, id: string, env: NodeJS.ProcessEnv = process.env, home = homedir()): string {
  const found = allDives(projectDir, env, home).find(({ dive }) => dive.id === id);
  if (!found) {
    const root = diveRoot(projectDir, env, home).root;
    const where = real(root) === real(divesDir(env)) ? root : `${root}, or ${divesDir(env)}`;
    const blocked = outsideDivesRefused(env);
    throw new Error(`no dive "${id}" here (${where})${blocked ? `; ${blocked}` : ''}. sz-eyes dive show lists them; sz-eyes dive new <id> --kind app|game|plain --seed "<the owner's first words>" starts one`);
  }
  return found.folder;
}

export function readDive(folder: string): Dive {
  if (!existsSync(stateFile(folder))) throw new Error(`no dive at ${folder}`);
  // A dive written before a line was added to its kind has that line open, not missing.
  const raw = JSON.parse(readFileSync(stateFile(folder), 'utf8')) as { kind?: unknown; lines?: Record<string, unknown> };
  const kind = DiveKind.safeParse(raw.kind);
  return Dive.parse({ ...raw, lines: { ...(kind.success ? Object.fromEntries(linesOf(kind.data).map((line) => [line, {}])) : {}), ...raw.lines } });
}

function write(folder: string, path: string, text: string, durable: boolean, flag: 'w' | 'wx' = 'w'): void {
  try {
    mkdirSync(folder, { recursive: true });
    writeFileSync(path, text, { flag });
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (flag === 'wx' && code === 'EEXIST') throw new Error(`${path} already exists: --force replaces it with the draft the owner approved`);
    if (durable && (code === 'EPERM' || code === 'EACCES')) throw new SandboxError(`${path} could not be written: this dive is kept outside the project (${folder}), where the session's command sandbox does not let a command write. Run sz-eyes dive outside the sandbox (dangerouslyDisableSandbox: true on the Bash call).`);
    throw err;
  }
}

const isDurable = (folder: string, env: NodeJS.ProcessEnv = process.env): boolean => real(folder).startsWith(`${real(divesDir(env))}${sep}`);

function writeDive(folder: string, value: Dive): void {
  write(folder, stateFile(folder), `${JSON.stringify(Dive.parse(value), null, 2)}\n`, isDurable(folder));
}

// ---------------------------------------------------------------------------------------------------------
// What the owner said.

/** One thing the owner said: typed as a message, or chosen or written in a question box. */
export interface Heard {
  at: string;
  kind: 'typed' | 'chose' | 'wrote' | 'note';
  words: string;
  question?: string;
  transcript?: string | null;
}

const HOURS = 3_600_000;

/**
 * Claude Code keeps typed prompts in the hook log and question-box answers in the transcript it names.
 * In Codex both the hook log and the rollout must belong to the active thread.
 */
export async function heardSince(since: string, env: NodeJS.ProcessEnv = process.env): Promise<Heard[]> {
  const dir = heardDir(env);
  const thread = env.CODEX_THREAD_ID;
  if (thread !== undefined && !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(thread)) return [];
  const from = new Date(since).getTime();
  const heard: Heard[] = [];
  const transcripts = new Set<string>();
  for (const name of globSync(thread ? thread + '.jsonl' : '*.jsonl', { cwd: dir })) {
    const path = join(dir, name);
    for (const line of readFileSync(path, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line) as { at?: string; prompt?: string; session?: string; transcript?: string | null };
        if (thread && entry.session !== thread) continue;
        if (!thread && typeof entry.transcript === 'string') transcripts.add(entry.transcript);
        if (typeof entry.at === 'string' && typeof entry.prompt === 'string' && new Date(entry.at).getTime() >= from) heard.push({ at: entry.at, kind: 'typed', words: entry.prompt, transcript: entry.transcript ?? null });
      } catch {
        // A line cut off by a full disk says nothing.
      }
    }
  }
  for (const transcript of transcripts) heard.push(...answersIn(transcript, from));
  if (thread) {
    const captured = new Set(heard.map((entry) => entry.words));
    for (const entry of await codexHeard(thread, from, env)) {
      if (!captured.has(entry.words)) heard.push(entry);
    }
  }
  // Codex can deliver a runtime notification in the user's place, including to the prompt hook.
  const inputs = thread ? heard.filter(({ words }) => !/^\s*<(?:subagent_notification|environment_context|turn_aborted|task-notification|system-reminder)\b/i.test(words)) : heard;
  return inputs.sort((a, b) => a.at.localeCompare(b.at));
}

/** What the owner said that can settle a dive: since two hours before it began (the seed comes first), or before now. */
export const heardFor = (value: Dive | null, now: string, env: NodeJS.ProcessEnv = process.env): Promise<Heard[]> => heardSince(new Date(new Date(value?.createdAt ?? now).getTime() - 2 * HOURS).toISOString(), env);

/** What the owner answered in question boxes, in one session's transcript. */
export function answersIn(transcript: string, from = 0): Heard[] {
  if (!existsSync(transcript)) return [];
  const heard: Heard[] = [];
  for (const line of readFileSync(transcript, 'utf8').split('\n')) {
    if (!line.includes('"answers"')) continue;
    try {
      const entry = JSON.parse(line) as { timestamp?: string; toolUseResult?: { questions?: { question?: string; options?: { label?: string }[] }[]; answers?: Record<string, unknown>; annotations?: Record<string, { notes?: unknown }> } };
      const result = entry.toolUseResult;
      if (!result || typeof result.answers !== 'object' || result.answers === null || typeof entry.timestamp !== 'string') continue;
      if (new Date(entry.timestamp).getTime() < from) continue;
      for (const [question, answer] of Object.entries(result.answers)) {
        if (typeof answer !== 'string' || answer.trim() === '') continue;
        const labels = (result.questions ?? []).find((q) => q.question === question)?.options?.map((o) => o.label ?? '') ?? [];
        const parts = answer.split(', ');
        const chose = labels.includes(answer) || (parts.length > 1 && parts.every((part) => labels.includes(part)));
        heard.push({ at: entry.timestamp, kind: chose ? 'chose' : 'wrote', words: answer, question, transcript });
      }
      for (const [question, note] of Object.entries(result.annotations ?? {})) {
        if (typeof note?.notes === 'string' && note.notes.trim() !== '') heard.push({ at: entry.timestamp, kind: 'note', words: note.notes, question, transcript });
      }
    } catch {
      // Not a line of this shape.
    }
  }
  return heard;
}

/** The owner's words, if these are among what they said. */
export const findHeard = (heard: Heard[], said: string): Heard | null => (said.trim().length === 0 ? null : (heard.find((h) => findQuote(h.words, said) !== null) ?? null));

function mustBeHeard(heard: Heard[], said: string, what: string): void {
  if (said.trim().length === 0) throw new Error(`${what} takes the owner's own words: --said "<what they typed or chose, as it stands>"`);
  if (findHeard(heard, said)) return;
  if (heard.length === 0) throw new Error(`nothing the owner said has been heard, so "${said.slice(0, 80)}" cannot be taken as theirs. Start the dive in the owner's conversation and ask them to reply there. Codex reads direct input from its active thread or prompt hook; Claude Code needs the sz prompt hook.`);
  throw new Error(`"${said.slice(0, 120)}" is not among what the owner said. Their words are taken as they typed or chose them, never as you would put them: quote the part of their answer that settles this. The last things they said:\n${heard
    .slice(-4)
    .map((h) => `  - ${h.kind === 'typed' ? '' : `(${h.kind}) `}${h.words.slice(0, 200)}`)
    .join('\n')}`);
}

// ---------------------------------------------------------------------------------------------------------
// Changing a dive.

export function newDive(projectDir: string, id: string, kind: DiveKind, seed: string, heard: Heard[], at: string, env: NodeJS.ProcessEnv = process.env, home = homedir()): string {
  if (!/^[a-z0-9][a-z0-9-]{0,40}$/.test(id)) throw new Error(`a dive's id is a few lowercase words joined by "-" ("${id}" is not)`);
  const { root, durable } = diveRoot(projectDir, env, home);
  const existing = allDives(projectDir, env, home).find(({ dive }) => dive.id === id);
  if (existing) throw new Error(`there is already a dive "${id}" (${existing.folder}): sz-eyes dive show ${id} says where it stands`);
  mustBeHeard(heard, seed, 'the seed');
  const folder = join(root, durable ? `${localDay(at)}-${id}` : id);
  writeDive(folder, Dive.parse({ id, createdAt: at, kind, seed: seed.trim(), lines: Object.fromEntries(linesOf(kind).map((line) => [line, DiveLine.parse({})])), directions: [], saw: [], summary: '', closed: null }));
  return folder;
}

function openOnly(value: Dive): void {
  if (value.closed) throw new Error(`dive ${value.id} was closed at ${value.closed.at}; a closed dive is read, not changed. To go on from it: sz-eyes dive new <another id> --seed "<the owner's words>"`);
}

/** Sets a line. A proposal is the dive's; settled and waived are the owner's, by their own words, and nothing else. */
export function setDiveLine(folder: string, id: DiveLineId, change: { status?: LineStatus; says?: string; said?: string }, heard: Heard[], at: string): DiveLine {
  const value = readDive(folder);
  openOnly(value);
  const before = value.lines[id];
  if (!before) throw new Error(`${id} is not a line of a ${value.kind} dive. Its lines: ${linesOf(value.kind).join(', ')}`);
  const says = change.says?.trim();
  const said = change.said?.trim() ?? '';
  let next: DiveLine;
  if (change.status === undefined) {
    if (says === undefined) throw new Error('nothing to change: --says "<what the line holds>" or --status open|proposed|settled|waived');
    if (before.status === 'settled' || before.status === 'waived') throw new Error(`${id} was ${before.status} by the owner's words ("${before.said}"); it changes only by their words again: --status settled --said "<their words>" --says "<what it holds now>"`);
    next = { ...before, says, at };
  } else if (change.status === 'proposed') {
    if (said) throw new Error('a proposal is the dive\'s, not the owner\'s: leave --said out. When they answer it, --status settled --said "<their words>"');
    const text = says ?? before.says;
    if (text.length < 4) throw new Error(`say what you propose: --says "<${ASKS[id]}>"`);
    next = { status: 'proposed', says: text, said: '', accepted: false, at };
  } else if (change.status === 'settled') {
    mustBeHeard(heard, said, `settling ${id}`);
    const text = says ?? before.says;
    if (text.length < 4) throw new Error(`say what is settled, from what they said: --says "<${ASKS[id]}>"`);
    next = { status: 'settled', says: text, said, accepted: before.status === 'proposed' && text === before.says, at };
  } else if (change.status === 'waived') {
    mustBeHeard(heard, said, `leaving ${id} open`);
    next = { status: 'waived', says: says ?? before.says, said, accepted: false, at };
  } else next = { status: 'open', says: says ?? before.says, said: '', accepted: false, at };
  writeDive(folder, { ...value, lines: { ...value.lines, [id]: DiveLine.parse(next) } });
  return next;
}

/** Records a direction shown to the owner, or what they made of it. */
export function setDirection(folder: string, change: { id: string; name?: string; what?: string; status?: Direction['status']; said?: string; note?: string }, heard: Heard[], at: string): Direction {
  const value = readDive(folder);
  openOnly(value);
  const before = value.directions.find((d) => d.id === change.id);
  if (!before && (!change.name || (change.what ?? '').trim().length < 8)) throw new Error('a new direction has a name and says what it is, as the owner was shown it: --name "<a few words>" --what "<who, what they do, why it is a different kind>"');
  const status = change.status ?? before?.status ?? 'offered';
  const said = change.said?.trim() ?? (change.status === undefined ? (before?.said ?? '') : '');
  if (status !== 'offered') mustBeHeard(heard, said, `a direction ${status}`);
  // A direction folded into another keeps only the part the owner took: shown whole under what was chosen, the rest of
  // it read as wanted (in the evaluation, the only wrong things two dive pages said about what the owner wanted).
  if (status === 'merged' && (change.note ?? before?.note ?? '').trim().length < 8) throw new Error('a direction merged into another says which part of it the owner took, and only that part reaches the page: --note "<the part taken>"');
  const next = Direction.parse({ ...before, ...Object.fromEntries(Object.entries({ id: change.id, name: change.name, what: change.what, note: change.note }).filter(([, v]) => v !== undefined)), status, said: status === 'offered' ? '' : said, at });
  writeDive(folder, { ...value, directions: before ? value.directions.map((d) => (d.id === next.id ? next : d)) : [...value.directions, next] });
  return next;
}

/** Words found, or not, where they were said to stand: a page out in the world or a file the owner gave. */
export function addSaw(folder: string, saw: { line: DiveLineId | null; url: string | null; file: string | null; page: number | null; quote: string; shows: string }, found: { seen: Pick<Seen, 'at' | 'excerpt'> | null; why: string | null }): Saw {
  const value = readDive(folder);
  if (saw.line && !value.lines[saw.line]) throw new Error(`${saw.line} is not a line of a ${value.kind} dive. Its lines: ${linesOf(value.kind).join(', ')}`);
  const same = value.saw.find((s) => s.url === saw.url && s.file === saw.file && s.quote === saw.quote);
  const id = same?.id ?? `s${value.saw.reduce((max, s) => Math.max(max, Number(s.id.slice(1)) || 0), 0) + 1}`;
  const made = Saw.parse({ ...saw, id, seen: found.seen ? { at: found.seen.at, excerpt: found.seen.excerpt } : null, failed: found.seen ? null : (found.why ?? 'not found') });
  writeDive(folder, { ...value, saw: same ? value.saw.map((s) => (s.id === id ? made : s)) : [...value.saw, made] });
  return made;
}

/**
 * Looks for words in a file the owner gave: a PDF page by page (with `pdftotext`, on the page named), anything
 * else as text. A report's quotation is checked on its page, so a lens taken from it says where it stands.
 */
export function seeInFile(path: string, quote: string, page: number | null, at: string): { seen: { at: string; excerpt: string } | null; why: string | null } {
  if (!existsSync(path)) return { seen: null, why: `there is no file ${path}` };
  let text: string;
  if (extname(path).toLowerCase() === '.pdf') {
    const run = spawnSync('pdftotext', ['-layout', ...(page ? ['-f', String(page), '-l', String(page)] : []), path, '-'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    if (run.error) return { seen: null, why: `pdftotext is not on this machine, so the words were not looked for in ${path}` };
    if (run.status !== 0) return { seen: null, why: `pdftotext could not read ${path}${page ? ` at page ${page}` : ''}: ${run.stderr.trim().slice(0, 160)}` };
    text = run.stdout;
  } else text = readFileSync(path, 'utf8');
  const excerpt = findQuote(text, quote);
  return excerpt ? { seen: { at, excerpt }, why: null } : { seen: null, why: `these words are not in ${path}${page && extname(path).toLowerCase() === '.pdf' ? ` on page ${page}` : ''}` };
}

/** What still stands between a dive and its close, as lines; empty when nothing does. */
export function leftBefore(value: Dive): string[] {
  const left: string[] = [];
  for (const id of linesOf(value.kind)) {
    const line = value.lines[id]!;
    if (line.status === 'open') left.push(`${id} is open (${ASKS[id]})`);
    else if (line.status === 'proposed') left.push(`${id} is only proposed, and the owner has not answered it: "${line.says.slice(0, 120)}"`);
  }
  const offered = value.directions.length;
  if (offered < 3) left.push(`${offered} direction(s) were shown: the first round shows three of different kinds and a wildcard before narrowing (sz-eyes dive direction ...)`);
  if (!value.directions.some((d) => d.status === 'taken' || d.status === 'merged')) left.push('no direction was taken by the owner (sz-eyes dive direction <id> <direction> --status taken --said "<their words>")');
  return left;
}

/** One line the owner reads after every round. */
export function progressLine(value: Dive): string {
  const ids = linesOf(value.kind);
  const clear = ids.filter((id) => value.lines[id]!.status === 'settled' || value.lines[id]!.status === 'waived');
  const open = ids.filter((id) => value.lines[id]!.status === 'open');
  const proposed = ids.filter((id) => value.lines[id]!.status === 'proposed');
  return `명확해진 줄 ${clear.length}/${ids.length}${open.length > 0 ? ` · 열린 것: ${open.join(', ')}` : ''}${proposed.length > 0 ? ` · 답을 기다리는 안: ${proposed.join(', ')}` : ''}`;
}

/** Closes a dive on the owner's words about its one page, and writes that page. */
export function closeDive(folder: string, said: string, summary: string, heard: Heard[], at: string): string {
  const value = readDive(folder);
  openOnly(value);
  const left = leftBefore(value);
  if (left.length > 0) throw new Error(`dive ${value.id} is not clear yet:\n${left.map((line) => `  - ${line}`).join('\n')}`);
  if (summary.trim().length < 8) throw new Error('say the idea in one line: --summary "<for whom, in what moment, it does what>"');
  mustBeHeard(heard, said, 'the close');
  const closed: Dive = { ...value, summary: summary.trim(), closed: { said: said.trim(), at } };
  writeDive(folder, closed);
  const path = join(folder, 'idea.md');
  write(folder, path, ideaPage(closed, folder), isDurable(folder));
  return path;
}

function briefHeadings(draft: string): string[] {
  const headings: string[] = [];
  let fence = '';
  for (const line of draft.replace(/<!--[\s\S]*?(?:-->|$)/g, '').split(/\r?\n/)) {
    const delimiter = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (delimiter) {
      const mark = delimiter[1]!;
      if (!fence) fence = mark;
      else if (mark.startsWith(fence) && !delimiter[2]!.trim()) fence = '';
    } else if (!fence && line.startsWith('## ')) headings.push(line.trimEnd());
  }
  return headings;
}

/** The heard log establishes whose words they are. The dive asks for those words on this draft. */
export function writeBrief(folder: string, draft: string, said: string, heard: Heard[], _at: string, { force = false } = {}): string {
  const value = readDive(folder);
  if (value.closed === null) throw new Error(`the brief is written after the dive closes: sz-eyes dive close ${value.id} --summary … --said …`);
  mustBeHeard(heard, said, 'the brief');
  if (['나중에', '아직', '보류', 'later', 'not now'].includes(said.trim().toLowerCase())) {
    throw new Error(`the brief is written on their yes to this page, not on their 'not now': ${said.trim()}`);
  }

  const headings = briefHeadings(draft);
  let previous = -1;
  for (const required of BRIEF_SECTIONS[value.kind]) {
    const index = headings.indexOf(required);
    if (index < 0) throw new Error(`the ${value.kind} brief is missing ${required}`);
    if (index <= previous) throw new Error(`headings out of order: ${required} follows ${headings[previous]}`);
    if (headings.lastIndexOf(required) !== index) throw new Error(`the brief has more than one ${required}`);
    previous = index;
  }

  const words = [value.seed, ...Object.values(value.lines).map((line) => line.said), ...value.directions.map((d) => d.said), value.closed.said];
  // Markdown can emphasise the label, its colon, or the quotation. Match those markers outside the quoted words.
  for (const match of draft.matchAll(/주인[\s*_]*:[\s*_]*(?:"([^"]*)(?:"|$)|“([^”]*)(?:”|$))/gu)) {
    const quote = match[1] ?? match[2]!;
    const closer = match[1] === undefined ? '”' : '"';
    if (!match[0].endsWith(closer) || !words.some((answer) => findQuote(answer, quote) !== null)) {
      throw new Error(`"${quote}" is quoted as the owner's, and they did not say it: quote what they said, or write it as what will be built`);
    }
  }

  const path = join(folder, BRIEF_FILE);
  write(folder, path, draft, isDurable(folder), force ? 'w' : 'wx');
  return path;
}

// ---------------------------------------------------------------------------------------------------------
// What is read.

const STATUS: Record<LineStatus, string> = { open: '열림', proposed: '안만 있음', settled: '정해짐', waived: '비워 둠' };
const quoteOwner = (line: { said: string; accepted?: boolean }): string => `주인: "${line.said}"${line.accepted ? ' (추천안을 받아들임)' : ''}`;
const sawLine = (s: Saw): string => `${s.shows}: "${s.quote}" (${s.url ?? `${s.file}${s.page ? ` ${s.page}쪽` : ''}`}${s.seen ? `, ${localDay(s.seen.at)}에 확인` : `, 찾지 못함: ${s.failed}`})`;

export function renderDive(value: Dive, folder: string): string {
  const lines = [`dive ${value.id} (${folder}): ${value.kind}${value.closed ? `, closed ${value.closed.at}` : ''}`, `  seed: "${value.seed}"`, `  ${progressLine(value)}`];
  for (const id of linesOf(value.kind)) {
    const line = value.lines[id]!;
    lines.push('', `${id} [${line.status}] ${ASKS[id]}`, ...(line.says ? [`  says: ${line.says}`] : []), ...(line.said ? [`  ${quoteOwner(line)}`] : []));
  }
  if (value.directions.length > 0) lines.push('', 'directions:', ...value.directions.map((d) => `  ${d.id} [${d.status}] ${d.name}: ${d.what}${d.said ? `\n     주인: "${d.said}"` : ''}${d.note ? `\n     note: ${d.note}` : ''}`));
  if (value.saw.length > 0) lines.push('', 'seen:', ...value.saw.map((s) => `  ${s.id}${s.line ? ` (${s.line})` : ''} ${s.seen ? 'seen' : 'NOT SEEN'} ${sawLine(s)}`));
  const left = leftBefore(value);
  if (!value.closed && left.length > 0) lines.push('', 'before it can close:', ...left.map((line) => `  - ${line}`));
  if (value.closed) lines.push('', `closed on: "${value.closed.said}"`, `page: ${join(folder, 'idea.md')}`);
  if (existsSync(join(folder, BRIEF_FILE))) lines.push(`brief: ${join(folder, BRIEF_FILE)}`);
  return lines.join('\n');
}

/**
 * A line for each dive. Given the folder this project keeps its dives in, those kept outside any product come after
 * its own, under a line that says whose they are: every idea dug out before a product had a folder is listed in
 * every product, and is this one's only when the owner says so.
 */
export function renderDives(dives: { folder: string; dive: Dive }[], root: string | null = null): string {
  if (dives.length === 0) return 'no dive here (sz-eyes dive new <id> --kind app|game|plain --seed "<the owner\'s first words>")';
  const line = ({ folder, dive }: { folder: string; dive: Dive }): string => `${dive.id}: ${dive.closed ? 'closed' : progressLine(dive)}  "${dive.seed.slice(0, 80)}"  (${folder})`;
  const own = root === null ? dives : dives.filter(({ folder }) => real(folder).startsWith(`${real(root)}${sep}`));
  const outside = dives.filter((entry) => !own.includes(entry));
  return [
    ...own.map(line),
    ...(outside.length > 0 ? [`kept outside any product (${dirname(outside[0]!.folder)}): one of these is this product's only when the owner names it or its seed is plainly this product`, ...outside.map(line)] : []),
  ].join('\n');
}

/** The one page the owner and the next stages read. */
export function ideaPage(value: Dive, folder: string, env: NodeJS.ProcessEnv = process.env): string {
  const ids = linesOf(value.kind);
  const settled = ids.filter((id) => value.lines[id]!.status === 'settled');
  const waived = ids.filter((id) => value.lines[id]!.status === 'waived');
  const taken = value.directions.filter((d) => d.status === 'taken');
  const merged = value.directions.filter((d) => d.status === 'merged');
  const dropped = value.directions.filter((d) => d.status === 'dropped' || d.status === 'offered');
  const kind = { app: '앱', game: '게임', plain: '그 밖' }[value.kind];
  const durable = isDurable(folder, env);
  return `# ${value.summary || value.seed}

- 씨앗 (주인의 첫 말, 그대로): "${value.seed}"
- 갈래: ${kind} · 시작 ${localDay(value.createdAt)}${value.closed ? ` · 닫음 ${localDay(value.closed.at)}` : ''}
${value.closed ? `- 이 한 장을 보고 주인이 한 말: "${value.closed.said}"\n` : ''}
## 정해진 것

${settled.map((id) => `### ${ASKS[id]}\n\n${value.lines[id]!.says}\n\n> ${quoteOwner(value.lines[id]!)}\n`).join('\n')}
## 비워 둔 것

${waived.length > 0 ? waived.map((id) => `- ${ASKS[id]}${value.lines[id]!.says ? `: ${value.lines[id]!.says}` : ''} (${quoteOwner(value.lines[id]!)})`).join('\n') : '없음'}

## 고른 방향

${taken.length > 0 ? taken.map((d) => `- **${d.name}**: ${d.what}${d.said ? ` (주인: "${d.said}")` : ''}${d.note ? ` ${d.note}` : ''}`).join('\n') : '없음'}
${merged.length > 0 ? `\n다른 방향에서 일부만 가져온 것:\n\n${merged.map((d) => `- ${d.name}에서: ${d.note} (주인: "${d.said}")`).join('\n')}\n` : ''}
## 버린 방향

${dropped.length > 0 ? dropped.map((d) => `- **${d.name}**: ${d.what}${d.status === 'dropped' ? ` (주인: "${d.said}")` : ' (주인이 고르지 않음)'}${d.note ? ` ${d.note}` : ''}`).join('\n') : '없음'}

## 세상에서 본 것

${value.saw.length > 0 ? value.saw.map((s) => `- ${s.line ? `[${s.line}] ` : ''}${sawLine(s)}${s.url ? `\n  ${s.url}` : ''}`).join('\n') : '없음'}

## 다음에 할 수 있는 것

- 지을 만한지, 돈 낼 만한지 따져 보려면: \`/sz:worth\`
- 지으려면: \`/sz:build ${value.summary || value.seed}\` (정해진 것은 다시 묻지 않습니다)
${durable ? `- 이 생각은 제품 폴더 밖(\`${dirname(folder)}\`)에 있습니다. 제품 폴더에서도 \`sz-eyes dive show\`가 이 생각을 "제품 밖" 줄 아래에 보여 주고, 계획·설계는 요청이 이 생각을 가리킬 때 여기서 읽습니다. 제품과 함께 두려면 제품 폴더에서 \`mkdir -p .sz/dive && cp -R "${folder}" .sz/dive/${value.id}\` 하십시오(같은 id면 제품 폴더 것이 먼저 쓰입니다).\n` : ''}`;
}
