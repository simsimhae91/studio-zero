#!/usr/bin/env node
// When the owner says something: one line that says which way of working fits it. A plugin's skills are a few
// among hundreds a session can load, and in the owner's first real use of this one (47 minutes, six requests)
// none of them was loaded: the session did the work bare, with no map, no before and after, nobody checking.
// Loading this plugin is the owner choosing its way of working, so each request is told where it goes.
// What is printed is added to what the session reads; nothing is refused.
import { existsSync } from 'node:fs';
import { join } from 'node:path';

let input = '';
for await (const chunk of process.stdin) input += chunk;
let call;
try {
  call = JSON.parse(input);
} catch {
  process.exit(0);
}
const said = String(call?.prompt ?? '').trim();
// A command of the tool itself, or a word of assent, asks for nothing new.
if (said === '' || said.startsWith('/') || said.length < 6) process.exit(0);
const mapped = existsSync(join(call?.cwd ?? process.cwd(), '.sz', 'map.md'));
process.stdout.write(
  `${
    mapped
      ? 'sz: if this asks to build, change or fix something in the product, load the sz:work skill first and follow it: it sizes the work (a small fix is done at once and shown before and after; a feature is agreed as claims and proven by an agent that did not build it).'
      : 'sz: this project has no map yet (.sz/map.md). If this asks to build, change or fix something, load the sz:onboard skill first (minutes of reading, no product code changed), then the sz:work skill, and follow them: work is sized, a small fix is shown before and after, a feature is proven by an agent that did not build it.'
  } If the owner is reacting to the product or to work shown to them: sz:feedback. How it is doing, or what to do next: sz:tend. Putting it where people reach it: sz:ship. A question that changes nothing is answered as usual.\n`,
);
