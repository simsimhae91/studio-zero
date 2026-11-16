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
// Two things are kept apart. How work that was asked for is done follows from the request itself: that is what
// loading the plugin chose. A stage of its own (a trial, a case, a release, a look-over, a build to the end)
// takes many agents and minutes to hours, so it starts only when the owner asks for that stage: nothing they
// say in passing is taken as asking for one.
process.stdout.write(
  `${
    mapped
      ? 'sz: if this asks to build, change or fix something in the product, load the sz:work skill first and follow it (a small fix is done at once and shown before and after; a feature is agreed as claims and proven by an agent that did not build it).'
      : 'sz: this project has no map yet (.sz/map.md). If this asks to build, change or fix something, load the sz:onboard skill first (minutes of reading, no product code changed), then sz:work, and follow them.'
  } If the owner is reacting to work shown to them or to the product: sz:feedback. A stage of its own starts only when the owner asks for that stage, by its command or in words that ask for exactly it: /sz:trial (stand-ins use the product as its people), /sz:worth (is this the thing to build), /sz:ship (release), /sz:tend (look the product over), and the sz:build workflow (build to the end, when they say to run it to the end with a workflow). Never start one because what they said is related to it, and never as a step of something else: if one would answer what they are asking, do what they asked in the ordinary way and say in one line which command would go further. A question is answered as a question.\n`,
);
