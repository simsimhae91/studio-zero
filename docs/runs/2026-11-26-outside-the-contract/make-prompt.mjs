// The request the workflow really gives whoever rules at the end of a run that stops with a claim still false:
// build.js run with agents answered from the trial's own journal (the plan, the start), a fixer that mends nothing
// and a look nobody answers, so that the run reaches its last ruling.
import { readFileSync, writeFileSync } from 'node:fs';
const [, , build, journal, args, out] = process.argv;
const j = readFileSync(journal, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const of = (label) => { const s = j.find((e) => e.type === 'started' && e.label === label); return j.find((e) => e.type === 'result' && e.agentId === s.agentId).result; };
const source = readFileSync(build, 'utf8').replace('export const meta', 'const meta');
const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
const calls = [];
const agent = async (prompt, opts) => {
  calls.push({ label: opts.label, prompt });
  if (opts.label === 'facts') return of('facts');
  if (opts.label === 'plan') return of('plan');
  if (opts.label.startsWith('start:')) return of('start:day-true');
  if (opts.label.startsWith('fix:')) return { fixed: [], notFixed: [] };
  if (opts.label.startsWith('verify:')) return null;
  if (opts.label.startsWith('rule:')) return { disputed: [] };
  if (opts.label.startsWith('close:')) return { report: 'r.html', closed: false, line: 'l' };
  throw new Error('no answer for ' + opts.label);
};
const logs = [];
const result = await new AsyncFunction('agent', 'phase', 'log', 'args', 'milestoneAgent', source)(agent, () => {}, (l) => logs.push(l), JSON.parse(readFileSync(args, 'utf8')), undefined);
const rule = calls.find((c) => c.label.startsWith('rule:'));
writeFileSync(out, rule.prompt);
console.log(calls.map((c) => c.label).join(' → '));
console.log('rule prompt:', rule.label, rule.prompt.length, 'chars');
console.log('stopped:', String(result.stopped).slice(0, 900));
