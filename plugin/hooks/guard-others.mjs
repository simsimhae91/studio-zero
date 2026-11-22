#!/usr/bin/env node
// Before a shell command runs: this machine is the owner's, and other work of theirs is running on it (other
// projects' servers, their simulators, their containers). A piece of work ends only what it started, by the
// process id it kept. "Whatever listens on this port" and "everything named node" are somebody else's work as
// often as a leftover of one's own: in the first long run a builder chose a port number, found a server
// answering there, took pictures of it as its own, and then ended it. It belonged to another project.
// Exit 2 refuses the command and says what to do instead.

import { readCommand, runs, START } from './shell.mjs';

const command = await readCommand();
if (command === null) process.exit(0);

const text = runs(command);
const which = [
  [new RegExp(`${START}(sudo\\s+)?(pkill|killall)\\b`), 'every process a name or a pattern fits'],
  [/\blsof\b[^;\n]*\|[^;\n]*\bkill\b/, 'whatever is listening on a port'],
  [/\bkill\b[^;\n]*(\$\(|`)\s*lsof\b/, 'whatever is listening on a port'],
  [/\bfuser\b[^;\n]*\s-\w*k/, 'whatever is listening on a port'],
  [new RegExp(`${START}(npx\\s+(-\\S+\\s+)*)?kill-port\\b`), 'whatever is listening on a port'],
  [/\bdocker\s+(container\s+)?(kill|stop|rm|restart|pause)\b[^;\n]*(\$\(|`)\s*docker\s+(container\s+)?(ps|ls)\b/, 'every container on this machine'],
  [/\bdocker\s+(container\s+)?(ps|ls)\b[^;\n]*\|[^;\n]*\bdocker\s+(container\s+)?(kill|stop|rm|restart|pause)\b/, 'every container on this machine'],
  [/\bdocker\s+(system|container|volume|network|image|builder)\s+prune\b/, 'everything Docker holds on this machine that is not in use right now'],
  [/\bsimctl\s+(shutdown|erase|delete)\s+all\b/, 'every simulator on this machine'],
].find(([pattern]) => pattern.test(text))?.[1]
  // The ids `lsof -t` prints, handed to a kill later in the same command.
  ?? (/\blsof\b[^;&|\n]*\s-[a-hj-su-zA-Z]*t/.test(text) && /\bkill\b/.test(text) ? 'whatever is listening on a port' : null);
if (!which) process.exit(0);

process.stderr.write(`This would end ${which}: things this work did not start. Other work of the owner's runs on this machine (other projects' servers, their simulators and containers), and a server answering on a port you wanted is theirs, not a leftover of yours.
End only what you started, by the id you kept:
  PORT=$(sz-eyes port) <the command that starts it> & pid=$!     # a port from the machine, never a number you chose (a product that cannot be told a port: sz:verify)
  ...
  kill $pid
A container or a simulator you started is ended by its own name or id. If a port you expected is taken, take another; do not free it. If something of yours is left over from before and you no longer have its id, find the one process (\`lsof -nP -iTCP:<port> -sTCP:LISTEN\`, \`ps -o pid,lstart,command -p <pid>\`; both outside the session's command sandbox if it has one, because inside they do not see what an earlier command started), make sure from its command and folder that it is yours, and end that id.
If the owner asked for exactly this command, show it to them: they run it themselves.
`);
process.exit(2);
