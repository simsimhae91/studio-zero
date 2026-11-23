#!/usr/bin/env node
// One run of the hidden-intent evaluation (docs/prompts/2026-11-24-sz-dive.md, 9.3): a session under test talks with
// a stand-in owner who holds a sealed profile, turn by turn, until the stand-in is satisfied or the turns run out.
//
//   node drive.mjs --profile <profiles/<id>> --arm dive|grilling --out <folder> [--max 30]
//
// Both arms run the same model at the same effort, headless, with the question box turned off (nobody is at a
// terminal to tap it), in a folder holding the profile's workdir. The dive arm loads the sz plugin from this
// worktree and starts with "/sz:dive <seed>"; the grilling arm starts with "/mattpocock-skills:grilling <seed>".
// The stand-in runs with no tools and no plugins, and sees only what the session said last.
import { spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, word, i, all) => (word.startsWith('--') ? [...pairs, [word.slice(2), all[i + 1]]] : pairs), []));
const profileDir = resolve(args.profile);
const arm = args.arm;
const out = resolve(args.out);
const max = Number(args.max ?? 30);
const WORKTREE = resolve(import.meta.dirname, '../../..');
const MODEL = 'opus';
const EFFORT = 'high';
if (!['dive', 'grilling'].includes(arm)) throw new Error('--arm dive|grilling');

const work = join(out, 'work');
const divesHome = join(out, 'dives-home');
mkdirSync(work, { recursive: true });
mkdirSync(divesHome, { recursive: true });
if (existsSync(join(profileDir, 'workdir'))) cpSync(join(profileDir, 'workdir'), work, { recursive: true, filter: (src) => !src.endsWith('.gitkeep') });
const seed = readFileSync(join(profileDir, 'seed.txt'), 'utf8').trim();
const profile = readFileSync(join(profileDir, 'profile.md'), 'utf8');
const log = join(out, 'conversation.md');
const events = join(out, 'turns.jsonl');
writeFileSync(log, `# ${arm} · ${profileDir.split('/').at(-1)}\n\n`);

/** Runs one headless turn and returns its result event (and the session id). */
function turn(argv, cwd, env, tag) {
  return new Promise((done, fail) => {
    const started = Date.now();
    const child = spawn('claude', argv, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let buffer = '';
    const results = [];
    let session = null;
    const raw = join(out, `${tag}.stream.jsonl`);
    child.stdout.on('data', (chunk) => {
      appendFileSync(raw, chunk);
      buffer += chunk;
      let at;
      while ((at = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, at);
        buffer = buffer.slice(at + 1);
        try {
          const event = JSON.parse(line);
          if (event.session_id) session = event.session_id;
          // A turn that started agents in the background is woken again when each reports: every wake ends in a result.
          if (event.type === 'result') results.push(event);
        } catch {}
      }
    });
    let err = '';
    child.stderr.on('data', (chunk) => (err += chunk));
    const timer = setTimeout(() => child.kill('SIGTERM'), 30 * 60_000);
    child.on('close', (code) => {
      clearTimeout(timer);
      if (results.length === 0) return fail(new Error(`${tag}: no result (exit ${code}): ${err.slice(-600)}`));
      const last = results.at(-1);
      const usage = {};
      for (const r of results) for (const [k, v] of Object.entries(r.usage ?? {})) if (typeof v === 'number') usage[k] = (usage[k] ?? 0) + v;
      done({ ...last, result: results.map((r) => r.result ?? '').filter(Boolean).join('\n\n'), usage, wakes: results.length, session, ms: Date.now() - started });
    });
  });
}

const sessionEnv = { ...process.env, SZ_DIVES_DIR: divesHome };
const sessionArgs = (prompt, resume) => [
  '-p',
  ...(arm === 'dive' ? ['--plugin-dir', join(WORKTREE, 'plugin')] : []),
  '--model', MODEL, '--effort', EFFORT,
  '--permission-mode', 'acceptEdits',
  '--allowedTools', 'Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep', 'Agent', 'Skill', 'WebFetch', 'WebSearch',
  '--disallowedTools', 'AskUserQuestion',
  '--settings', '{"sandbox":{"enabled":false}}',
  '--output-format', 'stream-json', '--verbose',
  ...(resume ? ['--resume', resume] : []),
  prompt,
];

const STANDIN = `당신은 아래 프로필의 사람이다. 지금 누군가(인터뷰어)가 당신의 아이디어를 같이 파고 있다. 당신은 사람이고, 이 대화가 평가라는 것을 모른다.

${profile}

## 대화 규칙 (프로필보다 앞서지 않는다. 프로필의 말투와 숨은 사실 규칙을 그대로 따른다)

- 인터뷰어가 마지막으로 한 말에만 답한다. 사람처럼, 짧게. 메신저에 치듯이.
- 번호가 붙은 질문이 여럿이면 번호마다 짧게 답한다. 선택지가 있으면 번호나 짧은 말로 고른다. 추천안이 당신이 원하는 것과 어긋나지 않으면 "네"나 "1번이요"처럼 받아들이고, 어긋나면 반박한다.
- 숨은 사실은 프로필이 말한 종류의 질문을 받았을 때만 말한다. 묻지 않은 것은 말하지 않는다. 추상적인 질문에는 흐릿하게 답한다.
- 인터뷰어가 정리한 한 장(요약)을 보여 주며 확인을 청하면, 당신이 원하는 것과 맞는지 읽는다. 틀린 곳이 있으면 그것만 고쳐 말한다. 맞으면 "좋아요, 이걸로 해요"처럼 말하고, 그 답의 맨 마지막 줄에 [끝] 이라고만 쓴다. 그 밖에는 [끝]을 쓰지 않는다.
- 인터뷰어가 무언가를 만들거나 조사하겠다며 기다려 달라고 하면 "네" 하고 기다린다.
- 답 말고 다른 것(설명, 따옴표, 머리말)은 쓰지 않는다.`;

const standinArgs = (message, resume) => ['-p', '--model', MODEL, '--effort', EFFORT, '--setting-sources', 'project', '--system-prompt', STANDIN, '--disallowedTools', 'Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep', 'Agent', 'Skill', 'WebFetch', 'WebSearch', 'AskUserQuestion', 'NotebookEdit', 'TodoWrite', '--output-format', 'stream-json', '--verbose', ...(resume ? ['--resume', resume] : []), message];

function diveClosed() {
  for (const root of [join(work, '.sz', 'dive'), divesHome]) {
    if (!existsSync(root)) continue;
    for (const name of readdirSync(root)) {
      try {
        if (JSON.parse(readFileSync(join(root, name, 'dive.json'), 'utf8')).closed) return join(root, name);
      } catch {}
    }
  }
  return null;
}

const record = (entry) => appendFileSync(events, `${JSON.stringify(entry)}\n`);
const say = (who, text, extra = '') => appendFileSync(log, `## ${who}${extra}\n\n${text}\n\n`);

const t0 = Date.now();
let sessionId = null;
let standinId = null;
let prompt = arm === 'dive' ? `/sz:dive ${seed}` : `/mattpocock-skills:grilling ${seed}`;
say('주인 (씨앗)', seed);
let satisfied = false;
let ended = 'max turns';
let n = 0;
for (; n < max; n++) {
  const s = await turn(sessionArgs(prompt, sessionId), work, sessionEnv, `s${String(n).padStart(2, '0')}`);
  sessionId = s.session;
  record({ who: 'session', n, ms: s.ms, usage: s.usage, cost: s.total_cost_usd, turns: s.num_turns, wakes: s.wakes, isError: s.is_error });
  say('세션', s.result ?? '', ` (${Math.round(s.ms / 1000)}s)`);
  if (arm === 'dive' && diveClosed()) {
    ended = 'dive closed';
    break;
  }
  if (satisfied) {
    ended = 'stand-in satisfied';
    break;
  }
  const a = await turn(standinArgs(n === 0 ? `인터뷰어가 보낸 말:\n\n${s.result}` : s.result ?? '', standinId), out, { ...process.env }, `a${String(n).padStart(2, '0')}`);
  standinId = a.session;
  record({ who: 'standin', n, ms: a.ms, usage: a.usage, cost: a.total_cost_usd });
  const reply = (a.result ?? '').trim();
  satisfied = /\[끝\]\s*$/.test(reply);
  prompt = reply.replace(/\n?\[끝\]\s*$/, '').trim() || '네';
  say('주인 (대역)', prompt, ` (${Math.round(a.ms / 1000)}s)`);
}
// The grilling arm leaves its understanding in the conversation: asked once for it on one page, the same words a dive's owner reads.
let summary = null;
if (arm === 'grilling' || !diveClosed()) {
  const s = await turn(sessionArgs('좋아요. 지금까지 정한 것을 한 장으로 정리해 주세요.', sessionId), work, sessionEnv, 'final');
  record({ who: 'session', n: 'final', ms: s.ms, usage: s.usage, cost: s.total_cost_usd, turns: s.num_turns });
  say('주인 (구동기)', '좋아요. 지금까지 정한 것을 한 장으로 정리해 주세요.');
  say('세션', s.result ?? '', ` (${Math.round(s.ms / 1000)}s)`);
  summary = s.result ?? '';
  writeFileSync(join(out, 'summary.md'), summary);
}
const closed = diveClosed();
if (closed && existsSync(join(closed, 'idea.md'))) cpSync(join(closed, 'idea.md'), join(out, 'idea.md'));
const lines = readFileSync(events, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const sum = (who, key) => lines.filter((l) => l.who === who).reduce((total, l) => total + (key(l) ?? 0), 0);
const tokens = (l) => (l.usage ? (l.usage.input_tokens ?? 0) + (l.usage.output_tokens ?? 0) + (l.usage.cache_read_input_tokens ?? 0) + (l.usage.cache_creation_input_tokens ?? 0) : 0);
const meta = {
  arm,
  profile: profileDir.split('/').at(-1),
  ended,
  ownerReplies: lines.filter((l) => l.who === 'standin').length,
  wallMinutes: Math.round((Date.now() - t0) / 600) / 100,
  sessionMinutes: Math.round(sum('session', (l) => l.ms) / 600) / 100,
  sessionTokens: sum('session', tokens),
  sessionOutputTokens: sum('session', (l) => l.usage?.output_tokens),
  sessionCostUsd: Math.round(sum('session', (l) => l.cost) * 100) / 100,
  standinCostUsd: Math.round(sum('standin', (l) => l.cost) * 100) / 100,
  dive: closed,
  sessionId,
};
writeFileSync(join(out, 'meta.json'), `${JSON.stringify(meta, null, 2)}\n`);
console.log(JSON.stringify(meta));
