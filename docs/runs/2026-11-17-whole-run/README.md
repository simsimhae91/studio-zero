# 2026-11-17: the first whole run of `sz:build`, request to native app

One request ("다이어트 배틀앱을 만들어보려고 합니다.") taken through every stage of the workflow for the first
time: screens planned and drawn, the owner's verdict, a first pass built to the drawing in a browser at phone
size, verified and mended, then the native iOS app on the eyes' simulator. Three headless sessions on Opus 5.5
(session effort xhigh), the plugin from `main` at `f69d6e4`. The product is a specimen: it measures the harness.

Its folder is `~/.studio-zero/specimens/2026-11-17/diet/` (a git repository of its own, not pushed anywhere).

## What is here

| File | What it is |
|---|---|
| `request.md` | The owner's request and every word they said along the way, as they said it |
| `design-request.txt`, `build-request.txt`, `native-request.txt` | What each headless session was asked, in the owner's place |
| `clock.txt` | When each session started and ended |
| `journals/design.jsonl`, `build.jsonl`, `native.jsonl` | The workflow's own journal of each run: every agent started, and what each returned |
| `timelines.txt` | Per agent: model, effort, wall-clock, tokens; model minutes against command minutes; the slowest commands |
| `wfstat.py`, `wfsplit.py`, `pack_logs.py` | The scripts that made the timelines and the copies |

The agents' whole transcripts (40 files) are on the branch `diet-run-logs` under `raw/`, compressed, and are
not meant to be merged. In every copy, e-mail addresses, client ids and tokens are masked, and a picture an
agent looked at is a note of its size (the pictures are in the specimen's `.sz/evidence/`).

## The run

| Stretch | From | To | Minutes | Ended with |
|---|---|---|---|---|
| Design front | 18:40 | 19:26 | 45.5 | 24 screens, 44 drawings, no mending round; stopped for the owner |
| The owner | 19:26 | 19:49 | | "1,2 는 지금안할게요. 3은 켜두었습니다. UI는 넘 좋네요. 진행합시다." |
| First pass | 19:49 | 00:39 | 290 | 20 claims: 19 proven (one by the owner), 0 refuted, 1 the owner's still open |
| (cap) | | 00:49 | | The five-hour cap cut the session during the plan after the first pass |
| Native app | 00:51 | 06:19 | 329 | 7 claims: 6 proven, 0 refuted, 1 the owner's (given at 08:45) |

From the request to the app on a simulator: 11 hours 40 minutes on the clock.

### First pass, by stage

| Stage | Wall minutes | Model minutes | Command minutes | What the commands were |
|---|---|---|---|---|
| plan | 9 | 9 | 0 | |
| build | 67 | 50 | 17 | flows 5, web build 4 |
| verify (3 at once: 45, 61, 74) | 74 | 19 + 29 + 22 | 26 + 32 + 52 | writing and running flows 67, waiting on runs 28 |
| fix 1 | 74 | 11 | 63 | waiting on every flow run again, one after another: 48 |
| verify again | 27 | 14 | 13 | |
| fix 2 | 16 | 5 | 11 | a database reset and the limits flow: 5 |
| verify again | 22 | 15 | 7 | |
| close | 1 | | | |

First verification: 13 proven, 5 refuted, 2 the owner's. Three of the five had one cause (a sheet's buttons
under the fixed bottom bar: a stacking context of React Native on the web); one was a race in random matching.

### Native app, by stage

| Stage | Wall minutes | Model minutes | Command minutes | What the commands were |
|---|---|---|---|---|
| plan | 10 | 10 | 0 | |
| build | 182 | 37 | 145 | driving the simulator 92, waiting (builds, the web flows twice) 32, stack 8 |
| arbiter, 11 rulings one after another | 75 | 37 | 38 | each started the product again |
| verify (1) | 58 | 21 | 36 | waiting on the web flows and the iOS flows: 22 |
| close | 1 | | | |

Verified true at the first look: no mending round. Ten of the eleven rulings found a check wrong about how it
checks (flows the builder wrote and froze before the code); one found the claim's wording wrong.

### Design front, by agent

| Agent | Wall minutes | Of which waiting for another agent's file |
|---|---|---|
| screens | 13 | |
| refs | 11 | 8 (for the frame) |
| design | 43 | 9 (for the frame and the board); then reading and the direction 6, the frame and parts 5, pictures 3, the screens 9 (eight groups, 105 KB, written as pieces and joined), measuring, mending and walking the flows 8.5 |
| sweep | 1 | |

## What it showed about the harness

1. **From built to closed is 73% of a first pass** (212 of 290 minutes), and most of that is not thinking:
   verifiers write every flow by hand against the running product, the fixer runs the whole suite again one
   flow after another (48 minutes of waiting), and each look sets up its own copies again (3, then 5, then 6).
2. **Stacks are not the cost** I first took them for: 12 minutes of 290.
3. **Checks written and frozen before the code cost the phone milestone about half its time**: 92 minutes of
   the builder driving the simulator against its own flows, then 75 minutes of rulings. The first pass, whose
   flows the verifiers write afterwards, had no dispute.
4. **Fixing waits for the slowest verifier.** The first verifier returned at 45 minutes; the fix began at 74.
5. **The owner saw the product at its close, not when it stood**: built at 21:07, shown at 22:21 by hand,
   closed at 00:39.
6. **A stack started through `sz-eyes` slept.** The Supabase command line stops each service after a minute
   idle; the owner's first taps on sign-in on the simulator opened an empty window (46 seconds to wake after
   two idle hours). Fixed on `stop-wording` (`880e48c`): `sz-eyes supabase start` asks for `--eager`.
7. A contract can be frozen with no file listed (`phone`), after which no correction can be recorded on it.
8. The plan after the first pass turned an unexplained remark of the owner's ("팁카드 쪽이 좀 별로긴한데") into
   a rework of its own design before they had said which part.
9. No eyes for Android: the phone milestone is iOS only.
10. The same evening the owner's own run (G-SafeAD) built on Sonnet 5.5 under Opus verifiers: 45 minutes to
    build 34 screens, 11 proven and 3 refuted at the first look, 151 minutes to its end. Different product,
    so no conclusion on the builder's model; `args.model` (on `stop-wording`) makes the comparison possible.
