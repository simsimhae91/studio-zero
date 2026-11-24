# Dive: a game

The idea is a game, usually from something the owner read ("성공하는 인디게임의 6가지 공통점이라는 보고서를 읽었는데"). The report is material for questions, not a law: what the owner wants to make comes first, and the report is a set of lenses to look at it through.

## The report

If the owner named a report and no file came with it, the first round asks for it and nothing else: a path, an address, or the text pasted.

Read it to the end before the first round (a PDF with the Read tool, twenty pages a call). Then:

- **Each trait it names, as a lens:** the page, the sentence as it stands there, and the trait in a line. File each so the owner can check it: `sz-eyes dive saw <id> --file "<the report>" --page <n> --quote "<the sentence as it stands>" --shows "<the trait in a line>" --line lens`. A PDF is looked for on that page; a quotation NOT SEEN is copied again from the page or left out.
- **Its method in one line:** what it looked at, how many, how they were chosen, who wrote it.
- **What it cannot show, in one line:** a report that looked only at games that succeeded and never at ones that failed has seen survivors, not causes; a handful of games is a handful of stories; a trait every game has, the failures had too.

Show the lenses and these two lines in the first round, beside the directions.

## Directions

Each direction of the first round is a game: its verb (what the player does with their hands), its first 30 seconds as beats, one existing game it is near, and which lenses it aims at and which it lets go. Show the directions against the lenses as a table:

```
            렌즈1 짧은 한 판  렌즈2 친구와  렌즈3 …
방향 A         ●               –
방향 B         ●               ●
```

## The world, read in the background

For each reference game the owner warms to, start one agent in the background (the Agent tool, `subagent_type: "general-purpose"`, `model: "sonnet"`, `run_in_background: true`) to read its public Steam page (`https://store.steampowered.com/app/<id>/?l=koreana`: the review summary such as "압도적으로 긍정적" and its count, the price, the tags) and file what it finds with `sz-eyes dive saw <dive id> --url ... --quote ... --shows ... --line feel` (outside the sandbox: `dangerouslyDisableSandbox: true`). On 2026-11-24 the store page could be read without an account; the review feed (`/appreviews/<id>?json=1`) sent the reader to the store's front page instead.

## The lines of a game, and how each is asked

- `lens`: which traits they aim at head on and which they drop, each with why: a choice per lens, after the report's method and limit were shown.
- `core`: the verb and the fun in one sentence each ("카드를 내려놓는다. 마지막 한 장으로 판이 뒤집히는 맛").
- `loop`: proposed as beats (30초: …, 5분: …, 한 시간: …) for them to correct.
- `stakes`: how a run is won and lost and how long one takes, as a choice with numbers.
- `depth`: what is still new at hour one hundred. A choice between kinds (new cards, new places, other players, their own records).
- `moment` and `now` are about the player: when they play and what they play now. Ask the owner about their own last time playing something like it: what, where, how long, why they stopped.

Building the game after the dive is `sz:game` and `sz:work`.

In the brief, `## 코어 동사` gives just the verb and the feel, leaving the input open. `## sz:game 연결` names the fields `window.__game.state()` must expose for a check to show that the loop works.
