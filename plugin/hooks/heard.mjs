#!/usr/bin/env node
// Keeps what the owner types while a dive is asked for or under way, exactly as they typed it. A dive settles each
// line by the owner's own words, and `sz-eyes dive` takes words as theirs only when it finds them here (or, for an
// answer chosen in a question box, in the session's transcript, which this names). The session cannot write here:
// this runs on the owner's message, before the session reads it. (On 2026-11-22 a line a session wrote in the
// owner's place was recorded as "주인:" in a contract.)
//
// It writes only for a session that asked for a dive (the command, or words that ask for one) or that sits in a
// folder with a dive open, and only to ~/.studio-zero/dives/.heard/<session>.jsonl. It never refuses or prints.
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

const ASKS_FOR_A_DIVE = /^\s*(?:\/sz:dive\b|\$sz:dive\b|\[\$sz:dive\]\()|딥\s*다이브|deep\s*dive|브레인\s*스토밍|brainstorm|(아이디어|생각).{0,12}(파\s*보|파고|파헤|구체화)/i;
const KEPT_FOR_DAYS = 30;
// What the harness itself puts in the owner's place: a background agent's report, a reminder, a command's echo.
// Its words are an agent's or the tool's, never the owner's (a background reader's report came in this way in
// the first headless dive, 2026-11-24, and was kept as said).
const NOT_THE_OWNER = /^\s*<(task-notification|system-reminder|local-command-|command-(name|message|args)|bash-(input|stdout|stderr)|teammate-message|channel)/;

function openDiveIn(cwd) {
  const root = join(cwd, '.sz', 'dive');
  if (!existsSync(root)) return false;
  return readdirSync(root).some((name) => {
    try {
      return JSON.parse(readFileSync(join(root, name, 'dive.json'), 'utf8')).closed === null;
    } catch {
      return false;
    }
  });
}

try {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;
  const call = JSON.parse(input);
  const prompt = typeof call?.prompt === 'string' ? call.prompt : '';
  const session = String(call?.session_id ?? '').replace(/[^A-Za-z0-9_-]/g, '');
  if (prompt.trim() !== '' && session !== '' && !NOT_THE_OWNER.test(prompt)) {
    const dir = join(process.env.SZ_DIVES_DIR ? resolve(process.env.SZ_DIVES_DIR) : join(homedir(), '.studio-zero', 'dives'), '.heard');
    const log = join(dir, `${session}.jsonl`);
    if (ASKS_FOR_A_DIVE.test(prompt) || existsSync(log) || openDiveIn(String(call?.cwd ?? process.cwd()))) {
      if (!existsSync(log)) {
        mkdirSync(dir, { recursive: true });
        const old = Date.now() - KEPT_FOR_DAYS * 86_400_000;
        for (const name of readdirSync(dir)) if (name.endsWith('.jsonl') && statSync(join(dir, name)).mtimeMs < old) unlinkSync(join(dir, name));
      }
      appendFileSync(log, `${JSON.stringify({ at: new Date().toISOString(), session, cwd: call?.cwd ?? null, transcript: typeof call?.transcript_path === 'string' ? call.transcript_path : null, prompt })}\n`);
    }
  }
} catch {
  // Keeping the owner's words never stands in the way of what they asked.
}
