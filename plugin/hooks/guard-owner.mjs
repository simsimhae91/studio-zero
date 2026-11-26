#!/usr/bin/env node
// Before a shell command runs: the owner's words are the owner's. `sz-eyes contract close --accepted` closes a
// contract over a claim shown false, or over claims nobody looked at, on what the owner said; `sz-eyes contract
// judged` records their own verdict. An agent that a session or a workflow started never speaks with the owner,
// so whatever it would write there is its own. Only the session that talks with them runs these two.
// (2026-11-26: `--accepted` came to close a contract over a claim shown false, and on Claude Code nothing but a
// sentence in a prompt kept a closer or a fixer from writing those words itself. Codex refuses both in its record
// tool.) A call made inside an agent carries that agent's id; the session's own calls do not.
// Exit 2 refuses the command and says so.
import { runs } from './shell.mjs';

let input = '';
for await (const chunk of process.stdin) input += chunk;
let call;
try {
  call = JSON.parse(input);
} catch {
  process.exit(0);
}
if (typeof call?.agent_id !== 'string' || call.agent_id === '') process.exit(0);
const command = call?.tool_input?.command;
if (typeof command !== 'string' || command.trim() === '') process.exit(0);

const text = runs(command);
const closes = /\bsz-eyes\b[^;&|\n]*\bcontract\s+close\b[^;&|\n]*\s--accepted\b/.test(text);
const judges = /\bsz-eyes\b[^;&|\n]*\bcontract\s+judged\b/.test(text);
if (!closes && !judges) process.exit(0);

process.stderr.write(
  `This command did not start. ${closes ? 'The words after --accepted' : 'The words of `sz-eyes contract judged`'} are the owner's, and you have not spoken with them: an agent started by a session or a workflow writes none of their words. ${closes ? 'Leave the contract open and return what `sz-eyes contract close` said: whoever talks with the owner puts it to them.' : 'Leave the claim as it is and say in what you return that it waits for the owner.'}\n`,
);
process.exit(2);
