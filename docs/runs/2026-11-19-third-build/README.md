# 2026-11-19: the same first pass a third time, and on to the native app

The first pass of the diet battle (the request of 2026-11-17, the same approved prototype) built a third time in
a new folder, with the plugin as it stood on the branch `held-clock` at `a53ce0c`: everything of the run of
2026-11-18 (`docs/runs/2026-11-18-faster-close/`), plus `sz-eyes copy`, the `built` signal, verifiers and arbiters
with the Skill tool, a ruling after a fix that covers only what the fixer could not fix, one arbiter for all of a
milestone's disputes, Safari's first-run tip off, the held clock fixed, and the look after a fix shared by up to
three. Headless sessions on Opus 5.5, session effort xhigh, nobody at the Mac.

Its folder is `~/.studio-zero/specimens/2026-11-19/diet-c/` (a git repository of its own, pushed nowhere).

One run each way: read the figures as showing what changed shape, not minutes to trust.

## What is here

| File | What it is |
|---|---|
| `build-request.txt`, `continue-request.txt` | What each headless session was asked, in the owner's place |
| `run-build.sh`, `run-continue.sh` | How each was started |
| `clock.txt` | When each session started and ended |
| `finish-request.txt`, `run-finish.sh`, `finish2-request.txt`, `run-finish2.sh` | The same for the two sessions of 2026-11-21 that went on from the stop |
| `journals/build.jsonl`, `journals/continue.jsonl`, `journals/finish.jsonl`, `journals/finish2.jsonl` | The workflow's own journal of each session |
| `session-patch.diff` | What the continuing session changed in a copy of the workflow's script to get past a false stop (finding 14) |
| `timelines.txt` | Per agent: model, effort, wall-clock, tokens; model minutes against command minutes; the slowest commands |

## The build: 221 minutes, and the first pass left open

| Stage | 2026-11-17 | 2026-11-18 | 2026-11-19 |
|---|---|---|---|
| plan | 9 | 14 | 12 |
| build | 67 | 71 | 60 (it stood 72 minutes after the session started; 77 and 88 before) |
| first look | 74 (three verifiers: 45, 61, 74) | 43 (five: 27, 29, 36, 39, 43) | 47 (five: 21, 23, 28, 33, 47) |
| fix 1 | 74 | 30 | 31 |
| ruling on what the fixer could not make true | none | 16 | none |
| second look | 27 (one verifier) | 33 (one) | 22 (three: 11, 15, 22) |
| fix 2 | 16 | none | 23 |
| ruling after it | none | | 4 |
| third look | 22 (one) | none | 18 (three: 10, 17, 18) |
| last ruling, close | 1 | 1 | 3, 0.5 |
| **request to the end** | **290**, closed | **211**, closed | **221**, open |
| built to the end | 213 | 123 | 148 |
| request to the end of the second look | 251 | 210 | 172 |

| Verdicts (20 claims) | proven | shown false | the owner's |
|---|---|---|---|
| first look | 14 | 4: `battle`, `tips`, `drawn`, `limits` | 2 |
| second look | 16 | 2: `random` (proven at the first look), `drawn` (another screen) | 2 |
| third look | 16 | 2: `random` (a smaller gap left), `log` (proven at both looks before) | 2 |

Eighteen agents, 4.1 million output tokens, 1,667 tool calls.

## What it shows

1. **The look after a fix, shared by three, took 22 and 18 minutes** (33 with one verifier the day before). The
   slowest share both times was the one with the every-screen flow, the as-drawn look and the motion flow.
2. **No verifier searched the disk for its skill.** All eleven verifier sessions loaded `sz:verify` with the
   Skill tool (the day before every one of them ran `find / … SKILL.md`, about two minutes each).
3. **Every verifier made its copies with `sz-eyes copy`**, two or three each, none inside the project's
   evidence folder.
4. **A ruling after a fix took four minutes** for the one claim the fixer said it could not mend (16 the day
   before, when the arbiter was handed all three and ran the flows of the two just mended).
5. **The motion flow walked to its end on its first run at each of the three looks, with the same reads each
   time** (MT-02: −160, −9.71751 at 250 ms, 0 at 500 ms). The day before it did not reach its end in any of ten
   runs at the second look. The clock is held from a page's first instant and passed a frame at a time by the
   eyes (`d59d7d5`).
6. **The run stopped "after two fixes" though no fix had failed.** Each fix made true what it was handed, and
   each look found something the one before had not: `random` passed its flow once at the first look and failed
   one run of two at the second (the server took a person off the queue before it wrote the battle); mended, a
   verifier asking 110,000 times found a gap of two statements left. `log` was shown false only at the third
   look (a person who last weighed 20 days ago sees 0.0 kg in the two-week tab). A milestone was mended twice whatever was found
   when, so a claim found at the last look never had its fix. Now a claim is handed to a fixer twice at most and
   a milestone is mended four times at most (`f72a44f`).
7. **Going on from such a stop would have looked at all twenty claims again**, by five verifiers, before anyone
   mended the two. Whoever starts a built milestone now also says what the contract records of an earlier look,
   and when that covers every claim the run takes the milestone up at the fix (`f72a44f`).
8. **The owner would not have been shown the product when it stood.** The builder said so at minute 72
   (`sz-eyes contract built`) and the workflow logged `BUILT`; the session waited on `sz-eyes standing --summary`,
   as the workflow's own description still told it, which answers only once a contract is closed. The wait ran two
   hours until it was ended. The description now names the builder's signal (`f72a44f`).
9. **One of eleven verifier sessions left two stacks running.** It stopped its copies' stacks with a flag the
   command does not have (`--no-backup`), threw the refusal away, removed the folders, and then removed containers
   by a name pattern; the two stack hosts and their helper containers were found an hour after the run. A stack is
   known by its folder, so a copy is now ended in one step that removes the folder only when its stack has stopped:
   `sz-eyes copy <folder> --end` (`e22b239`).
10. **The slowest share of the first look was mis-weighed.** The as-drawn look ("24화면 각 상태") was weighed as
    one flow, so it went to the same verifier as the every-screen flow and the motion flow: 47 minutes, the
    others 21 to 33. A count of screens in a claim is now read as every screen (`f72a44f`).
11. **Not faster than the day before as a whole**, because it went through a second fix and a third look: to the
    end of the second look it was 172 minutes against 210. Plan and build were not touched and came out 13
    minutes faster, which is chance.
12. What the verifiers saw of the product outside the verdicts is in the specimen's contract (27 lines at the
    first look).

## The continuation: the first pass closed in 29 minutes, the native app stopped in its third look

A second session, the plugin at `f72a44f`, went on from the open first pass (02:54). It was stopped at 08:03 on
the owner's word (they had to leave with the Mac), six minutes into the native milestone's third look. What it
had started was ended by hand: five servers by their ids, four copies with `sz-eyes copy --end`, two stacks, two
simulators; nothing of it was left running.

| First pass, taken up again | Minutes |
|---|---|
| plan (continue) | 4 |
| the milestone started, and what the contract records of the earlier look read out | 1 |
| fix (`random`, `log`) | 8 |
| look after it (three: 9, 14, 15) | 15 |
| close | 0.4 |
| **session start to the first pass closed** | **29**: 18 proven, 0 shown false, 2 the owner's |

| Native app (`phone`, 7 claims in the plan) | 2026-11-17 | 2026-11-19 |
|---|---|---|
| plan | 10 | 13 |
| build | 182 (the builder wrote and drove its flows) | 54 |
| a stop that was none, and the session getting past it | | 5 |
| rulings on frozen checks the builder disputed | 75 (eleven, one after another) | 9 (three, one arbiter) |
| first look | 58 (one verifier, flows written) | 144 (two: 144 with the three simulator flows to write, 40) |
| fix 1, look after it | none: true at the first look | 9, 37 (one verifier) |
| fix 2, look after it | | 4, stopped 6 minutes in |
| close | 1 | not reached |
| **plan to the end** | **329**, closed | **280** to the stop, open |

At the stop the contract held a verdict for every claim: twelve parts proven, `keeps` shown false (mended by fix
2, not looked at again), `ios-fit` in its two parts not checked, `feel-phone` the owner's. Seventeen agents, 0.95
million output tokens, 1,274 tool calls.

## What the continuation shows

13. **A stopped milestone was taken up at the fix on a real run.** Whoever started the first pass returned what
    the contract recorded (16 proven, `random` and `log` shown false with what was found), and the fixer began
    five and a half minutes after the session did, with no look at twenty claims first. Closed at minute 29.
14. **The run stopped as "could not be built" over a milestone that stood.** The plan wrote claims of up to 829
    characters; `sz-eyes contract new` takes 400. The builder recorded each long claim in parts under ids of
    its own (`ios-path`, `ios-path-2`, `ios-path-3`), built, started the app, said `contract built`, and wrote
    how it had recorded them under "blocked", which the workflow reads as a stop. The session then copied the
    workflow's script, changed it (`session-patch.diff`: that note is no stop, and a part belongs where its
    claim does), and resumed the run from its journal. Its first resume started a ruling on the closed first
    pass, which it stopped after 47 seconds; the second went on at the arbiter. Five minutes in all, and
    everything from 04:35 ran on the session's copy, not on the plugin. Without it the run was over, an hour's
    build standing and nothing verified. Now the plan's schema holds a claim to 400 characters and a line of
    risk or of what is not done to 300 (the output tool refuses more and the planner cuts the claim in two:
    tried with one agent), and "blocked" says that what is written there stops the run.
15. **Three flows on a simulator were one verifier's share, and took 144 minutes.** They were weighed as three
    flows in a browser (3, 3 and 6 of a share of 10), so one verifier wrote the main path, the steps flow and the
    every-screen flow, 55 to 85 minutes each, partly at once on two simulators, while the other verifier was
    done in 40. Of its 144 minutes, 62 were waits on its own flow runs and 31 driving the simulator. Now a flow
    or look shown on a simulator weighs a whole share, so each has a verifier and a simulator of its own; this
    milestone's claims come out as four shares at a first look and two after a fix (by test).
16. **`ios-fit` was not checked after 85 minutes, and that is the eyes' gap.** To say whether text sits under the
    status bar or the home bar, and whether the same words stand in the same order as on the web, the verifier
    needed every visible text with its place. `sz-eyes ios` gives a picture; it wrote its own reader of
    screenshots and a measure on Maestro's tree, and five of the six fields were never typed into because its
    taps landed on the hint text. Not mended here.
17. **A fix cost a round because nobody ran the checks that read what it changed.** Fix 1 put a sign on a
    percent that two frozen flows of the first pass read without one; the next look took 37 minutes to say so.
    A fixer runs only the checks of the claims it was handed (since 2026-11-18, for speed: 74 minutes to 30).
    It is now told to search the flows and tests for the old form of what it changes on a screen or in an
    answer, and to run those that read it.
18. **One arbiter settled three disputes in 9 minutes** (eleven took 75 on 2026-11-17), and a builder that
    writes no flows built the native app in 54 minutes (182).
19. **The look after a fix on this milestone had one verifier** (37 minutes): its weight came to 19 against a
    share of 20. With finding 15's weights it is two.
20. **Every verifier that ended by itself ended its copies with `sz-eyes copy --end`** (six sessions, two to
    five copies each), and one of those copies was reported ended with its stack still up. Its verifier had run
    `git init` in it to try the commit stamp; the Supabase command line finds a folder's stack by the folder and
    its git branch together, so the stop run from the folder said "No managed stack found for this context",
    exited 0, and the folder was removed. The stack ran three hours more, until the stop. Reproduced on a copy
    of this product (the same answer, the stack's host still up), and mended: a copy's stacks are now found by
    what the command line keeps of them for that folder and stopped each by its id; the same reproduction then
    ends with no host and no container.

21. **The plan packed a native app and twenty-eight mends into seven claims.** The work skill sizes a milestone
    after the first pass as "an M of 3 to 7 claims", and the plan's own instruction puts what the verifiers
    noticed into the first milestone planned; told that the native app came next, the planner made one milestone
    of both and wrote claims of ten promises each. That is where the 829 characters came from. Not changed: with
    a claim held to 400 characters the same plan has to be two milestones, or more claims. The next run shows
    which.

## The finishing run: the same milestone taken up at the fix, and a Mac with more up than it holds

On 2026-11-21 a third session (the plugin at `4875185`: finding 14, 15 and 17 mended, a copy ended by its
stacks' ids) took the native milestone up where the contract had it: every claim with a verdict, `keeps` shown
false and mended since, `ios-fit` not checked. I stopped it at 10:50, eighteen seconds into its third look, to go
on with the plugin mended again (finding 23).

| Stage | Minutes |
|---|---|
| plan (continue) | 6 |
| the milestone started, what the contract records read out | 4 |
| rulings on four checks the plan listed as disputed | 10 |
| fix 1 (`keeps`: already mended, checked) | 4 |
| look after it (three: 71, 78, 91) | 91 |
| fix 2 (`ios-fit`, `mends-play-2`, and `first-pass/weigh` broken) | 38, of which 20 waiting on its own builds and flows |
| third look | stopped at its start |

22. **A second milestone was taken up at the fix**: the fixer began twenty minutes after the session did, and
    ten of those were finding 24.
23. **Three verifiers with a simulator each were more than the Mac holds.** With finding 15's weights the look
    after a fix went to three verifiers. They took four simulators between them (one took a second, for its
    second flow) and started nine stacks: 3.8 GB a simulator and 0.57 GB a stack, measured while they ran, on 24 GB
    and ten cores. The swap was full (13.6 of 14.3 GB), the load average 280, `sz-eyes ios spare` took three to
    five minutes, and the look took 91 minutes where one verifier had taken 37 two days before. Finding 15's
    change was wrong as it stood: it counted what a flow costs and not what the machine holds. Now
    `sz-eyes ios room` says how many simulators the Mac holds at once (two here), `sz-eyes ios spare` boots no
    more than that, whoever plans reads the number, simulator work goes to no more verifiers than that, and a
    flow that is already written weighs what its run costs (`0dd9689`).
24. **An arbiter ruled again on four checks that had been corrected**, ten minutes to find each of them right:
    the plan listed, as disputes of the built milestone, checks the contract already recorded as corrected.
    Now only what nobody has corrected since is listed (`24eca21`).
25. **One flow's two claims went to two verifiers** (`ios-fit` to the second, `ios-fit-2` to the third): the
    shares were cut between claims, not between checks. Now claims shown by one check are one verifier's
    (`b7ed1a9`).
26. **The fixer searched the checks of earlier work for what it changed before it committed** (finding 17's
    rule, on a real run): "Only fit.sh's back-tp02 closes TP-02 … No words or figures on screen changed."
27. **`ios-fit` got its verdict**, shown false: on the phone the card opened from the search screen closes to
    the card book, not back to the search. The verifier reached all 24 screens and used the measure and the
    reader of pictures its predecessor had left in the project.
28. **Two faults nobody had seen came out under the load**: a sheet that never shows when the answer it waits
    for comes back within 0.4 seconds of its screen opening (the end of a closing animation hid it), which also
    broke a flow of the first pass. Both were real and were mended at the cause.

## The second finishing run: the native milestone closed

The same morning, on the plugin as mended again (`24eca21`), a fourth session took the milestone up at the fix
once more and closed it at 13:09: 13 proven, none shown false, `feel-phone` the owner's, and the eighteen claims
of the first pass still true.

| Stage | Minutes |
|---|---|
| plan (continue; it read `sz-eyes ios room`: 2) | 13 |
| the milestone started, what the contract records read out | 3 |
| rulings on two checks the looks of that morning had found wrong | 29 |
| fix 1 (three claims a commit had mended already; their checks run again) | 27 |
| look after it (one verifier, two simulators) | 65 |
| close | 1 |
| **session start to the milestone closed** | **139** |

29. **Within what the Mac holds, the look ran with nothing else slowed.** One verifier, as a written flow now
    weighs its run; it took two simulators, the number `sz-eyes ios room` gave it, asked the room four times,
    and the load stayed ordinary. 65 minutes, with one claim (`ios-fit`) and three mends more to show than the
    look of two days before that took 37. Nothing was left running: its copies were ended with
    `sz-eyes copy --end`.
30. **Rewording a line of `sz-eyes ios look` broke two frozen flows.** They read its list of words by the
    line's head; the verifier put a script of its own in front of the eyes to get them through, and said so. The
    list of words and of ids is as it was again, and what the look adds is on lines of its own (`5652f10`).
    What the eyes print is read by checks that are frozen: its shape is not free to change.
31. **A fixer ran the checks of claims that were mended already**: 21 of its 27 minutes, and the look after it
    ran them again. On a milestone taken up again it is now told to name the commit and leave the checks to
    whoever looks (`c0027fc`).
32. **The arbiter committed what it corrected** (four commits), and corrected the same fault in two more checks
    than it was handed: the toast that is gone before a slow step ends.
33. **A verifier's notice could not be recorded**: the contract took thirty, and after three looks it had them.
    The limit is lifted.
34. **Left for the owner on this specimen**: `feel-phone`, `kakao-once`, `feel`; and what the verifiers noticed
    is in its backlog (fields under the keyboard on two screens of the phone among them).

## What was changed after it (`held-clock`, after `f72a44f`)

| Commit | What |
|---|---|
| `0a810cc` | A copy's stacks are found by the command line's own records and stopped each by its id (finding 20) |
| `b0e6a7d` | A plan's claims fit the contract; "blocked" says it stops the run; a flow on a simulator is a verifier's whole share; a fixer searches earlier checks for what it changes (14, 15, 17) |
| `4875185` | An arbiter commits the check it corrects: three corrected flows had stayed uncommitted while every verifier's copy is made from what is committed |
| `fb7bdb0` | `sz-eyes ios look` gives places, fields, the keyboard, and what shows under the status bar or in the home bar's band, measured on the words read in a picture (16) |
| `b7ed1a9` | A builder of a simulator milestone gives fields ids; claims shown by one check are one verifier's; a session reports a stop and does not change the workflow (14, 16, 25) |
| `0dd9689` | Simulators are booted, and simulator work shared, within what the Mac holds; a written flow costs its run (23) |
| `24eca21` | A check that was corrected is not handed to an arbiter again (24) |
| `5652f10` | The look's list of words and ids keeps the shape that flows already written read (30) |
| `c0027fc` | A fixer on a milestone taken up again does not rerun the checks of what is already mended (31) |

Why the bands are measured on a picture: on the 23 screens whose trees that verifier kept, the tree put app
parts in the home bar's band on six, and the words its reader found in the pictures of those screens had none
there. On the
one whose picture was looked at for this record (BT-03) the parts are rows of a list behind a fixed bar at the
foot. Nothing in the tree tells such a part from one a person sees: no container that scrolls was marked as one.
