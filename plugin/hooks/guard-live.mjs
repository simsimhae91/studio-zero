#!/usr/bin/env node
// Before a shell command runs: what is live is what people are using, and what they stored there is not the
// agent's to delete. In the field, agents have deleted production databases together with their backups in
// seconds, by a command that looked like cleaning up. A release changes what is live by putting a new version
// there, and takes it back by the way back the map names. Deleting or resetting a hosted database, a hosted
// project, an app, a volume or a bucket is the owner's act: they run it themselves.
// Exit 2 refuses the command and says so.

import { readCommand, runs } from './shell.mjs';

const command = await readCommand();
if (command === null) process.exit(0);

const text = runs(command);
const HERE = '(127\\.0\\.0\\.1|localhost|host\\.docker\\.internal|\\[::1\\]|0\\.0\\.0\\.0)';
// A database address that is not on this machine: `scheme://user:pass@host`.
const elsewhere = new RegExp(`\\b[a-z][a-z0-9+]*://[^\\s"'@/]*@(?!${HERE}[:/])[^\\s"'/:]+`, 'i');
const DESTROYS = /\b(drop\s+(table|database|schema|index|view|type|function|policy|trigger|extension)|truncate\s|delete\s+from\s+\S+\s*(;|"|'|$)|flushall|flushdb)\b|--clean\b/i;

const which = [
  [/\bsupabase\s+db\s+reset\b[^;\n]*(--linked|--db-url)/, 'the hosted database: every table and every row in it'],
  [/\bsupabase\s+(projects\s+delete|branches\s+delete|functions\s+delete|storage\s+rm\b[^;\n]*--linked|backups\s+restore)\b/, 'something of a hosted Supabase project (the project, a branch, a function, stored files, or the database as it is now)'],
  [/\bfly(ctl)?\s+(apps?\s+destroy|volumes?\s+(destroy|delete)|(postgres|pg|mpg)\s+[^;\n]*\b(destroy|detach)\b|ext(ensions)?\s+\S+\s+destroy|redis\s+destroy)\b/, 'an app, a volume or a database on Fly, with what is stored in it'],
  [/\bwrangler\s+(delete\b|d1\s+delete\b|d1\s+time-travel\s+restore\b|r2\s+bucket\s+delete\b|r2\s+object\s+delete\b|kv\s+(namespace|key|bulk)\s+delete\b|queues\s+delete\b|pages\s+project\s+delete\b|vectorize\s+delete\b|hyperdrive\s+delete\b)/, 'a Worker, a database, a bucket or a store on Cloudflare, or the database as it is now'],
  [/\bvercel\s+(rm|remove)\b|\bvercel\s+projects?\s+(rm|remove)\b|\bvercel\s+(domains|blob|env)\s+(rm|remove|del)\b/, 'a deployment, a project, a domain, stored files or a setting on Vercel'],
  [/\bfirebase\s+(projects:delete|firestore:delete|database:remove|hosting:disable|functions:delete|firestore:databases:delete)\b/, 'something of a Firebase project (the project, the database or what serves it)'],
  [/\bgcloud\s+(projects\s+delete|sql\s+instances\s+delete|run\s+services\s+delete|firestore\s+databases\s+delete|storage\s+(rm|buckets\s+delete))\b/, 'a Google Cloud project, database, service or bucket'],
  [/\brailway\s+(down|delete|volume\s+delete|environment\s+delete)\b|\bnetlify\s+sites:delete\b|\bheroku\s+(apps:destroy|pg:reset)\b/, 'an app or a database where it is hosted'],
  [/\b(terraform|tofu)\s+(destroy\b|apply\b[^;\n]*-destroy\b)|\bpulumi\s+destroy\b/, 'everything this configuration made, databases and their backups included'],
  [/\bgh\s+repo\s+delete\b/, 'the repository on GitHub'],
].find(([pattern]) => pattern.test(text))?.[1]
  // SQL that deletes, sent to a database that is not on this machine. The statement is usually inside quotes, so
  // the whole command is read for it; the tool has to be something the shell runs.
  ?? (/\b(psql|pg_restore|dropdb|mysql|mongosh|redis-cli|supabase\s+db\s+(execute|query))\b/.test(text) && elsewhere.test(command) && (DESTROYS.test(command) || /\bdropdb\b/.test(text)) ? 'tables or rows of a database that is not on this machine' : null)
  ?? (/\bwrangler\s+d1\s+execute\b/.test(text) && /--remote\b/.test(text) && DESTROYS.test(command) ? 'tables or rows of the hosted database' : null);
if (!which) process.exit(0);

process.stderr.write(`This would delete or reset ${which}. That may be what people are using, and it cannot be put back from here: an agent does not do it.
To change what is live, release a new version (sz:ship). To undo a release, use the way back the map names (\`sz-eyes release list\` shows it). To change the shape of what is stored, write a migration that keeps what is there, and rehearse it on a copy first.
If the owner asked for exactly this, show them the command and what it deletes: they run it themselves (\`! <command>\`).
`);
process.exit(2);
