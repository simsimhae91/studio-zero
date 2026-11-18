# 2026-11-18: the same first pass again, with the changes for speed

The first pass of the diet battle (the request of 2026-11-17, the same approved prototype) built again in a new
folder, to set the workflow as changed on the branch `faster-close` beside the run of the day before (290
minutes, `docs/runs/2026-11-17-whole-run/`). The plugin was a frozen copy of the branch at `17e4bce`: flows of
later milestones written by whoever verifies, verification shared out by cost among up to five, a fixer that
runs only the checks of what it mended, nothing planned after a capped run. `sz-eyes copy` and the `built`
signal (later commits of the branch) were not in it. Headless sessions on Opus 5.5, session effort xhigh.

Its folder is `~/.studio-zero/specimens/2026-11-18/diet-b/` (a git repository of its own, pushed nowhere).

One run each way, and this one was cut: read the figures as showing what changed shape, not minutes to trust.

## What is here

| File | What it is |
|---|---|
| `build-request.txt`, `continue-request.txt` | What each headless session was asked, in the owner's place |
| `run-build.sh`, `run-continue.sh` | How each was started |
| `clock.txt` | When each session started and ended, and when the lid was closed |
| `journals/build-cut.jsonl`, `continue.jsonl` | The workflow's own journal of each session |
| `timelines.txt` | Per agent: model, effort, wall-clock, tokens; model minutes against command minutes; the slowest commands |

## What happened

| Stretch | From | To | Minutes | |
|---|---|---|---|---|
| Plan | 10:10 | 10:25 | 14 | |
| Build | 10:25 | 11:36 | 71 | built 88 minutes after the session started (77 the day before) |
| Verification, five at once | 11:36 | 11:52 | 16 | three verdicts, ten flows; then the Mac was closed and carried away |
| (asleep) | 11:52 | 17:17 | | 45-second wakes with no network; every agent ended on an API error at 12:47 |
| Continued from the built state | 17:24 | 19:33 | 128 | plan (continue) 3, start 2, then as below |

What the five verifiers had left was put on the branch `cut-1152` of the specimen and not carried over, so
that everything after "built" was measured in one stretch from a clean state. The stacks and the server the
dead run had left (five stacks, 35 containers, up for six hours) were stopped first.

## Beside the day before

| Stage | 2026-11-17 | 2026-11-18 |
|---|---|---|
| plan | 9 | 14 |
| build | 67 | 71 |
| first look | 74 (three verifiers: 45, 61, 74) | 43 (five: 27, 29, 36, 39, 43) |
| fix 1 | 74 (48 of it waiting on every flow, one after another) | 30 (6 waiting on the checks of what it mended) |
| ruling on what the fixer could not make true | none | 16 |
| second look | 27 | 33 |
| fix 2, third look | 16, 22 | none |
| close | 1 | 1 |
| **request to closed** | **290** | **211** (88 to built, 123 after; the 5 minutes of continuing left out) |
| built to closed | 213 | 123 |

| Verdicts | 2026-11-17 (20 claims) | 2026-11-18 (19 claims) |
|---|---|---|
| first look | 13 proven, 5 refuted, 2 the owner's | 15 proven, 3 refuted, 1 the owner's |
| at the close | 19 proven (one by the owner), 0 refuted, 1 open | 17 proven, 0 refuted, 2 the owner's (`as-drawn` set aside for them, `feel`) |

The five shares were `rules weigh-in weigh-rules onboarding`, `random-match invite ai-battle battle`,
`result ranking tipcards my-log`, `my-page privacy ops as-drawn`, `limits motion feel`.

## What it shows

1. **The three changes worked as meant.** Five verifiers finished within 27 to 43 minutes of each other (45 to
   74 before). The fixer ran the checks of its own claims and waited 6 minutes on them, not 48. No plan ran
   after the close.
2. **Not all of the 79 minutes is theirs.** There was no second fix round because fewer claims were refuted and
   none stayed so; the product was built anew, so that is partly chance. Plan and build were not touched and
   came out 9 minutes slower.
3. **Verifiers have no Skill tool** (`plugin/agents/verifier.md`: `tools: Read, Grep, Glob, Bash`), and both
   their own instructions and the workflow tell them to load `sz:verify`. Every verifier searched the whole
   disk for the file (`find / … SKILL.md`, about two minutes each, in both runs), and two of five read the copy
   in another checkout of the repository, not the one of the plugin that was running.
4. **The ruling after a fix looked again at claims nobody disputed.** The fixer said one claim (`as-drawn`)
   could not be made true without changing what was agreed; the arbiter was handed all three refuted claims
   and ran the flows of the two that had just been mended (8 of its 16 minutes), which the second look does
   anyway.
5. **The second look is one verifier**: 33 minutes for 17 claims, the flows run at once on copies.
6. **`motion` was left proven without a check that passes.** Proven at the first look; at the second its flow
   did not walk to the end in any of ten runs, on the mended build or on the earlier one, and the verdict
   stayed with a note. The flow opens each scene with `sz-eyes web do --clock` and then `go:`es to the screen.
   Playwright replays the held clock into every new page (read in its source, 1.65.0), so a page reached by
   `go:` has its time held from its first instant, and whatever its start-up waits on with a timer never
   comes. Which scenes stall changes from run to run, and a busy machine makes it worse. What in this
   product's start-up needs the timer is not found yet.
7. **Two verifiers kept their copies inside the project's evidence folder** (`.sz/evidence/first-pass/v1/`,
   with a built `dist/`, a stack and its secret file, all outside git by the ignore rules). `sz-eyes copy`
   refuses a folder inside the project; it was not in this copy of the plugin.
8. **A run does not survive the Mac being closed.** With no network every agent used up its ten retries inside
   the short wakes of a sleeping Mac, and what the run had started kept running on battery for hours.
9. What the verifiers saw of the product, outside the verdicts (among them: a person can rewrite their own
   weigh-ins and steps straight in Supabase with the public key, past the server's scoring), is in the
   specimen's backlog: 21 lines.
