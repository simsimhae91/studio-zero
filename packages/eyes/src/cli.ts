#!/usr/bin/env node
import { existsSync, mkdirSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { CONTRACTS_DIR, EVIDENCE_DIR, ClaimStatus, Contract, Lane, ShownBy, openContracts, owed, readContract, renderContract, writeContract } from './contract.ts';
import { writeEvidencePage } from './evidence.ts';
import { EyesError, installApp, restSimulator, runFlow, screenText, screenshot, spareSimulator } from './ios.ts';
import { SIZES, lookAtWeb, renderLook, renderWalk, walkWeb, type Size } from './web.ts';

const USAGE = `sz-eyes: launch what was built, look at it, operate it, and put what was seen on one page

  sz-eyes web look <url> [--size phone|tablet|desktop] [--dark] [--wait <text or selector>] [--out <folder>] [--name <n>] [--house] [--json]
        open a page in a headless Chrome of its own and say what is on it: the words, what can be pressed, what it
        logged, and what was measured (text that can be read, controls that can be pressed, nothing cut off)

  sz-eyes web do <url> --step "<step>"... [--size ...] [--out <folder>] [--name <n>] [--json]
        do things on a page as a person would and keep a picture of what each led to. Steps: tap:<words>,
        type:<field>=<text>, press:<key>, wait:<words>, gone:<words>, see:<words>, shot:<name>, go:<path>.
        Stops at the first step that cannot be done and says why; ends with a look at where it arrived

  sz-eyes ios spare [--type "iPhone 17"]                 the eyes' own simulator, made and booted with no window; prints its id
  sz-eyes ios install <udid> <path.app> --bundle-id <id> [--metro <port>]
        put a built app on it, fresh (a React Native debug build is told which packager to load from)
  sz-eyes ios flow <udid> <flow.yaml> --out <folder> [--video] [-e KEY=VALUE]...
        run a Maestro flow from a copy that cannot write outside <folder>; says each step, keeps screenshots and a film
  sz-eyes ios look <udid> [--out <folder>] [--name <n>]  a screenshot, and the words and ids on the screen
  sz-eyes ios rest <udid> [--erase]                      shut it down (and wipe it)

  sz-eyes contract new <id> --lane S|M|L --request <text> [--target web]... --claim "<id>|<what will be true>|<kind>:<ref>"... [--not "<text>"]... [--risk "<text>"]... [--dir <project>]
  sz-eyes contract freeze <id> [--frozen <path>]... [--dir <project>]
  sz-eyes contract claim <id> <claim-id> --status proven|refuted|unchecked [--evidence <file under the evidence folder>]... [--note <text>] [--dir <project>]
  sz-eyes contract show <id> [--dir <project>]           the contract as the owner reads it
  sz-eyes contract status [--dir <project>]              what open contracts still owe; exits 1 when anything is owed
  sz-eyes contract close <id> [--dir <project>]
  sz-eyes evidence <id> [--summary <text>] [--took <text>] [--dir <project>]   writes ${EVIDENCE_DIR}/<id>/report.html
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
  if (area === 'contract' || area === 'evidence') {
    const a = parse(area === 'evidence' ? [command ?? '', ...rest] : rest, []);
    const project = resolve(a.one('--dir') ?? '.');
    if (area === 'contract' && command === 'status') {
      const open = openContracts(project).map(({ contract }) => ({ contract, owes: owed(contract) })).filter((c) => c.owes.length > 0);
      if (open.length === 0) {
        out('nothing is owed: every open contract is frozen and has no claim left unshown or shown false');
        return 0;
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
      const contract = Contract.parse({ id, request: a.one('--request') ?? '', lane: Lane.parse(a.one('--lane') ?? 'M'), targets: a.all('--target'), claims, notDoing: a.all('--not'), risks: a.all('--risk'), createdAt: new Date().toISOString() });
      writeContract(file, contract);
      out(`${file}\n\n${renderContract(contract)}`);
      return 0;
    }
    const contract = readContract(file);
    if (area === 'evidence') {
      const folder = evidenceFolder(project, id);
      mkdirSync(folder, { recursive: true });
      out(writeEvidencePage(contract, folder, join(folder, 'report.html'), { ...(a.one('--summary') ? { summary: a.one('--summary')! } : {}), ...(a.one('--took') ? { took: a.one('--took')! } : {}) }));
      return 0;
    }
    if (command === 'show') {
      out(renderContract(contract));
      return 0;
    }
    if (command === 'freeze') {
      if (contract.frozenAt !== null) throw new EyesError(`${id} was frozen at ${contract.frozenAt}`);
      writeContract(file, { ...contract, frozen: [...new Set([...contract.frozen, ...a.all('--frozen')])], frozenAt: new Date().toISOString() });
      out(`frozen: ${id}. Whoever builds it does not edit ${file}${contract.frozen.length + a.all('--frozen').length > 0 ? ' or the files it names' : ''}.`);
      return 0;
    }
    if (command === 'claim') {
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
    if (command === 'close') {
      const owes = owed(contract);
      if (owes.length > 0) throw new EyesError(`contract ${id} still owes:\n${owes.map((line) => `  - ${line}`).join('\n')}`);
      writeContract(file, { ...contract, closedAt: new Date().toISOString() });
      out(`closed: ${id}`);
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
