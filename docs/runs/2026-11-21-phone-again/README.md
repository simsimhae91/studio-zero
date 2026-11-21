# 2026-11-21: from the closed first pass to the native app, once more

The native milestone of the diet battle built again from a copy of the closed first pass
(`~/.studio-zero/specimens/2026-11-19/diet-c` at `2226f9a`, copied to `~/.studio-zero/specimens/2026-11-21/diet-d`),
with the plugin as it stood on `main` at `ee1f29b` (a frozen copy): everything the three runs before had changed,
among it stopped milestones that resume at the fix, simulators within what the Mac holds (`sz-eyes ios room`),
`sz-eyes ios look` measuring the screen, and a plan whose claims fit the contract. One headless session on
Opus 5.5, session effort xhigh, nobody at the Mac. The same request as `native-request.txt` of 2026-11-17.

One run: read the figures as showing where the minutes are, not minutes to trust.

## What is here

| File | What it is |
|---|---|
| `phone-request.txt`, `run-phone.sh` | What the headless session was asked, in the owner's place, and how it was started |
| `clock.txt` | When it started and ended |
| `journals/phone.jsonl` | The workflow's own journal |
| `timelines.txt` | Per agent: model, effort, wall-clock, tokens; model minutes against command minutes; the slowest commands |

## The run: 337 minutes, closed

| Stage | 2026-11-17 | 2026-11-19 and 21 (stopped twice, three sessions) | 2026-11-21 (this run) |
|---|---|---|---|
| plan | 10 | 13, then 6 and 13 | 7 |
| build | 182 | 54 | 129 |
| rulings | 75 | 9, 10, 29 | none: no dispute |
| first look | 58 | 144 (two verifiers) | 74 (three: 39, 58, 74) |
| fix 1 | | 9 | 25 |
| second look | | 37 | 38 (three: 35, 23, 38) |
| fix 2 | | 4 | 17 |
| third look | | stopped; later 91 and 65 | 45 (three: 33, 37, 45) |
| close | | 1 | 1 |
| **request to the end** | **329**, closed | 280 to a stop, then 155 and 139 | **337**, closed |

Verdicts (7 claims): first look 5 proven, 1 false (`ios-fit`), 1 the owner's. Second look: `ios-fit` proven,
`keeps` false. Third look: 6 proven, 0 false, 1 the owner's (`feel-phone`). Of what stood before, 18 held at the
first look and 3 were shown again at the last; none broken at the end.

Fourteen agents. The session's own count of what it cost at list prices: 92.76 dollars.

**It was not faster than the first time.** What the earlier changes bought is in the shape: no ruling (75
minutes the first time, 48 across the second), a first look half as long as the second run's, and a close with
nothing false. What it lost again is in two places: the build, and three looks that each wait on flows.

## What it shows

1. **A builder filled the disk through `sz-eyes ios flow`, and the owner's containers went down with it.** The
   builder kept its trial flows in `.cache/m` and gave `--out .cache/m/out-<name>`. The command copies the flow's
   folder into `<out>/flows`, and so each run copied every earlier run's copy and its own: about 18GB in an hour.
   At 14:45 the disk had 145MB free; OrbStack stopped, and with it the project's stack and the owner's seven
   standing containers, until the builder deleted the copies and ran `orb start` at 15:03. The builder said so in
   what it returned, and wrote a warning into the product's map. **Changed:** every folder a run writes carries a
   mark, and the copy passes a marked folder over (`dd2e075`).
2. **The build took 129 minutes (54 two days before, from the same closed first pass).** The model's own time was 30. The
   rest: 47 driving the simulator, 30 waiting (12 of them for the disk, 10 for the web flows and an Android build), 10 building for iOS. About 20 minutes went on getting step counts into Apple's Health app by
   Maestro, one try at a time, each try paying Maestro's start again (finding 6).
3. **No dispute, so no arbiter.** The plan wrote seven claims of at most 400 characters, each shown by one check,
   and returned `simulators: 2`. The builder returned no dispute. (Rulings took 75 minutes on 2026-11-17 and 48
   across the sessions of 2026-11-19 and 21.)
4. **The measured look found what a person would have found on a phone.** `ios-fit` was refuted on two real
   faults: the phone's tab bar was 94% white with no blur, so the steps card's figure showed through it in the
   home bar's band; and the invite code field had opacity 0, which keeps it out of the screen's tree, so neither
   a flow nor VoiceOver could find it. Both were mended in one round.
5. **A stop that came once in five runs was written down as noticed, and cost an hour.** At the first look the
   verifier of `keeps` ran the frozen weigh flow five times; once the second save of a day did nothing. It put
   that under what it noticed and called the claim proven. At the second look another verifier found the cause (a
   409 that arrives less than 0.4 seconds after the sheet's screen opens is swallowed by the sheet's opening
   animation: 1 of 16 walks) and called `keeps` false. Fix 2 and the third look, 62 minutes, followed from a
   fault that was in front of the first look. **Changed:** the verifier's rule now says a check that stops one
   time in several has not passed, and whose fault it is must be found before the verdict.
6. **Every look at a simulator's screen starts Maestro anew, and that is where the looks' minutes are.**
   Measured on this Mac when it was quiet: `maestro hierarchy` 8.0 seconds, a flow of two steps 11.5, whichever
   port and with or without reinstalling the driver; the screenshot 0.2 and the reading of the picture 0.5. The
   every-screen fit check calls a look or a flow about fifty times: one run of it at the third look took 26
   minutes 31 seconds and 810 seconds of processor time, beside another simulator. It ran at least six times in
   this run (the builder, the first look, the fixer twice, the second look, the third look), and the share that
   held it was the slowest of the first two looks. Across all agents, 235 agent-minutes were waits for a flow to
   end and 98 were commands driving a simulator, against 133 of model time.
7. **Most stops that were not the product's were Maestro starting its driver.** Across the run: 31 times the
   driver's port refused or its status check failed, 8 times "Application ... is not running" right after a
   launch. The frozen path flow stopped in 3 of 4 runs at `stopApp` followed by `launchApp` (the app was up and
   showing home 0.04 to 0.4 seconds after the launch when the driver asked for it). The last verifier wrote:
   "Anyone checking again should expect to run each flow more than once."
8. **A fixer runs the check it was handed, and the look runs it again.** Fix 1 changed two things for `ios-fit`
   and waited 18.5 of its 24.7 minutes for two runs of the fit check; the second look then ran it again for 26.
   The fixer's run is what lets it say the fix holds, and the look's is the verdict: both are wanted, and what
   makes it dear is finding 6.
9. **A milestone's evidence took 2.5GB, and its repository 2.1GB.** Three looks each took the pictures and films
   again (films of 30 to 50MB each), and each was committed. With the build's output (7.1GB), installed
   dependencies (1.9GB) and the Android build (0.9GB), the specimen held 16GB. The Mac's disk is 460GB with 6.7GB
   free when the run ended; nothing in the harness looks at how much room there is before a build.
10. **What a run leaves that is not running:** 107 folders of stack records under `~/.supabase/stacks` (each a
   stopped stack of a copy that no longer exists; no volume is left), and ten spare simulators of the harness,
   shut down and wiped, 17MB each.

## Measured afterwards: holding one driver up

Maestro's long-lived server (`maestro mcp`) answers a screen in 0.16 seconds and a two-step flow in 3.3, but it
serves every simulator through one driver port: asked for the second simulator's screen, it returned the first's.
It cannot be used where two verifiers each have a simulator.

Holding the driver up with the command line itself can: one flow that waits in a single request keeps its driver
on a port of that simulator's own. While it waits, the driver answers a screen's tree in 0.12 seconds when asked
directly, a flow started on the same port takes 8.6 seconds (11.5 without), and `maestro hierarchy` 5.0 (8.0
without). Released, it leaves nothing running. Two simulators keep two drivers and do not mix.

## What was changed because of it

On the branch `phone-again`:

- `dd2e075`: a flow's run is never copied into the next run (finding 1).
- The verifier's rule on a check that stops one time in several (finding 5).
- The held driver for `sz-eyes ios look` and `ios flow` (findings 6 and 7): the first of them on a simulator
  starts a holder (`packages/eyes/src/ios-hold.ts`), a look then reads the tree from the driver and makes of it
  what `maestro hierarchy` prints, by Maestro's own two rules (`ios-driver.ts`; the holder checks once, on the
  live screen, that the two agree), and a flow runs on the held port. `sz-eyes ios rest` lets the driver go; the
  holder also goes by itself when the simulator is down, when nothing has asked for twenty minutes, or when its
  driver has gone.

  Measured on two simulators at once, ten looks and three flows on each, the same loop both ways:

  | | wall-clock | commands that failed |
  |---|---|---|
  | a driver started for every command (as it was) | 264 seconds | 4 of 26: "iOS driver not ready in time" after 125 seconds, a launch that failed twice, a screen that could not be read |
  | the driver held | 41 seconds | 0 of 26 |

  A look: 8.4 to 10 seconds before, 1.0 to 1.2 held; the first on a simulator 12 to 13, which starts the holder
  and makes the check. The same look printed the same thing both ways.

  Seen while measuring: after every `maestro` command that started a driver, the `xcodebuild` it had started
  stayed for about a minute and ran `simctl diagnose`, because its test runner had been ended. Fifty commands a
  check left a standing crowd of those, which is where the 810 seconds of processor time of one fit check went.
  A held driver is ended once, when it is let go.

Not changed, and why:

- **Room on the disk before a build** (finding 9): the fault that filled it is mended at its root. A check of
  free room would have told this builder what it found out by itself twelve minutes later; it belongs with the
  plan's question to the machine (`sz-eyes ios room`) if a second run shows it missed.
- **Evidence taken again at every look** (finding 9): each look's pictures are what its verdicts point at. Films
  are the weight; whether a look after a fix needs films at all is a question for a run that has room to try.
- **The old stack records** (finding 10): they are the Supabase command line's own; removing them is the owner's
  call, and they hold credentials of stacks that no longer exist.
