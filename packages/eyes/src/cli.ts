#!/usr/bin/env node
import { existsSync, mkdirSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { BACKLOG_FILE, addToBacklog, doneInBacklog, leftBy, openBacklog } from './backlog.ts';
import { CONTRACTS_DIR, EVIDENCE_DIR, ClaimStatus, Contract, Lane, ShownBy, openContracts, owed, readContract, renderContract, writeContract } from './contract.ts';
import { writeEvidencePage } from './evidence.ts';
import { changedSinceFrozen, fingerprint, fingerprints } from './fingerprint.ts';
import { Status, addSaid, latestRound, newRound, noteSaid, readRound, renderRound, writeRoundPage } from './feedback.ts';
import { EyesError, installApp, restSimulator, runFlow, screenText, screenshot, spareSimulator } from './ios.ts';
import { freePort } from './port.ts';
import { reviewWeb } from './review.ts';
import { Shown, brokenDuring, keptFor, ledgerProblem, recordShown, renderStanding, stampClosed, standing, standingSummary } from './standing.ts';
import { SIZES, lookAtWeb, renderLook, renderWalk, walkWeb, type Size } from './web.ts';

const USAGE = `sz-eyes: launch what was built, look at it, operate it, and put what was seen on one page

  sz-eyes web look <url> [--size phone|tablet|desktop] [--dark] [--wait <text or selector>] [--out <folder>] [--name <n>] [--house] [--json]
        open a page in a headless Chrome of its own and say what is on it: the words, what can be pressed, what it
        logged, and what was measured (text that can be read, controls that can be pressed, nothing cut off)

  sz-eyes web do <url> --step "<step>"... [--size ...] [--out <folder>] [--name <n>] [--json]
        do things on a page as a person would and keep a picture of what each led to. Steps: tap:<words>,
        type:<field>=<text>, press:<key>, wait:<words>, gone:<words>, see:<words>, shot:<name>, go:<path>.
        Stops at the first step that cannot be done and says why; ends with a look at where it arrived

  sz-eyes web review <url> [--size phone|tablet|desktop] [--dark] [--round <folder>] [--dir <project>]
        open the running product in a window for the owner: they use it as usual, press 말하기, point at what
        they mean and say it. Ends when they press 끝내기 or close the window, and prints what they said, with
        what each was about and a picture of that moment. Run it in the background and wait for it to end

  sz-eyes ios spare [--type "iPhone 17"]                 the eyes' own simulator, made and booted with no window; prints its id
  sz-eyes ios install <udid> <path.app> --bundle-id <id> [--metro <port>]
        put a built app on it, fresh (a React Native debug build is told which packager to load from)
  sz-eyes ios flow <udid> <flow.yaml> --out <folder> [--video] [-e KEY=VALUE]...
        run a Maestro flow from a copy that cannot write outside <folder>; says each step, keeps screenshots and a film
  sz-eyes ios look <udid> [--out <folder>] [--name <n>]  a screenshot, and the words and ids on the screen
  sz-eyes ios rest <udid> [--erase]                      shut it down (and wipe it)

  sz-eyes contract new <id> --lane S|M|L --request <text> [--target web]... --claim "<id>|<what will be true>|<kind>:<ref>"... [--not "<text>"]... [--risk "<text>"]... [--supersedes "<contract>/<claim>|<why>"]... [--dir <project>]
        --supersedes names a standing claim of earlier work that this work deliberately replaces, and why
  sz-eyes contract freeze <id> [--frozen <path>]... [--dir <project>]
  sz-eyes contract claim <id> <claim-id> --status proven|refuted|unchecked [--evidence <file under the evidence folder>]... [--note <text>] [--dir <project>]
  sz-eyes contract amend <id> --file <a frozen file> --why "<text>" [--dir <project>]
        record that a frozen check was corrected after the freeze (the arbiter's, never the builder's)
  sz-eyes contract supersede <id> <contract>/<claim> --why "<text>" [--dir <project>]
        after the fact: an earlier claim turned out to be replaced by what this contract was asked (the arbiter's)
  sz-eyes contract notice <id> "<what was noticed that no claim covers>" [--evidence <file>]... [--dir <project>]
  sz-eyes contract show <id> [--dir <project>]           the contract as the owner reads it
  sz-eyes contract status [--dir <project>]              what open contracts still owe; exits 1 when anything is owed
  sz-eyes contract close <id> [--dir <project>]
  sz-eyes evidence <id> [--summary <text>] [--took <text>] [--dir <project>]   writes ${EVIDENCE_DIR}/<id>/report.html

  sz-eyes standing [--summary|--json] [--dir <project>]
        every claim earlier work proved and the product still has to keep true, with how each is shown, when it
        was last shown to hold, and which of its check files changed since; exits 1 when one is recorded broken
  sz-eyes standing record <contract>/<claim> --status holds|broken|unchecked --note "<what was run and what it showed>" [--during <contract being worked on>] [--dir <project>]

  sz-eyes feedback new "<the owner's words>" [--round <folder>] [--dir <project>]
        write down something the owner said in the session (not by pointing); starts a round unless one is given
  sz-eyes feedback show [<round folder>] [--dir <project>]            what was said in a round (the latest by default)
  sz-eyes feedback note <round folder> <n> [--understood "<text>"] [--opinion "<text>"] [--status asked|doing|done|later|declined] [--did "<text>"] [--dir <project>]
        what was understood by it, what you think of it, and what came of it; "later" also writes it to the backlog
  sz-eyes feedback page [<round folder>] [--dir <project>]
        the page the owner reads after a round: each thing said, with the pictures in <round>/<n>/ (before-*, after-*)

  sz-eyes backlog [--dir <project>]                      what is written down as known and not done (${BACKLOG_FILE})
  sz-eyes backlog add "<one line, in the owner's language>" [--from "<where it came from>"] [--dir <project>]
  sz-eyes backlog done "<some words of the line>" --by "<the contract or commit that ended it>" [--dir <project>]

  sz-eyes port                                           a port nothing listens on, from the machine: start what you
        launch on it (PORT=$(sz-eyes port)), keep its process id ($!), and end it by that id. Never choose a
        number, and never end whatever holds a port: other work of the owner's runs on this machine
`;

/** `--flag value` pairs and bare words, in order. A flag given twice is a list. */
function parse(argv: string[], booleans: string[]): { words: string[]; flags: Map<string, string[]>; has: (name: string) => boolean; one: (name: string) => string | undefined; all: (name: string) => string[] } {
  const words: string[] = [];
  const flags = new Map<string, string[]>();
  for (let i = 0; i < argv.length; i++) {
    const word = argv[i]!;
    if (!word.startsWith('-') || word === '-') {
      words.push(word);
      continue;
    }
    if (booleans.includes(word)) flags.set(word, ['true']);
    else flags.set(word, [...(flags.get(word) ?? []), argv[++i] ?? '']);
  }
  return { words, flags, has: (name) => flags.has(name), one: (name) => flags.get(name)?.at(-1), all: (name) => flags.get(name) ?? [] };
}

const out = (text: string): void => void process.stdout.write(`${text}\n`);
const contractFile = (project: string, id: string): string => join(project, CONTRACTS_DIR, `${id}.json`);
const evidenceFolder = (project: string, id: string): string => join(project, EVIDENCE_DIR, id);

/** `<contract>/<claim>|<why>`: a standing claim that a piece of work replaces, and the reason the owner reads. */
function supersedeOf(project: string, key: string, why: string): { contract: string; claim: string; why: string; at: string } {
  const stands = standing(project).stands;
  const found = stands.find((s) => s.key === key.trim());
  if (!found) throw new EyesError(`"${key.trim()}" is not a standing claim, so there is nothing to replace. Standing: ${stands.map((s) => s.key).join(', ') || '(none)'}`);
  if (why.trim().length < 8) throw new EyesError(`say why ${found.key} should no longer be true: what the owner asked that changes it`);
  return { contract: found.contract, claim: found.claim.id, why: why.trim(), at: new Date().toISOString() };
}

/** What an open contract owes beyond its own claims: what stood before it and it broke, and a frozen check changed behind the guard's back. */
function alsoOwed(project: string, contract: Contract): string[] {
  return [
    ...brokenDuring(project, contract.id).map((s) => `${s.key}: stood before this work and is broken now: ${s.claim.says}${s.last?.note ? ` (${s.last.note})` : ''}`),
    ...(contract.closedAt === null ? changedSinceFrozen(project, contract).map((path) => `${path}: changed since the contract was frozen, and no correction by the arbiter is recorded (\`git diff\` shows what; restore it, or have the sz:arbiter agent look at it)`) : []),
  ];
}

/** Nothing is recorded or closed over a record of promises that cannot be read. */
function needLedger(project: string): void {
  const problem = ledgerProblem(project);
  if (problem) throw new EyesError(problem);
}

async function main(argv: string[]): Promise<number> {
  const [area, command, ...rest] = argv;
  if (!area || area === 'help' || area === '--help') {
    out(USAGE);
    return 0;
  }
  if (area === 'web' && command === 'look') {
    const a = parse(rest, ['--dark', '--house', '--json']);
    const url = a.words[0];
    if (!url) throw new EyesError('which page: sz-eyes web look <url>');
    const size = (a.one('--size') ?? 'phone') as Size;
    if (!(size in SIZES)) throw new EyesError(`--size is one of ${Object.keys(SIZES).join(', ')}`);
    const look = await lookAtWeb(url, { size, dark: a.has('--dark'), house: a.has('--house'), ...(a.one('--wait') ? { waitFor: a.one('--wait')! } : {}), ...(a.one('--out') ? { out: resolve(a.one('--out')!) } : {}), ...(a.one('--name') ? { name: a.one('--name')! } : {}) });
    out(a.has('--json') ? JSON.stringify(look, null, 2) : renderLook(look));
    return 0;
  }
  if (area === 'web' && command === 'do') {
    const a = parse(rest, ['--dark', '--house', '--json']);
    const url = a.words[0];
    const steps = a.all('--step');
    if (!url || steps.length === 0) throw new EyesError('sz-eyes web do <url> --step "tap:<words>" --step "type:<field>=<text>" ... [--out <folder>]');
    const size = (a.one('--size') ?? 'phone') as Size;
    if (!(size in SIZES)) throw new EyesError(`--size is one of ${Object.keys(SIZES).join(', ')}`);
    const walk = await walkWeb(url, steps, { size, dark: a.has('--dark'), house: a.has('--house'), ...(a.one('--wait') ? { waitFor: a.one('--wait')! } : {}), ...(a.one('--out') ? { out: resolve(a.one('--out')!) } : {}), ...(a.one('--name') ? { name: a.one('--name')! } : {}) });
    out(a.has('--json') ? JSON.stringify(walk, null, 2) : renderWalk(walk, steps.length));
    return walk.passed ? 0 : 1;
  }
  if (area === 'web' && command === 'review') {
    const a = parse(rest, ['--dark']);
    const url = a.words[0];
    if (!url) throw new EyesError('which page: sz-eyes web review <url>');
    const size = (a.one('--size') ?? 'phone') as Size;
    if (!(size in SIZES)) throw new EyesError(`--size is one of ${Object.keys(SIZES).join(', ')}`);
    const project = resolve(a.one('--dir') ?? '.');
    const folder = a.one('--round') ? resolve(a.one('--round')!) : newRound(project, new Date().toISOString());
    if (!existsSync(join(folder, 'items.json'))) throw new EyesError(`${folder} is not a round of feedback (it has no items.json). Leave --round out to start one.`);
    out(`a window is open on ${url} for the owner: they press 말하기, point at what they mean and say it; this ends when they press 끝내기 or close the window. Round: ${folder}`);
    const round = await reviewWeb(url, folder, { size, dark: a.has('--dark') }).catch((err: unknown) => {
      throw new EyesError(`the window could not be opened on ${url}: ${err instanceof Error ? err.message.split('\n')[0] : String(err)}`);
    });
    out(`\n${renderRound(round, folder)}`);
    return 0;
  }
  if (area === 'feedback') {
    const a = parse(rest, []);
    const project = resolve(a.one('--dir') ?? '.');
    const now = new Date().toISOString();
    if (command === 'new') {
      const said = a.words.join(' ').trim();
      if (said === '') throw new EyesError('sz-eyes feedback new "<the owner\'s words>" [--round <folder>]');
      const folder = a.one('--round') ? resolve(a.one('--round')!) : newRound(project, now);
      if (!existsSync(join(folder, 'items.json'))) throw new EyesError(`${folder} is not a round of feedback (it has no items.json). Leave --round out to start one.`);
      const item = addSaid(folder, { said, at: now });
      out(`${folder}\nitem ${item.n}. Pictures of it go in ${join(folder, String(item.n))}/ (before-<size>.png, after-<size>.png)`);
      return 0;
    }
    const given = command === 'note' ? a.words[0] : a.words[0];
    const folder = given ? resolve(given) : latestRound(project);
    if (!folder || !existsSync(join(folder, 'items.json'))) throw new EyesError(given ? `${given} is not a round of feedback (it has no items.json)` : 'no round of feedback has been started in this project');
    if (command === 'show') {
      out(renderRound(readRound(folder), folder));
      return 0;
    }
    if (command === 'page') {
      out(writeRoundPage(folder));
      return 0;
    }
    if (command === 'note') {
      const n = Number(a.words[1]);
      if (!given || !Number.isInteger(n)) throw new EyesError('sz-eyes feedback note <round folder> <n> [--understood ..] [--opinion ..] [--status ..] [--did ..]');
      const patch = {
        ...(a.one('--understood') ? { understood: a.one('--understood')! } : {}),
        ...(a.one('--opinion') ? { opinion: a.one('--opinion')! } : {}),
        ...(a.one('--did') ? { did: a.one('--did')! } : {}),
        ...(a.one('--status') ? { status: Status.parse(a.one('--status')) } : {}),
      };
      try {
        const item = noteSaid(project, folder, n, patch);
        out(`${n}: ${item.status}`);
      } catch (err) {
        throw new EyesError(err instanceof Error ? err.message : String(err));
      }
      return 0;
    }
  }
  if (area === 'ios') {
    const a = parse(rest, ['--video', '--erase']);
    if (command === 'spare') {
      out(await spareSimulator(a.one('--type') ? { type: a.one('--type')! } : {}));
      return 0;
    }
    const udid = a.words[0];
    if (!udid) throw new EyesError('which simulator: give the id sz-eyes ios spare printed');
    if (command === 'install') {
      const bundleId = a.one('--bundle-id');
      if (!a.words[1] || !bundleId) throw new EyesError('sz-eyes ios install <udid> <path.app> --bundle-id <id> [--metro <port>]');
      await installApp(udid, resolve(a.words[1]), { bundleId, ...(a.one('--metro') ? { metroPort: Number(a.one('--metro')) } : {}) });
      out(`installed ${basename(a.words[1])} on ${udid}`);
      return 0;
    }
    if (command === 'flow') {
      if (!a.words[1] || !a.one('--out')) throw new EyesError('sz-eyes ios flow <udid> <flow.yaml> --out <folder> [--video] [-e KEY=VALUE]');
      const env = Object.fromEntries(a.all('-e').map((pair) => [pair.slice(0, pair.indexOf('=')), pair.slice(pair.indexOf('=') + 1)]));
      const result = await runFlow(udid, resolve(a.words[1]), { out: resolve(a.one('--out')!), env, video: a.has('--video') });
      out(`${result.passed ? 'PASSED' : 'FAILED'} ${basename(result.flow)} in ${result.seconds}s, ${result.steps.filter((s) => s.state === 'completed').length} of ${result.steps.length} steps completed`);
      if (result.failed) out(`stopped at: ${result.failed}`);
      if (result.screenshots.length > 0) out(`screenshots:\n${result.screenshots.map((file) => `  ${file}`).join('\n')}`);
      if (result.filmstrip) out(`film: ${result.filmstrip}`);
      if (result.video) out(`video: ${result.video}`);
      if (!result.passed) out(`\nthe end of Maestro's own words:\n${result.log.split('\n').slice(-25).join('\n')}`);
      return result.passed ? 0 : 1;
    }
    if (command === 'look') {
      const folder = a.one('--out') ? resolve(a.one('--out')!) : null;
      const shot = folder ? await screenshot(udid, join(folder, `${a.one('--name') ?? 'look'}.png`)) : null;
      const seen = await screenText(udid);
      if (shot) out(`screenshot: ${shot}`);
      out(`words on it (${seen.texts.length}): ${seen.texts.slice(0, 80).map((text) => JSON.stringify(text)).join(' ')}`);
      out(`ids on it (${seen.ids.length}): ${seen.ids.slice(0, 80).join(', ')}`);
      return 0;
    }
    if (command === 'rest') {
      await restSimulator(udid, { erase: a.has('--erase') });
      out(`${udid} is shut down${a.has('--erase') ? ' and wiped' : ''}`);
      return 0;
    }
  }
  if (area === 'standing') {
    const a = parse(command === 'record' ? rest : argv.slice(1), ['--summary', '--json']);
    const project = resolve(a.one('--dir') ?? '.');
    if (command === 'record') {
      const key = a.words[0];
      const note = (a.one('--note') ?? '').trim();
      const during = a.one('--during') ?? null;
      if (!key) throw new EyesError('sz-eyes standing record <contract>/<claim> --status holds|broken|unchecked --note "<what was run and what it showed>" [--during <contract>]');
      if (note.length < 8) throw new EyesError('say what was run or looked at and what it showed: --note "<...>"');
      if (during !== null && !existsSync(contractFile(project, during))) throw new EyesError(`--during ${during}: no such contract`);
      needLedger(project);
      const status = Shown.shape.status.parse(a.one('--status'));
      try {
        recordShown(project, key, { status, note, during, at: new Date().toISOString() });
      } catch (err) {
        throw new EyesError(err instanceof Error ? err.message : String(err));
      }
      out(`${key}: ${status}`);
      return 0;
    }
    const problem = ledgerProblem(project);
    if (a.has('--summary')) {
      const line = problem ?? standingSummary(project);
      if (line) out(line);
      return 0;
    }
    if (problem) {
      out(problem);
      return 1;
    }
    if (a.has('--json')) {
      out(JSON.stringify(standing(project), null, 2));
      return 0;
    }
    out(renderStanding(project));
    return standing(project).stands.some((s) => s.last?.status === 'broken') ? 1 : 0;
  }
  if (area === 'port') {
    out(String(await freePort()));
    return 0;
  }
  if (area === 'backlog') {
    const a = parse(command === 'add' || command === 'done' ? rest : argv.slice(1), []);
    const project = resolve(a.one('--dir') ?? '.');
    if (command === 'done') {
      try {
        out(`ticked: ${doneInBacklog(project, a.words.join(' '), a.one('--by') ?? '')}`);
      } catch (err) {
        throw new EyesError(`${(err as Error).message}\nsz-eyes backlog done "<some words of the line>" --by "<the contract or commit that ended it>"`);
      }
      return 0;
    }
    if (command === 'add') {
      const text = a.words.join(' ').trim();
      if (text === '') throw new EyesError('sz-eyes backlog add "<one line>" [--from "<where it came from>"]');
      out(addToBacklog(project, [{ text, from: a.one('--from') ?? '' }]) > 0 ? `added to ${BACKLOG_FILE}` : 'already there');
      return 0;
    }
    const open = openBacklog(project);
    out(open.length === 0 ? 'nothing is written down as left to do' : `${open.length} open in ${BACKLOG_FILE}:\n${open.map((line, i) => `  ${i + 1}. ${line}`).join('\n')}`);
    return 0;
  }
  if (area === 'contract' || area === 'evidence') {
    const a = parse(area === 'evidence' ? [command ?? '', ...rest] : rest, []);
    const project = resolve(a.one('--dir') ?? '.');
    if (area === 'contract' && command === 'status') {
      const open = openContracts(project).map(({ contract }) => ({ contract, owes: [...owed(contract), ...alsoOwed(project, contract)] })).filter((c) => c.owes.length > 0);
      const problem = ledgerProblem(project);
      if (problem) out(problem);
      if (open.length === 0) {
        if (!problem) out('nothing is owed: every open contract is frozen and has no claim left unshown or shown false');
        return problem ? 1 : 0;
      }
      for (const { contract, owes } of open) out(`contract ${contract.id} (lane ${contract.lane}) still owes:\n${owes.map((line) => `  - ${line}`).join('\n')}`);
      return 1;
    }
    const id = a.words[0];
    if (!id) throw new EyesError('which contract: give its id');
    const file = contractFile(project, id);
    if (area === 'contract' && command === 'new') {
      if (existsSync(file)) throw new EyesError(`${file} is already there`);
      const claims = a.all('--claim').map((text) => {
        const [claimId = '', says = '', how = ''] = text.split('|').map((part) => part.trim());
        const at = how.indexOf(':');
        return { id: claimId, says, shownBy: ShownBy.parse({ kind: how.slice(0, at), ref: how.slice(at + 1).trim() }) };
      });
      const supersedes = a.all('--supersedes').map((text) => {
        const bar = text.indexOf('|');
        return supersedeOf(project, bar < 0 ? text : text.slice(0, bar), bar < 0 ? '' : text.slice(bar + 1));
      });
      const contract = Contract.parse({ id, request: a.one('--request') ?? '', lane: Lane.parse(a.one('--lane') ?? 'M'), targets: a.all('--target'), claims, notDoing: a.all('--not'), risks: a.all('--risk'), supersedes, createdAt: new Date().toISOString() });
      writeContract(file, contract);
      out(`${file}\n\n${renderContract(contract)}`);
      return 0;
    }
    const contract = readContract(file);
    if (area === 'evidence') {
      const folder = evidenceFolder(project, id);
      mkdirSync(folder, { recursive: true });
      out(writeEvidencePage(contract, folder, join(folder, 'report.html'), { kept: keptFor(project, contract), ...(a.one('--summary') ? { summary: a.one('--summary')! } : {}), ...(a.one('--took') ? { took: a.one('--took')! } : {}) }));
      return 0;
    }
    if (command === 'show') {
      const changed = contract.closedAt === null ? changedSinceFrozen(project, contract) : [];
      out(`${renderContract(contract)}${changed.length > 0 ? `\n얼린 뒤 바뀐 파일 (중재자의 수정 기록 없음): ${changed.join(', ')}\n` : ''}`);
      return 0;
    }
    if (command === 'freeze') {
      if (contract.frozenAt !== null) throw new EyesError(`${id} was frozen at ${contract.frozenAt}`);
      const frozen = [...new Set([...contract.frozen, ...a.all('--frozen')])];
      const missing = frozen.filter((path) => !existsSync(join(project, path)));
      if (missing.length > 0) throw new EyesError(`not there to freeze: ${missing.join(', ')}. Paths are relative to the project; write the flow or test first.`);
      writeContract(file, { ...contract, frozen, frozenPrints: fingerprints(project, frozen), frozenAt: new Date().toISOString() });
      out(`frozen: ${id}. Whoever builds it does not edit ${file}${contract.frozen.length + a.all('--frozen').length > 0 ? ' or the files it names' : ''}.`);
      return 0;
    }
    if (command === 'claim') {
      // A closed contract is the record of what was shown then. What is found of it later is a look at a
      // standing claim, written where it cannot quietly take a promise off the list.
      if (contract.closedAt !== null) throw new EyesError(`contract ${id} is closed: its verdicts are the record of what was shown then. What is found now is recorded with \`sz-eyes standing record ${id}/<claim> --status holds|broken|unchecked\`.`);
      const claimId = a.words[1];
      const claim = contract.claims.find((c) => c.id === claimId);
      if (!claim) throw new EyesError(`contract ${id} has no claim "${claimId ?? ''}". Its claims: ${contract.claims.map((c) => c.id).join(', ')}`);
      const status = ClaimStatus.parse(a.one('--status'));
      const folder = evidenceFolder(project, id);
      for (const path of a.all('--evidence')) if (!existsSync(join(folder, path))) throw new EyesError(`${join(folder, path)}: no such file. Evidence is a file under ${folder}`);
      // A claim is not called proven on someone's word: there is something to look at, or a command that said so.
      if (status === 'proven' && a.all('--evidence').length === 0 && !a.one('--note')) throw new EyesError('a claim is proven by something that shows it: give --evidence (a picture, a film, a log under the evidence folder) or a --note that says what was run and what it said');
      Object.assign(claim, { status, evidence: [...new Set([...claim.evidence, ...a.all('--evidence')])], note: a.one('--note') ?? claim.note });
      writeContract(file, contract);
      out(`${claimId}: ${status}`);
      return 0;
    }
    if (command === 'amend') {
      const target = a.one('--file');
      const why = a.one('--why') ?? '';
      if (!target || why.trim().length < 12) throw new EyesError('sz-eyes contract amend <id> --file <a frozen file> --why "<what was wrong about how it checked, and what was changed>"');
      if (!contract.frozen.includes(target)) throw new EyesError(`${target} is not a file contract ${id} froze. Frozen: ${contract.frozen.join(', ') || '(none)'}`);
      // The file as the arbiter left it is what the contract is now proven against.
      writeContract(file, { ...contract, frozenPrints: { ...contract.frozenPrints, [target]: fingerprint(project, target) }, amendments: [...contract.amendments, { file: target, why: why.trim(), at: new Date().toISOString() }] });
      out(`amended: ${target}`);
      return 0;
    }
    if (command === 'supersede') {
      if (contract.closedAt !== null) throw new EyesError(`${id} is closed: a closed contract replaces nothing more`);
      const replaced = supersedeOf(project, a.words[1] ?? '', a.one('--why') ?? '');
      if (replaced.contract === id) throw new EyesError('a contract does not replace its own claim');
      writeContract(file, { ...contract, supersedes: [...contract.supersedes, replaced] });
      out(`${replaced.contract}/${replaced.claim} no longer stands: replaced by ${id}`);
      return 0;
    }
    if (command === 'notice') {
      const text = a.words.slice(1).join(' ').trim();
      if (text === '') throw new EyesError('sz-eyes contract notice <id> "<what was noticed>" [--evidence <file>]');
      const folder = evidenceFolder(project, id);
      for (const path of a.all('--evidence')) if (!existsSync(join(folder, path))) throw new EyesError(`${join(folder, path)}: no such file. Evidence is a file under ${folder}`);
      writeContract(file, { ...contract, noticed: [...contract.noticed, { text, evidence: a.all('--evidence') }] });
      out('noted');
      return 0;
    }
    if (command === 'close') {
      if (contract.closedAt !== null) throw new EyesError(`contract ${id} was closed at ${contract.closedAt}`);
      needLedger(project);
      const owes = owed(contract);
      if (owes.length > 0) throw new EyesError(`contract ${id} still owes:\n${owes.map((line) => `  - ${line}`).join('\n')}`);
      const also = alsoOwed(project, contract);
      if (also.length > 0) throw new EyesError(`contract ${id} is not closed yet:\n${also.map((line) => `  - ${line}`).join('\n')}\nWhat stood before and broke: fix the product so it holds again (then \`sz-eyes standing record <key> --status holds\`), or, if what was asked has changed, the arbiter records which claim this work replaces.`);
      const at = new Date().toISOString();
      const closed = { ...contract, closedAt: at };
      // Its proven claims are stamped first: a contract is never left closed with nothing to say when its
      // claims last held. From here they stand, and what it left is written where the next work is picked from.
      stampClosed(project, closed, at);
      writeContract(file, closed);
      const left = addToBacklog(project, leftBy(closed));
      out(`closed: ${id}${left > 0 ? ` (${left} line(s) added to ${BACKLOG_FILE})` : ''}`);
      return 0;
    }
  }
  process.stderr.write(`sz-eyes: unknown command: ${argv.join(' ')}\n\n${USAGE}`);
  return 2;
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err: unknown) => {
    process.stderr.write(`sz-eyes: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(err instanceof EyesError ? 1 : 2);
  },
);
