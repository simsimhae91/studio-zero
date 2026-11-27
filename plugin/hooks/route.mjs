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
// A request written in Korean is answered in Korean: the sentence about that Korean goes with it, because what a
// session was told at its start is a hundred turns away by the time it writes.
const KOREAN = /[가-힣]/.test(said)
  ? " The Korean you write (to the owner, in files, on a product's screens) is the plain Korean a product team uses at work. Do not write 서다/세우다 (계획이 선다, 기준을 세운다), 짓다 (제품을 짓는다), 열리다 (결과가 열린다, 화면이 열린다) or 판 (첫 판, 새 판). Write 만들다, 구현하다, 정하다, 완성되다, 나오다, 뜨다, 보이다, 버전. The owner's own words are quoted as they said them."
  : '';
process.stdout.write(
  `${
    mapped
      ? 'sz: if this asks to build, change or fix something in the product, load the sz:work skill first and follow it (a small fix is done at once and shown before and after; a feature is agreed as claims and proven by an agent that did not build it).'
      : 'sz: this project has no map yet (.sz/map.md). If this asks to build, change or fix something, load the sz:onboard skill first (minutes of reading, no product code changed), then sz:work, and follow them.'
  } If the owner is reacting to work shown to them or to the product: sz:feedback. A stage of its own starts only when the owner asks for that stage, by its command or in words that ask for exactly it: /sz:dive (한 줄 아이디어를 머릿속이 명확해질 때까지 같이 파기: dig a one-line idea out with the owner, round after round, before any map or plan), /sz:trial (stand-ins use the product as its people), /sz:worth (is this the thing to build), /sz:ship (release), /sz:tend (look the product over), /sz:build (build a product or a large request to the end with a workflow). Never start one because what they said is related to it, and never as a step of something else: if one would answer what they are asking, do what they asked in the ordinary way and say in one line which command would go further. A question is answered as a question; asked what it takes to charge for the product, say first what would make a person pay for it and what stands in the way of that, and only then, briefly, what taking the money needs.${KOREAN}\n`,
);
