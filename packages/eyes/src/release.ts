import { ShownBy, allContracts, type Claim, type Contract } from './contract.ts';
import { fingerprints } from './fingerprint.ts';

/**
 * A release is proven like any other work: by someone who did not make it, on the thing itself. What is proven
 * is not chosen afresh each time by whoever is in a hurry to ship. It is this gate, the same for every release
 * of every product, in two halves: before the switch, on the version that is about to go out (the candidate),
 * and after it, on what people reach. A line of the gate is either shown or waived with a reason the owner
 * reads; it is never quietly left out.
 *
 * Each line is here because of a way releases made by agents have gone wrong in the field: a build that works
 * on the developer's machine and not as built for production; an admin key in the script a browser downloads;
 * a database anyone can read; a migration that lost what people had stored (most often a column renamed where
 * one should have been added); a release nobody could take back;
 * a deploy that "succeeded" while the old version, or an error page, kept answering.
 */

type Line = {
  id: string;
  half: 'before' | 'after';
  says: (g: Gate) => string;
  /** How it is shown: the name of the gate's own field that carries it, or a command the gate writes itself. */
  shown: (g: Gate) => string | null;
  /** Why it is left out without being asked, or null when it applies. */
  skipped?: (g: Gate) => string | null;
};

export interface Gate {
  place: string;
  url: string;
  commit: string;
  previous: string | null;
  /** Where the candidate answers, or null for a look at what is already live (only the second half is made). */
  candidate: string | null;
  /** `<kind>:<ref>` or a bare command, for each line the product has to say how to show. */
  check: string | null;
  strangers: string | null;
  data: string | null;
  backup: string | null;
  wayBack: string | null;
  walk: string | null;
  errors: string | null;
  kept: string | null;
  /** Files that hold the server's secrets, whose values are looked for in what a browser downloads. */
  env: string[];
  /** The migration files (.sql) that changed since the previous release. */
  migrations: string[];
  /** Where the service says which version it is, when that is not `/healthz`. */
  versionAt: string | null;
}

const leaks = (url: string, g: Gate): string => `command:sz-eyes web leaks ${url}${g.env.map((file) => ` --env ${file}`).join('')}`;
const first = (g: Gate): string | null => (g.previous === null ? '첫 출하: 아직 살아 있는 데이터가 없다' : null);

const LINES: Line[] = [
  { id: 'rc-stands', half: 'before', says: () => '전에 증명한 약속이, 내보낼 버전을 내보낼 모양 그대로 띄운 것(후보)에서 그대로 참이다', shown: (g) => g.check },
  { id: 'rc-secrets', half: 'before', says: () => '후보에서 브라우저가 내려받는 것 안에 서버의 비밀(관리자 키, 결제 비밀 키)이 없다', shown: (g) => leaks(g.candidate!, g) },
  { id: 'rc-strangers', half: 'before', says: () => '남이 넣은 것은 보이지 않는다: 다른 사람도, 로그인하지 않은 사람도 읽거나 고치지 못한다', shown: (g) => g.strangers },
  { id: 'rc-data', half: 'before', says: () => '지금 살아 있는 데이터의 사본으로 새 버전이 뜨고, 사람들이 넣어 둔 것이 그대로 보인다', shown: (g) => g.data, skipped: first },
  {
    id: 'rc-shape',
    half: 'before',
    says: () => '저장 모양을 바꾸는 것 가운데 넣어 둔 것을 잃거나 앞 버전을 깨는 것이 없다',
    shown: (g) => `command:sz-eyes migrations look --since ${g.previous} --until ${g.commit}`,
    skipped: (g) => first(g) ?? (g.migrations.length === 0 ? '이전 출하 뒤로 바뀐 마이그레이션 파일(.sql)이 없다' : null),
  },
  { id: 'rc-backup', half: 'before', says: () => '데이터의 사본을 뜰 수 있고, 그 사본에서 되살려지는 것을 봤다', shown: (g) => g.backup },
  { id: 'rc-back', half: 'before', says: () => '되돌리는 길이 적혀 있고, 후보에서 한 번 해 봤다', shown: (g) => g.wayBack },
  { id: 'live-same', half: 'after', says: (g) => `사람들이 닿는 주소에서 답하는 것이 이 버전(${g.commit.slice(0, 7)})이다`, shown: (g) => `command:sz-eyes web live ${g.url} --commit ${g.commit}${g.versionAt ? ` --at ${g.versionAt}` : ''}` },
  { id: 'live-walk', half: 'after', says: () => '살아 있는 서비스에서 이 제품의 한 가지 일이 처음부터 끝까지 된다', shown: (g) => g.walk },
  { id: 'live-secrets', half: 'after', says: () => '살아 있는 주소에서도 서버의 비밀이 내려오지 않는다', shown: (g) => leaks(g.url, g) },
  { id: 'live-quiet', half: 'after', says: () => '내보낸 뒤에 새 오류가 기록되지 않았다', shown: (g) => g.errors },
  { id: 'live-kept', half: 'after', says: () => '내보내기 전에 사람들이 넣어 둔 것이 내보낸 뒤에도 그대로다', shown: (g) => g.kept, skipped: first },
];

/** The ids of the gate's lines, for whoever names one to waive. */
export const GATE_LINES: readonly string[] = LINES.map((line) => line.id);

/** The flag that carries how each line is shown, for the lines the product has to say. */
const FLAG: Record<string, string> = { 'rc-stands': '--check', 'rc-strangers': '--strangers', 'rc-data': '--data', 'rc-backup': '--backup', 'rc-back': '--way-back', 'live-walk': '--walk', 'live-quiet': '--errors', 'live-kept': '--kept' };

const shownBy = (text: string): Claim['shownBy'] => {
  const at = text.indexOf(':');
  const kind = at > 0 ? text.slice(0, at) : '';
  return ['flow', 'test', 'look', 'command', 'owner'].includes(kind) ? ShownBy.parse({ kind, ref: text.slice(at + 1).trim() }) : ShownBy.parse({ kind: 'command', ref: text.trim() });
};

export interface GateResult {
  claims: Pick<Claim, 'id' | 'says' | 'shownBy'>[];
  /** Lines that are not shown this time, each with why, as the owner reads them. */
  waived: string[];
}

/**
 * The claims of one release, or of one look at what is live. Throws, naming every line at once, when a line is
 * neither given a way to be shown nor waived with a reason.
 */
export function gate(g: Gate, without: ReadonlyMap<string, string>): GateResult {
  const unknown = [...without.keys()].filter((id) => !GATE_LINES.includes(id));
  if (unknown.length > 0) throw new Error(`not a line of the gate: ${unknown.join(', ')}. Its lines: ${GATE_LINES.join(', ')}`);
  const claims: GateResult['claims'] = [];
  const waived: string[] = [];
  const missing: string[] = [];
  for (const line of LINES) {
    if (g.candidate === null && line.half === 'before') continue;
    const why = without.get(line.id);
    if (why !== undefined) {
      if (why.trim().length < 8) throw new Error(`say why ${line.id} does not apply to this product: --without "${line.id}|<why>"`);
      waived.push(`${line.id} (${line.says(g)}): ${why.trim()}`);
      continue;
    }
    const skipped = line.skipped?.(g) ?? null;
    if (skipped !== null) {
      waived.push(`${line.id} (${line.says(g)}): ${skipped}`);
      continue;
    }
    const shown = line.shown(g);
    if (shown === null || shown.trim() === '') missing.push(`${line.id}: ${line.says(g)}\n      give ${FLAG[line.id]} "<how it is shown>", or --without "${line.id}|<why it does not apply>"`);
    else claims.push({ id: line.id, says: line.says(g), shownBy: shownBy(shown) });
  }
  if (missing.length > 0) throw new Error(`the gate has ${missing.length} line(s) with no way to be shown. Each is shown or waived with a reason the owner reads, never left out:\n${missing.map((line) => `  - ${line}`).join('\n')}`);
  return { claims, waived };
}

/** The releases and looks of a project, oldest first. */
export const releases = (projectDir: string): Contract[] => allContracts(projectDir).map((entry) => entry.contract).filter((contract) => contract.release !== null);

/** The last release to a place that went out and was not taken back: what should be answering there now. */
export function lastRelease(projectDir: string, place: string): Contract | null {
  return (
    releases(projectDir)
      .filter((contract) => contract.release!.place === place && contract.release!.candidate !== null && contract.release!.takenBack === null && contract.closedAt !== null)
      .at(-1) ?? null
  );
}

/** A release contract, frozen as it is made: nothing is built against it, and its checks are the gate's. */
export function releaseContract(projectDir: string, id: string, g: Gate, extra: { without: ReadonlyMap<string, string>; claims: GateResult['claims']; frozen: string[]; now: string }): Contract {
  const made = gate(g, extra.without);
  const look = g.candidate === null;
  return {
    id,
    request: look ? `${g.place}에 살아 있는 것 점검 (${g.commit.slice(0, 7)})` : `${g.place}에 ${g.commit.slice(0, 7)} 내보내기${g.previous ? ` (지금 살아 있는 것: ${g.previous.slice(0, 7)})` : ' (첫 출하)'}`,
    lane: 'M',
    targets: [],
    claims: [...made.claims, ...extra.claims].map((claim) => ({ ...claim, status: 'unproven' as const, evidence: [], note: '' })),
    notDoing: made.waived,
    risks: [],
    frozen: extra.frozen,
    frozenAt: extra.now,
    frozenPrints: fingerprints(projectDir, extra.frozen),
    createdAt: extra.now,
    noticed: [],
    amendments: [],
    supersedes: [],
    release: { place: g.place, url: g.url, candidate: g.candidate, commit: g.commit, previous: g.previous, wayBack: g.wayBack ? shownBy(g.wayBack).ref : '', takenBack: null },
    closedAt: null,
  };
}

const verdictOf = (contract: Contract): string => {
  if (contract.release!.takenBack) return '되돌림';
  const count = (status: Claim['status']): number => contract.claims.filter((claim) => claim.status === status).length;
  if (count('refuted') > 0) return `반증 ${count('refuted')}`;
  if (contract.closedAt === null) return `진행 중 (아직 ${count('unproven')})`;
  return `증명 ${count('proven')}${count('unchecked') > 0 ? ` · 확인 못 함 ${count('unchecked')}` : ''}`;
};

/** The history of a project's releases as the owner reads it. */
export function renderReleases(projectDir: string): string {
  const all = releases(projectDir);
  if (all.length === 0) return 'no release is recorded for this project';
  const places = [...new Set(all.map((contract) => contract.release!.place))];
  const lines: string[] = [];
  for (const place of places) {
    const live = lastRelease(projectDir, place);
    lines.push(`${place}: ${live ? `${live.release!.commit.slice(0, 7)} is what was last released (${live.id}, ${live.closedAt!.slice(0, 10)}) at ${live.release!.url}` : 'nothing released there stands'}`);
    for (const contract of all.filter((c) => c.release!.place === place)) {
      const r = contract.release!;
      lines.push(`  - ${contract.id} ${contract.createdAt.slice(0, 10)} ${r.candidate === null ? '점검' : '출하'} ${r.previous ? `${r.previous.slice(0, 7)} → ` : ''}${r.commit.slice(0, 7)}: ${verdictOf(contract)}${r.takenBack ? ` (${r.takenBack.note})` : ''}`);
    }
    if (live?.release!.wayBack) lines.push(`  way back: ${live.release!.wayBack}`);
  }
  return lines.join('\n');
}
