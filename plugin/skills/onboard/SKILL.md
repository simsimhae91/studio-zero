---
name: onboard
description: Use when starting work in a project that has no .sz/map.md yet, or when the user asks to continue, take over, or get to know an existing project. Reads the project and writes its map so that any later session can pick it up. Changes no product code.
---

# Onboard: read a project and write its map

A project is a folder. Before work is done in one, there is a map of it: what it is, how each thing it builds is launched, looked at and operated, and what checks it already has. The map is what makes continuing possible, in this session and in the next one that knows nothing.

This is minutes of reading, not a rewrite. Change no product code, add no dependency, add no marks. The project's own grain comes first: its tests, its end-to-end flows, its scripts, its conventions.

## Steps

1. **What it says of itself.** Read README, AGENTS.md / CLAUDE.md (root and beside each product), package manifests, CI files, and the top of the test and e2e folders. Read `git log --oneline -30` for what has been happening.
2. **What it builds (targets).** For each product in the repository say which it is: `web`, `ios`, `android`, `macos`, `windows`, `game` (and the engine). A repository may hold several, or documents beside a product.
3. **For each target, three things, with exact commands:**
   - *launch*: how it is built and started (dev server and port; the built app and its bundle id; the game's run command).
   - *look and operate*: `sz-eyes web look|do <url>` for a page; `sz-eyes ios ...` with the app path and bundle id for a simulator build; for anything else, the command that shows it.
   - *checks it already has*: the type check, unit tests, end-to-end flows (Maestro, Playwright, XCUITest, GUT...), each with the command that runs it and how long it takes if the scripts say.
4. **Where its scripts write.** Open every script and flow you list and note any absolute path or any path outside the repository that it writes to. A flow that writes to an absolute path is run only from a copy (`sz-eyes ios flow` does that).
5. **Its own rules.** The conventions that a change must keep (naming, structure, design system, copy voice, commit style), each with where it is written down or where you saw it.
6. **What you could not find out.** Say it. An honest "unknown" is worth more than a guess that the next session trusts.

## Write `.sz/map.md`

At most 120 lines, in the owner's language, in this order: 무엇인가 · 대상과 띄우는 법 · 보는 법과 누르는 법 · 이미 있는 검사 · 이 저장소의 규칙 · 스크립트가 쓰는 곳 · 모르는 것. Commands in code spans, exactly as they are run. No history, no praise, nothing that will be false next week.

Then add one line to `.sz/progress.md` (create it): the date, "지도를 씀", and what is unknown.

## Report

Ten lines at most: what the project is, its targets, the checks it already has, and what is unknown. Then stop: onboarding starts no work.
