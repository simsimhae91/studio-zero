#!/usr/bin/env node
// Before a tool of the openai-image server is called: each picture it makes is billed to the owner's OpenAI API
// key. On 2026-11-17 four designer agents made 23 pictures with it in one evening. The owner's decision: pictures
// are made only on a subscription they already pay for (codex signed in with ChatGPT, through `sz-eyes image
// make`), never through an API that bills for each one. Inside a project of theirs (one with a .sz folder) the call
// is refused and the way on the subscription is named. Outside one, or when the owner has set SZ_PAID_IMAGES=1,
// nothing is said. A call this hook cannot read is let through: it never blocks on its own errors.
// Exit 2 refuses the call and says why.
import { statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

/** Whether this folder, or one above it, holds a .sz folder. */
function inProject(from) {
  for (let dir = resolve(from); ; dir = dirname(dir)) {
    try {
      if (statSync(join(dir, '.sz')).isDirectory()) return true;
    } catch {
      // Not here: look one folder up.
    }
    if (dirname(dir) === dir) return false;
  }
}

try {
  if (process.env.SZ_PAID_IMAGES === '1') process.exit(0);
  let input = '';
  for await (const chunk of process.stdin) input += chunk;
  const call = JSON.parse(input);
  const cwd = call?.cwd ?? process.cwd();
  if (typeof cwd !== 'string' || !inProject(cwd)) process.exit(0);
} catch {
  process.exit(0);
}

process.stderr.write(`Not called: this tool bills the owner's OpenAI API key for each image it makes. In this project pictures are made only on the subscription the owner already pays for (codex signed in with ChatGPT), never through an API that bills per image.
Make it this way instead, started in the background (one picture takes one to three minutes) while you go on working:
  sz-eyes image make --prompt "<what it shows and what it is for>" --name <name> [--size WxH]
It writes .sz/design/assets/<name>.png at exactly that size (sz-eyes help lists the sizes). codex keeps what it makes in ~/.codex, so run it outside the session's command sandbox.
`);
process.exit(2);
