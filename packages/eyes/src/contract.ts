import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { z } from 'zod';

/** Where a project keeps what the harness knows of it. */
export const SZ_DIR = '.sz';
export const CONTRACTS_DIR = `${SZ_DIR}/contracts`;
export const EVIDENCE_DIR = `${SZ_DIR}/evidence`;

/**
 * How much process a piece of work gets. S: a few files, no new screen and no schema: do it, and show it. M: one
 * feature: a handful of claims, built, then proven once by someone who did not build it. L: several features or
 * a new product: the owner is asked what only they can say, the work is cut into milestones, each with its own
 * contract.
 */
export const Lane = z.enum(['S', 'M', 'L']);
export type Lane = z.infer<typeof Lane>;

/**
 * How a claim is shown to be true. `flow`: a flow file run on the product (Maestro on a phone, Playwright on a
 * page). `test`: a test command. `look`: the screen itself, looked at in a named state. `command`: any command
 * whose exit says it. `owner`: nothing a machine can say (is it fun, does it sound right): left for the owner.
 */
export const ShownBy = z.object({ kind: z.enum(['flow', 'test', 'look', 'command', 'owner']), ref: z.string().max(600) });

/**
 * `unproven` is where every claim starts and where it stays until someone shows otherwise. `unchecked`: it
 * could not be checked here (no device, no way to see it), and that is said instead of assumed.
 */
export const ClaimStatus = z.enum(['unproven', 'proven', 'refuted', 'unchecked']);
export type ClaimStatus = z.infer<typeof ClaimStatus>;

export const Claim = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,30}$/),
  /** What will be true, as the owner would say it and could see it. */
  says: z.string().min(4).max(400),
  shownBy: ShownBy,
  status: ClaimStatus.default('unproven'),
  /** Files that show it, relative to the contract's evidence folder. */
  evidence: z.array(z.string().max(300)).max(24).default([]),
  note: z.string().max(1200).default(''),
});
export type Claim = z.infer<typeof Claim>;

/**
 * One piece of work, agreed before it is built: what was asked, what will be true when it is done and how each
 * of those will be shown, what is deliberately not done, and what could go wrong. Whoever builds does not edit
 * it once it is frozen, nor the flows and tests it points at: a claim is proven by someone else, on the product.
 */
/**
 * A contract that is a release: a version of the product put where people reach it. Its claims are the release
 * gate (`release.ts`), not something to build. They are about one version at one place at one time, so they do
 * not join the promises the product keeps: the next release, or a look at what is live, shows them again.
 */
export const Release = z.object({
  /** The name the map gives the place the product runs for people. */
  place: z.string().min(1).max(60),
  /** Where people reach it. */
  url: z.string().max(400),
  /** Where the version that is about to go out answers before it does, or null for a look at what is already live. */
  candidate: z.string().max(400).nullable().default(null),
  /** The commit that goes out, and the one it takes the place of. */
  commit: z.string().max(60),
  previous: z.string().max(60).nullable().default(null),
  /** The command that puts the previous version back. */
  wayBack: z.string().max(600).default(''),
  /** Set when the release was taken back: what was done and what answers now. */
  takenBack: z.object({ at: z.string(), note: z.string().max(1200) }).nullable().default(null),
});
export type Release = z.infer<typeof Release>;

export const Contract = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{2,60}$/),
  request: z.string().min(1).max(4000),
  lane: Lane,
  /** What the product runs as, for whoever verifies: `web`, `ios`, `android`, `macos`, `windows`, `game`. */
  targets: z.array(z.string().max(20)).max(6).default([]),
  claims: z.array(Claim).min(1).max(60),
  notDoing: z.array(z.string().max(300)).max(20).default([]),
  risks: z.array(z.string().max(300)).max(20).default([]),
  /** Paths the builder may not change while this is open (the flows and tests the claims point at). */
  frozen: z.array(z.string().max(300)).max(60).default([]),
  frozenAt: z.string().nullable().default(null),
  /** A fingerprint of each frozen path as it was at the freeze, or after the arbiter's last correction of it. */
  frozenPrints: z.record(z.string(), z.string()).default({}),
  createdAt: z.string(),
  /**
   * What whoever verified noticed that no claim covers: an error the page logged, a control too small to press,
   * a number that does not add up. Nobody asked, and the owner would want to know.
   */
  noticed: z.array(z.object({ text: z.string().max(600), evidence: z.array(z.string().max(300)).max(6).default([]) })).max(30).default([]),
  /**
   * Corrections made to a frozen check after the freeze, each by someone who neither built the work nor judges
   * it: which file, and why the check was wrong about how to check (never about what it checks).
   */
  amendments: z.array(z.object({ file: z.string().max(300), why: z.string().max(800), at: z.string() })).max(20).default([]),
  /**
   * Claims of earlier, closed contracts that stop standing because of this work: what was asked has changed. Each
   * names the contract and the claim, and says why, for the owner to read. Everything else that stood keeps
   * standing, and this work must keep it true.
   */
  supersedes: z.array(z.object({ contract: z.string().max(61), claim: z.string().max(31), why: z.string().min(8).max(600), at: z.string().nullable().default(null) })).max(30).default([]),
  /** Set when the contract is a release (or a look at what is live), with where and which version. */
  release: Release.nullable().default(null),
  /** Set when the work is closed: by whom, and with what left. */
  closedAt: z.string().nullable().default(null),
});
export type Contract = z.infer<typeof Contract>;

export function readContract(file: string): Contract {
  return Contract.parse(JSON.parse(readFileSync(file, 'utf8')));
}

export function writeContract(file: string, contract: Contract): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(Contract.parse(contract), null, 2)}\n`);
}

/** Every contract of a project that can be read, in the order they were written. */
export function allContracts(projectDir: string): { file: string; contract: Contract }[] {
  const dir = join(projectDir, CONTRACTS_DIR);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .flatMap((name) => {
      try {
        return [{ file: join(dir, name), contract: readContract(join(dir, name)) }];
      } catch {
        return [];
      }
    })
    .sort((a, b) => a.contract.createdAt.localeCompare(b.contract.createdAt) || a.contract.id.localeCompare(b.contract.id));
}

/** The contracts of a project that are not closed, oldest first. */
export function openContracts(projectDir: string): { file: string; contract: Contract }[] {
  return allContracts(projectDir).filter((entry) => entry.contract.closedAt === null);
}

/** What of a contract still stands in the way of calling the work done. Empty when nothing does. */
export function owed(contract: Contract): string[] {
  const lines: string[] = [];
  if (contract.frozenAt === null) lines.push('the contract is not frozen yet: nothing is built against a contract that can still move');
  for (const claim of contract.claims) {
    if (claim.status === 'unproven') lines.push(`${claim.id}: not shown yet (${claim.shownBy.kind}: ${claim.shownBy.ref}): ${claim.says}`);
    if (claim.status === 'refuted') lines.push(`${claim.id}: shown to be false: ${claim.says}${claim.note ? ` (${claim.note})` : ''}`);
  }
  return lines;
}

/** A promise retired after the contract was agreed: not part of what was agreed, so the owner is shown it as such. */
export const addedLate = (contract: Contract, entry: { at: string | null }): boolean => contract.frozenAt !== null && entry.at !== null && entry.at > contract.frozenAt;

const MARK: Record<ClaimStatus, string> = { proven: '증명됨', refuted: '반증됨', unproven: '아직', unchecked: '확인 못 함' };

/** A contract as the owner reads it, in their language. */
export function renderContract(contract: Contract): string {
  const list = (title: string, items: string[]): string => `## ${title}\n\n${items.join('\n')}`;
  const blocks = [
    contract.release ? `# ${contract.release.candidate === null ? '살아 있는 것 점검' : '출하'} ${contract.id}` : `# 계약 ${contract.id} (레인 ${contract.lane})`,
    [
      `요청: ${contract.request}`,
      ...(contract.targets.length > 0 ? [`대상: ${contract.targets.join(', ')}`] : []),
      ...(contract.release
        ? [
            `곳: ${contract.release.place} (${contract.release.url})`,
            `버전: ${contract.release.previous ? `${contract.release.previous.slice(0, 7)} → ` : ''}${contract.release.commit.slice(0, 7)}`,
            ...(contract.release.candidate ? [`내보내기 전에 보는 곳(후보): ${contract.release.candidate}`] : []),
            ...(contract.release.wayBack ? [`되돌리는 길: \`${contract.release.wayBack}\``] : []),
            ...(contract.release.takenBack ? [`되돌림: ${contract.release.takenBack.note}`] : []),
          ]
        : []),
    ].join('\n'),
    list('끝났을 때 참인 것', contract.claims.map((claim) => `- [${MARK[claim.status]}] **${claim.id}** ${claim.says}\n  - 보이는 방법: ${claim.shownBy.kind} \`${claim.shownBy.ref}\`${claim.note ? `\n  - ${claim.note}` : ''}`)),
    ...(contract.notDoing.length > 0 ? [list('하지 않는 것', contract.notDoing.map((line) => `- ${line}`))] : []),
    ...(contract.supersedes.length > 0 ? [list('이 작업으로 물러나는 약속', contract.supersedes.map((s) => `- \`${s.contract}/${s.claim}\`: ${s.why}${addedLate(contract, s) ? ' (얼린 뒤에 적힘)' : ''}`))] : []),
    ...(contract.risks.length > 0 ? [list('위험', contract.risks.map((line) => `- ${line}`))] : []),
    ...(contract.amendments.length > 0 ? [list('얼린 뒤 고친 검사', contract.amendments.map((a) => `- \`${a.file}\`: ${a.why}`))] : []),
    contract.frozenAt ? `얼린 때: ${contract.frozenAt}${contract.frozen.length > 0 ? ` (만드는 쪽이 못 고치는 파일: ${contract.frozen.join(', ')})` : ''}` : '아직 얼리지 않았습니다.',
  ];
  return `${blocks.join('\n\n')}\n`;
}
