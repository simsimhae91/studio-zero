---
name: onboard
description: Use when starting work in a project that has no .sz/map.md yet, or when the user asks to continue, take over, or get to know an existing project. Reads the project and writes its map so that any later session can pick it up. Changes no product code.
---

# Onboard: read a project and write its map

A project is a folder. Before work is done in one, there is a map of it: what it is, how each thing it builds is launched, looked at and operated, and what checks it already has. The map is what makes continuing possible, in this session and in the next one that knows nothing.

This is minutes of reading, not a rewrite. Change no product code, add no dependency, add no marks. The project's own grain comes first: its tests, its end-to-end flows, its scripts, its conventions.

If `sz-eyes` says the session's command sandbox stopped a browser or an app from starting, write that in the map where it says how the product is looked at ("this owner's sessions are sandboxed: the eyes and the flows that open a browser run outside it"), so that the next session does not find it out again.

## Steps

1. **What it says of itself.** Read README, AGENTS.md / CLAUDE.md (root and beside each product), package manifests, CI files, and the top of the test and e2e folders. Read `git log --oneline -30` for what has been happening.
2. **What it builds (targets).** For each product in the repository say which it is: `web`, `ios`, `android`, `electron` (a desktop app on Electron), `macos`, `windows`, `game` (and the engine), `extension` (a browser extension: the eyes cannot load one yet, so say what checks it has of its own). A repository may hold several, or documents beside a product.
3. **For each target, three things, with exact commands:**
   - *launch*: how it is built and started (dev server and port; the built app and its bundle id; the game's run command). For a server, also how it is told to use another port (an environment variable, a flag): agents start their own copy on a port from the machine (`sz-eyes port`) and never on the owner's. If it cannot be told, write that down.
   - *look and operate*: `sz-eyes web look|do <url>` for a page; `sz-eyes ios ...` with the app path and bundle id for a simulator build; `sz-eyes electron look|do <app folder>` for a desktop app built on Electron; for anything else, the command that shows it.
   - *for a desktop app, what keeps a look away from the owner's own use of it*, each read from the code of its main process and written down with the variable or switch that does it: where it keeps its data and how it is pointed at another folder (look for `setPath('userData'`; if it has no way, write that it cannot be started for a look); the port it listens on and how it is given another; how it is started on a given window; and what it does at launch that reaches outside itself (a check for updates, a global shortcut, a login item, pairing with a browser extension) with the switch that turns each off. Write the whole command as it is run: `sz-eyes electron look . --env SIDE_USER_DATA={data} --env SIDE_NO_UPDATE=1`.
   - *checks it already has*: the type check, unit tests, end-to-end flows (Maestro, Playwright, XCUITest, GUT...), each with the command that runs it and how long it takes if the scripts say.
4. **Where it runs, what it keeps, and what it knows of its use.** Each place it runs for people, by name: the address, and the exact command to build what goes out, release it, list releases, put the previous version back, and set a secret (`sz:ship` works from these). `sz-eyes release list` says what was released there. Where what people enter is kept (a file, a database), how a copy of it is taken, and how its shape is changed (migrations). Where failures and use are recorded (a log, an error tracker, counts). "Nowhere" is an answer worth writing: looking after the product (`sz:tend`) starts from it.
5. **Where its scripts write.** Open every script and flow you list and note any absolute path or any path outside the repository that it writes to. A flow that writes to an absolute path is run only from a copy (`sz-eyes ios flow` does that).
6. **Its own rules.** The conventions that a change must keep (naming, structure, design system, copy voice, commit style), each with where it is written down or where you saw it.
7. **What you could not find out.** Say it. An honest "unknown" is worth more than a guess that the next session trusts.

## Write `.sz/map.md`

At most 140 lines, in the owner's language, in this order: 무엇인가 · 대상과 띄우는 법 · 보는 법과 누르는 법 · 이미 있는 검사 · 배포와 데이터 · 오류와 사용이 보이는 곳 · 이 저장소의 규칙 · 스크립트가 쓰는 곳 · 모르는 것. Commands in code spans, exactly as they are run. No history, no praise, nothing that will be false next week.

Then add one line to `.sz/progress.md` (create it): the date, "지도를 씀", and what is unknown.

## Report

Short enough to read at a glance: what the project is, its targets, the checks it already has, and what is unknown. Onboarding itself starts no work and changes no product code. If it was loaded on the way to a request to build, change or fix something, go on to that request with `sz:work`; if the owner asked only for the map, stop here.
