# 2026-11-22: room on the disk, what evidence is kept, and the relaunch that used to stop a flow

The owner brought a proposal written from the run records of the two days before: a disk check and a clean-up of
films in the workflow's script, and retries around the held driver for a flow that stops right after starting the
app again. Read against the code and the measurements, one of its four points stood as it was meant and none as it
was written. What was done instead is here, with what each was measured on.

| The proposal | What is so | What was done |
|---|---|---|
| The script checks `df` before a build: under 3 GB stop, under 10 GB warn | A workflow script runs no command and reads no file; and a build for a phone has taken 16 GB, so one started at 5 GB passes that check and fills the disk | `sz-eyes room`, asked by whoever plans and again at each close; the script judges each milestone by what such a milestone has taken |
| The script deletes the `.mp4` files of a closed milestone | The web specimen it cites (911 MB a milestone) holds no film at all: 10,314 pictures. The phone specimen's 27 films were committed before any close, so removing the files frees nothing in the repository; and a closed milestone can still hold a claim the owner has not judged, with its film | `sz-eyes evidence prune`: at close, before the commit, what no verdict, notice or record names is removed, whatever kind of file it is; a film is kept out of git from the moment it is written |
| A flow should reuse the held driver and restart it only when it has died | It does, since `da0c820` (`heldFor` in `packages/eyes/src/ios.ts`) | Nothing |
| Retries in `heldTree` and `lookAt` for "Application is not running" after `launchApp`; the fit check still takes 26 minutes | The 26 minutes and the 235 minutes of waiting are from the run before the held driver (after it: 980 seconds to 596). The words "is not running" are Maestro's own, said inside a flow; nothing in `sz-eyes` reads the screen at that moment. And the flow that stopped had not been run again since the driver is held | Measured first (below) |

The positions of the two run records before this one ("room on the disk before a build" and "evidence taken again
at every look", both left unchanged) are taken back: three runs on a web product took the disk from 14 GB free to
7.9 overnight, and the next build for a phone would not have fitted.

## Room on the disk

`sz-eyes room` prints the whole gigabytes free on the disk the project is on, the number alone on its first line.
The plan returns it with what it already asks of the machine (`sz-eyes sandbox`, `sz-eyes ios room`), and whoever
closes a milestone returns it again, so that the next milestone is judged by what is left then.

| A milestone | has taken | measured on |
|---|---|---|
| that builds an app for a phone | about 16 GB | 2026-11-21: what the build wrote 7.1, installed dependencies 1.9, an Android build 0.9, evidence 2.5, its repository 2.1 |
| that does not | about 3 GB | 2026-11-22: 6 GB over two milestones of a web product and a fix |
| an earlier run built, to be started and looked at | about 1 GB | its evidence |

With less than that free, nothing of the milestone is started and the run stops saying both figures and how room
is made. With less than twice that, it is started, the log says so, and whoever builds is told to ask the disk
again before a step that writes gigabytes and to stop under "blocked" if it would not fit. When nobody returned a
figure, nothing is judged by it.

## What a closed milestone keeps

Every look takes its pictures again, each look after a fix under a folder of its own choosing, and all of it was
committed at the close. `sz-eyes evidence prune <contract>` keeps the page, every file a claim or a notice lists
as its evidence, and every file that anything written about the work names: its own path, a folder above it
written as a folder, or its own name standing alone, in any contract, the standing record, the backlog, the
progress file, the spec or the map. The rest goes. A contract that is open, or has a claim shown false, keeps
everything: that is what the fix is worked from. The close of a milestone runs it once the contract has closed and
before anything is committed.

Run without removing anything (`--dry-run`) on the two specimens of these days:

| Milestone | Evidence | Would go | Would stay |
|---|---|---|---|
| 퇴사점검 `first-pass` (web) | 885 MB, 4,699 files | 704 MB (80%) | 729 files |
| 퇴사점검 `mend` (web, five looks) | 1,311 MB, 7,749 files | 1,232 MB (94%) | 455 files |
| 감량배틀 `first-pass` (web) | 774 MB, 6,527 files | 496 MB (64%) | 2,082 files |
| 감량배틀 `native` (phone) | 1,723 MB, 7,710 files | 872 MB (51%), 416 MB of it films | 2,969 files, 577 MB of them films a claim names |

What would go is the step-by-step pictures of flows nobody points at and the folders of looks before the last.
Everything set before the owner for a judgement would stay (the 27 pairs of drawing and built screen, the three
pairs of the changed main screen, the pictures of the arbiter's ruling): checked by name on the dry run.

Two rules decide how much goes. A path that goes on into a file names that file, not the folders above it:
otherwise one picture of the last look would keep its whole folder. And a folder of one name is a word like any
other ("keeps", "path", "steps": a claim's id is often its folder): it counts only where it is written as a folder,
with the stroke after it. The second was found by the dry run itself and mended before anything was wired in: the
first dry run took such words for folders and kept 968 MB across the four milestones that the second removed.

A film is 30 to 50 MB. `sz-eyes ios flow --video` now writes a `.gitignore` for `*.mp4` into the folder it writes
the film into; the strip of eight frames it makes beside the film (`<name>-film.png`) is what git keeps and what a
claim's evidence names.

## The relaunch that used to stop a flow

On 2026-11-21, before a simulator's driver was held up, the diet battle's path flow stopped in 3 runs of 4 where
it ends the app and starts it again (`stopApp`, `launchApp`), and eight such stops were counted across the run.
That flow had not been run since. Measured now with the same app (the Release build of the specimen at its last
commit, built on the external disk), on the eyes' own simulators, through `sz-eyes ios flow` with the driver held
(the scripts and their logs are under `race/`):

| | Flows | Times the app was started | Stopped as "not running" | A flow took |
|---|---|---|---|---|
| one simulator, a flow that starts the app and reads its first screen | 10 | 10 | 0 | 8 to 12 s (the first 56: it starts the holder) |
| one simulator, a flow that starts the app, ends it and starts it again, twice | 10 | 30 | 0 | 14 to 15 s |
| two simulators at once, that flow on each, a look between flows | 20 | 60 | 1 | 15 to 20 s |

So: gone on one simulator in these runs, and still there with two at once, about once in sixty flows (one more
measurement of 40 flows on two simulators, below, met none).

The one stop, read in Maestro's own log (`race/two-the-stop-maestro.log`): Maestro started the app with `xcrun
simctl launch`, called the launch completed 0.26 seconds later, asked the driver for the screen 0.09 seconds after
that, the driver answered `500 … "Application kr.studiozero.gamryangbattle is not running"`, and Maestro ended the
flow with "App crashed or stopped while executing flow". No crash report was written, and the app was running. Maestro starts an app without waiting for it to be up; an app that answers a little late is
taken for one that crashed. With a driver started for every command the machine was kept busy by what each command
left behind (an `xcodebuild` running `simctl diagnose` for a minute), which is the likely reason it came three
times in four then and once in twenty now: likely, not shown.

Where the proposal put its retries (`heldTree`, `lookAt`) nothing asks at that moment: the question is Maestro's,
inside the flow. So it is handled where a flow is run. When a run ends with those words, `sz-eyes ios flow` asks
the simulator whether the app is running (`simctl spawn … launchctl list`, for two seconds). If it is not, the stop
is real and nothing changes: an app that stopped is the product's. If it is, the stop was Maestro's:

- a flow that had only started, stopped and read (no press, no typing) is run again from its start, and the
  result says "run twice" with the step the first run stopped at;
- a flow that had pressed or typed is not run again by the tool, which cannot put the product back where the flow
  starts: it says "not the product's" and exits 4, so that the script around it does that and runs it again.

Nothing is hidden either way: a verifier's rule is that a check which stops one time in several has not passed
until whose stop it was is known, and this says whose in a line.

Measured with that change, on two simulators at once:

| | Flows | First runs stopped so | What the tool did |
|---|---|---|---|
| as before (a flow took 19 s on average) | 40 | 0 | nothing to do |
| with ten idle loops keeping the processor busy (31 and 38 s a flow) | 30 | 5, all on one of the two simulators | each was told apart from a crash (the app was running); all five had only started, stopped and read, and were run again: 2 passed, 3 stopped the same way again |

The second row is not a condition a run meets: it was made to see the tool act on a live stop, and it showed a gap.
A second run that stopped was reported as "not the product's" without anyone having asked whether it stopped the
same way or for a reason of its own. Now it is asked: the same way again is still not the product's (exit 4, "the
machine is too busy for the app to start before Maestro asks"); a reason of its own is a stop like any other.

Seen while measuring, and changed: Maestro makes a new folder under `~/.maestro/tests` for every run of a flow and
never removes one. On this machine there were 2,470, 735 MB, since 2026-11-08. `sz-eyes ios flow` now has Maestro
keep that in the run's own folder (`<out>/maestro/`: its log, the steps as it read them, a picture of the screen
where it stopped), where it is evidence like the rest and goes with what nothing names when the milestone closes.
The 2,470 that are there were left: some are the owner's own.

Not measured: the path flow itself from sign-in to the relaunch (it needs the providers' sign-in pages and a
person and a battle made ready before each run). What was run is its relaunch, with the same app, the same way.

## Tests

`packages/eyes/test/prune.test.ts` (what stays and what goes, an open or refuted contract kept whole, the room in
whole gigabytes, films out of git), a test in `build-workflow.test.ts` (nothing started on a disk too small, the
builder told on a tight one, the disk asked again at each close, the close pruning before it commits), and one in
`ios-hold.test.ts` (a stop asked too early told apart from a real one, run again only after reads, a second stop
of the same kind and one of its own, Maestro's debug output in the run's folder). Whole suite: 621 tests, 599 pass, 0 fail, 22 skipped.
