---
name: dive
description: Use only when the owner asks for it, by the command /sz:dive or in words that ask for exactly this: to dig a one-line idea out together, round after round, until it is clear in their own head, before any map, plan or case ("아이디어 같이 파 보자", "딥다이브 해 줘", "브레인스토밍 해 줘", "이 생각 좀 구체화해 줘"). A passing wish ("이런 앱 있으면 좋겠다") starts nothing. Shows directions of different kinds to react to, asks for remembered moments rather than opinions, brings in what the world and the owner's report say, settles fixed lines by the owner's own words, and writes idea.md and the brief.md the owner confirms for the designer and builder.
---

# Dive: from one line to an idea that is clear

The owner arrives with one line: "this annoys me", "I read a report". A plan cannot be cut from that, and a single answer back is a guess about what they meant. A dive is a conversation of many rounds that ends when what they want is clear in their own head: who it is for and in what moment, the one thing, the first minute, why anyone comes back, what it is not. Building it, judging whether it would sell, and drawing it are later stages that read what the dive leaves.

**It runs when the owner asks for it, and only then.** It writes no product code, no map and no plan, and starts no other stage. It does not judge whether the idea is worth building (that is `sz:worth`, which also runs only when asked), so it never talks the owner out of an idea. When a free product already does exactly this well, say so as a fact with its source: that is material for `now` and `home`, not a verdict.

## What "clear" is

Clear is a fixed set of lines, kept by `sz-eyes dive`, each settled by the owner's words or left open by them on purpose. Every dive has `moment`, `now`, `core`, `first`, `back`, `not`, `feel`, `done`; an app adds `pain` and `home`; a game adds `loop`, `stakes`, `depth` and `lens`. `sz-eyes dive show <id>` prints each line with the question it asks the owner, its state, and what still stands between the dive and its close. How it feels to you is not the measure: the dive closes when the tool lets it close.

A line is `open`, `proposed` (your proposal, shown, not yet answered), `settled` (the owner's words settle it) or `waived` (they said to leave it open: "모르겠다, 만들면서 보자"). Write what each answer settles as soon as it comes, in the same turn:

```
sz-eyes dive line <id> core --status proposed --says "<your proposal, in a sentence>"
sz-eyes dive line <id> core --status settled --said "<their words, exactly as typed or chosen>" [--says "<what is settled, from their words>"]
sz-eyes dive line <id> feel --status waived --said "<their words>"
```

**Their words are theirs.** `--said` is taken only when it is found among what the owner typed (the plugin's hook keeps it) or chose and wrote in a question box (the session's transcript): quote the part of their answer that settles the line, as it stands. When they answered "1번이요" or "네" to your recommendation, `--said "1번이요"` with no `--says` settles the line on the proposal as it stood, and the page says the proposal was taken. In what you write to them, too, words in quotation marks are theirs as they stand; a shorter version is yours, said without them. A line they settled changes only by their words again. (A sentence a session wrote in the owner's place was once recorded as "주인:" in a contract; here the tool refuses it.) In Codex, start with `$sz:dive`. The tool reads direct user messages from the current Codex thread, including when the hook missed the first message. For every choice below, show numbered options in chat and ask the owner to reply with a number or their own words. This also applies to approval of the final brief. Only the reply they actually send can settle the choice.

## Where it is kept

`sz-eyes dive new` keeps the dive in `.sz/dive/<id>/` of the folder the session started in: the folder the product will live in, empty or not. Started in the home folder or in the harness's own repository, it is kept under `~/.studio-zero/dives/<day>-<id>/`, which the tool decides and prints; say the path to the owner. Writing there needs the command outside the session's sandbox (`dangerouslyDisableSandbox: true`; the tool says so when the sandbox stopped it). `sz-eyes dive saw --url` opens a page, and runs outside the sandbox too, as `sz:verify` lists.

## 1. The seed, and what there is to read

```
sz-eyes dive new <id> --kind app|game|plain --seed "<the owner's first words, as they said them>"
```

`app`: something a person uses (a service, an app, a feature of one). `game`: a game. `plain`: neither, which takes the common lines only. Then read what is there before the first round:

- The idea is an app: read `app.md` beside this file and follow it.
- The idea is a game: read `game.md` beside this file and follow it. A game from a report starts from the report, and if no file was given the first round asks for it (a path, an address, or pasted text) and nothing else.
- The folder the session is in: if it has `.sz/map.md`, read it and `.sz/spec.md`; otherwise its README if there is one. Do not run `sz:onboard`.

Start the reading of the world in the background (what `app.md` and `game.md` name) and go on: the first round never waits for it.

## 2. The first round: widen before narrowing

Write what you understood in three lines, then show **three directions of different kinds and one wildcard**: different in who it is for, in the moment, or in what the person does, never three variants of one feature. Each starts from something in the seed or the material (a word of theirs, a trait of the report, a complaint read) and says which; directions that would fit any seed of the kind are stock. (Two game dives from different people laid out the same four slots.) The wildcard is one the owner would not have thought of. Give each something to react to, since people answer a picture better than a blank page: a scene of one person in it ("월요일 아침 9시, 당신은 …"), a screen as ASCII, and for a game the beats of its first 30 seconds. Record each as it was shown:

```
sz-eyes dive direction <id> <direction-id> --name "<a few words>" --what "<who, in what moment, doing what>"
```

Put them in one question box: one single-select question whose four options are the directions, each with its scene and sketch in `preview` (shown beside the list; only single-select questions show it). The owner can always write their own instead ("다 아님", "1이랑 3 섞어서"). When they answer: `sz-eyes dive direction <id> <d> --status taken|merged|dropped --said "<their words>"`, and for one merged into another, `--note "<the part they took>"`: only that part reaches the page. Narrowing opens new forks; where one opens, widen there again with the same kind of choice.

## 3. Rounds that dig

Each round, work out the frontier: the open lines whose answers do not wait on another open line (`moment` and `pain` before `core`, `core` before `first` and `back`). Ask from it, four questions at most, in one turn that ends waiting for the owner:

- **A choice goes in the question box**, with your recommendation first and marked "(추천)", two to four options, and their own words always open. Word it so that taking the recommendation is one tap.
- **A remembered moment is asked as a typed question, one a round at most**: when it last happened, what they were doing, what they did then. Opinions about the future ("이런 게 있으면 쓰실 건가요?", "어떤 기능이 있으면 좋겠어요?") get kind answers and no facts; a memory gets the fact. The design lines (`core`, `first`, `feel`) are decisions, asked as choices.
- `moment` is a scene: a time of day, a place, what their hands are doing. A proposal with none of these is asked again as a memory ("그때 몇 시였고, 어디서, 뭘 하고 계셨어요?").
- `done` is asked, never proposed: who they would show it to first, and what that person would have to say. A test you invent ("열 명 중 셋이 끝까지") is not their measure. (In the evaluation, two interviewers proposed a test; the stand-ins took it with "1번이요", and their real measure, a person, never came out.)
- `not` starts from a memory: what they tried before and dropped, and why; then the rest of it as a choice.
- Find facts yourself (the world, the report, the folder); put only decisions and memories to the owner.
- End every round with the line the tool printed after your last change (`명확해진 줄 6/12 · 열린 것: back, depth, lens`).

When the session has no question box (a run with nobody at a terminal), put the same round as a numbered list, each choice with its options and your recommendation, previews as fenced blocks.

The owner's answer comes back in about a minute and a half a question; yours comes back within a minute. Nothing waits on the background reading: ask what does not need it, and bring its findings into the round after they arrive, each fact with its link, filed first with `sz-eyes dive saw`.

## 4. Shake it

When one direction has been taken and most lines are settled, ask two questions that look at it from outside: "1년 뒤에 이게 실패했다면 이유는 뭘까요?" and "이걸 절대 안 열게 만드는 건 뭘까요?". An answer that changes a line takes it back to that line, settled again by their words.

## 5. One page, and the close

When nothing is open or only proposed, show the page as it stands (`sz-eyes dive page <id> --summary "<the idea in one line>"`) and ask what they make of it. A correction goes back to its line. Their words on the page close the dive:

```
sz-eyes dive close <id> --summary "<the idea in one line>" --said "<their words on the page>"
```

It is refused while a line is open or only proposed, before three directions were shown and one taken, and without their words. It writes `idea.md` beside the dive. Take that page into the brief.

## 6. The brief: the page the next stages execute

`idea.md` says what the owner wants. The drawing and the build need one page that says what will be built. Write it
in the same sitting, while their answers are at hand. It takes one approval question. Every other line comes from
the dive.

**Where the line between filled and empty falls.** Two questions decide every line:

- 이게 빠지면 **다른 제품**이 되는가? Would this be a different product if it were missing? Then it is filled.
- 빌더가 이걸 **완전히 다르게** 정해도 같은 제품인가? Would a builder who decided it completely differently still
  have built this product? Then it is empty.

**Fill four things:**

1. The spine: who and in what moment (`moment`, `pain`), the world and its tone, the areas or the map's spaces, the
   one thing (`core`), the first minute (`first`), why a person comes back (`back`), the loop, how a run is won and
   lost and what is still new late (`loop`, `stakes`, `depth`), and what is deliberately absent (`not`).
2. One or two signature moments, **as the effect**. "상품을 돌리면 숨은 저주 바코드가 드러난다. 손끝이 먼저 안다."
   A claim can ask to see the hidden barcode appear. "R키로 15도씩 돌린다" and "스캐너 버튼은 우하단 56px" fix the
   input and layout before anyone has tried them.
3. The constraints no builder may break: the figures and wording a law gives, actual data sources, the platform,
   what a person's data may do, and money.
4. `done`: how the owner recognises that this is it, in their own words.

**Name all four things left open** under `## 비워 둘 것`: UI layout (UI 배치: where a control sits, how many lines,
sheet or page, tab order), input details (입력·단축키 세목: key, gesture, threshold, animation length),
implementation (구현 세부: component names, libraries, state, file boundaries), and the remaining candidates for
feel (나머지 손맛 후보). Leaving each open is a decision. Give each its constraint in one line: "상품을 돌리는 손맛은
있어야 한다 — 어떻게 돌리는지는 정하지 않는다". The designer records the decisions they take and why in
`direction.md`; the builder records the ones still theirs and why in `.sz/map.md`.

The sections, by kind (the tool checks these headings, in this order):

- app: `## 북극성`, `## 첫 1분과 핵심 여정`, `## 채울 것`, `## 비워 둘 것`, `## 톤과 제약`, `## 완료 기준`
- game: `## 북극성과 손맛`, `## 코어 동사`, `## 시간축 루프`, `## 승패와 밸런스`, `## 채울 것`, `## 비워 둘 것`, `## sz:game 연결`, `## 완료 기준`
- plain: `## 북극성`, `## 채울 것`, `## 비워 둘 것`, `## 완료 기준`

What each holds:

- **북극성**: whose moment, what one result, one paragraph. Quote only the owner's own words as theirs.
- **첫 1분과 핵심 여정**: `home` → `first` → why they come back, as the screens or steps a person passes.
- **코어 동사** (game): the verb and the feel, one sentence each. The keys, the gesture and the feedback mechanism
  stay open. 손맛은 채우고 조작은 비운다.
- **시간축 루프** (game): 30초 / 5분 / 한 시간 / 백 시간, as beats with numbers.
- **승패와 밸런스** (game): how a run ends, how long it takes, what makes it harder, the first numbers.
- **톤과 제약**: the feel, the product they named and what of its way is taken, the constraints, and what the dive
  read in the world (`saw`: what people already use, what it costs) where it bears on scope or money, each with its link.
- **sz:game 연결** (game): the fields `window.__game.state()` exposes, the invariants a check reads, and what a
  seed must reproduce.
- **채울 것 / 비워 둘 것**: as above, a line each. The last lines of 채울 것 are what is deliberately absent
  (`not`), each with why.
- **완료 기준**: `done`, in the owner's words.

Keep this to one page. Write your inferences plainly as what will be built. Use `주인: "…"` only for words from
the seed, a line, a choice of direction or the close of this dive.

Run `sz-eyes dive show <id>` and use **the folder it prints**, including when this dive lives outside the project.
Write `brief.draft.md` in that folder and show that draft in full. For a dive outside the project, use the Write
tool for the draft and give `--file` its full path. Ask one question as a choice they can tap:
**"이 북극성대로 지을까요?"** (네, 이대로 / 고칠 게 있어요 / 나중에).

- **네, 이대로**: use their exact answer and keep the version just shown, without editing it after approval.
- **고칠 게 있어요**: change only what they name, show the revised draft, and put the same approval question
  to them on that version. Their correction leaves the brief pending.
- **나중에**: keep only the draft and stop. Give its path and say that design and planning can proceed without a
  confirmed brief. When they come back to it, show the draft and ask the same question.

```
sz-eyes dive brief <id> --file "<folder printed by dive show>/brief.draft.md" --said "<their words>"
```

The heard log establishes that they said those words. It does not tell you which page they meant: only their
answer to this draft authorises keeping it. The tool checks the headings and the owner's quotations and writes
`brief.md` beside `idea.md`. Use `--force` only when they approve the new draft over an existing brief. Once they
have confirmed it, say in one line what they can ask for next: `/sz:worth` to judge whether it is worth building
or `/sz:build` to build it.

## Pausing and coming back

When the owner says to stop ("여기까지", "나중에"), the dive is already kept: say its progress line and the open lines, and stop. `/sz:dive` later begins with `sz-eyes dive show`: one dive not closed is taken up where it stood (say where); several are put to the owner as a choice. For a closed dive with a `brief.draft.md` and no `brief.md` in its folder, resume at step 6: show that draft for approval. The dive stays closed.
