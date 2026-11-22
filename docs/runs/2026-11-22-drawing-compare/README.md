# 2026-11-22: a builder's look beside the drawing, measured, and why the as-drawn claim never held

The owner had a proposal of seven changes for Claude Fable 5.2 checked, and said to go on with what the check
proposed instead (`docs/decisions/2026-11-22-fable-52.md`). One part of that was to measure a single change before
taking it: a builder that sets its screens beside the drawing once before it returns. This is that measurement,
what it showed about the change, and what it showed that nobody had asked.

One run each way. Read the figures as showing direction and cost, not as rates.

## What was run

The first pass of 퇴사점검 was built again from the commit it started from on 2026-11-22 00:03 (`06e90ad`: the
prototype the owner said yes to, the plan of its screens, the request), in two copies on the external disk, one
after the other, each by one headless session on Opus 5.5 at session effort xhigh with nobody at the Mac, as the
first run was. The request is `request.txt`, written in the starter's own voice; the copies held no later history.

| | First run | Control | Compared |
|---|---|---|---|
| Plugin | `main` at `6580274` | branch `phone-again` at `c7d5da1` | the same with the builder's look (`b7a5a0b`) |
| Started | 00:03 | 18:09 | 13:03 |
| Plan | 11.1 min | 14.7 | 9.8 |
| Build | 55.0 (model 33.4, commands 21.6) | 58.0 (41.4, 16.6) | 70.5 (38.3, 32.3) |
| The builder's output tokens | 221,543 | 273,829 | 256,261 |
| First look, the slowest of five verifiers | 32 | 58.1 | 64.2 |
| Verdicts at the first look, 20 claims | 16 proven, 3 false, 1 the owner's | 10, 9, 1 | 7, 12, 1 |
| After it | closed at 193 min | stopped by its starter when the first look ended (133 min) | two fixes, three looks, two rulings; left open at 304 min |

The control was stopped after its first look because the question is about what a builder hands over and what the
first look finds; the rest of a run is spent on other claims. The first run was made before the verifier's rule
that a claim it broke is refuted (`8ce2372`), which is why it shows 3 claims false where the two of today show 9
and 12: it is a second sample of a builder without the change, not of the harness as it stands.

Scripts: `run-arm-a.sh`, `run-arm-b.sh`, `watch-arm.sh` (keeps a copy of the evidence when the builder returns and
when the first look ends, because later looks write over it), `stop-after-look.sh`. Per run: `journal.jsonl`,
`timelines.txt`, `returns.md` (what every agent returned), `clock.txt`.

## How close each build was to the drawing

**By one comparison of words, the same for all three.** Each build was started again as its builder left it, walked
to every drawn state by the steps its own verifier had recorded, and the lines of words a look reads off each
screen were matched in order against the drawing's (`tools/replay.py`, `tools/compare_words.py`; the method is the
first run's verifier's, and reproduces its recorded figures on 24 of 27 screens). 27 states are in all three.

| | First run | Control | Compared |
|---|---|---|---|
| Of the drawing's 916 lines, on the built screens in order | 727 (79%) | 688 (75%) | 752 (82%) |
| Lines on the built screens that the drawing does not have | 245 | 220 | 139 |
| Screens with nine lines in ten the same | 5 | 6 | 13 |
| Screens the same word for word | 1 | 2 | 4 |

The compared build is closer than both others on 14 of the 27 screens and further than both on 4. Three of those
four show dates: that build has no way to be told what day it is, and its verifier left dates out of its
judgement. The count includes the drawing's closed sheets on all three alike, so the percentages are low for all;
it is the differences between the columns that say something. The two builds without the change are four points
apart, and the compared one is three above the better of them.

**By what a verifier found that no claim requires.** One verifier was run on each of today's two builds as built,
under the changed instruction described below, which has it tell a difference another claim requires from one
that none does (`claim-test/`).

| | Control | Compared |
|---|---|---|
| Screens with a difference no claim requires | 19 of 27 | 10 of 27 (11 of 28: its verifier opened one state more) |
| Differences another claim requires, listed with the claim | 9 groups | 14 rows |
| The verifier took | 27.6 min, 8.21 dollars | 36.1 min, 7.21 dollars |

In the control: results in another order than drawn with two sections nobody drew, a letter's recipient and
sender as dotted fields with a contact field added, a sixth step and three buttons on the list of next steps,
calendar icons and notes added, number fields laid out another way. In the compared build, apart from one state
drawn at its limits: a button and a sixth step on the next steps after sending, a tag's wording, a calendar icon,
a box's height. (`claim-test/a-differences.md`, `claim-test/b-differences.md`.)

**What the look cost and did.** The builder of the compared run began it 55 minutes into its build (14:09) and
returned at 14:25. It read the pictures of its screens against the drawing, made half a dozen mends (a unit inside
its number field, the order of results, a field of the commute case, the colours of the overdue state, a link's
press area, the cap of a gauge), took every picture again, and returned twelve places it had left unlike with the
claim it held to require each (`b-compared/builder-return.txt`). The verifier of the test agreed with nine of the
twelve and found three that no claim requires. The build took 12 to 16 minutes longer than the two without it;
its output tokens were between theirs.

The builder of the control, told nothing, had also put a picture of each screen beside its drawing, and named
three differences in what it returned. Looking was not what made the difference: writing every difference down
and mending each was.

**Taken.** The change is merged (`3f55ced`). It buys a first pass that stands closer to what the owner said yes to,
from the moment they can open it, for 12 to 16 minutes of a build. It does not shorten a run: see the next
section for why the claim was shown false in all three anyway.

## What nobody asked: the claim could not be true, in any of the three

The plan of each run worded the claim alike: every screen is built as drawn, and only these two things differ.
In each run other claims of the same contract required what the drawing does not have: the statutory form's own
title and receipt table, a source's figure, a control a claim names. So:

| | First run | Control | Compared |
|---|---|---|---|
| At the first look | false | false | false |
| The fixer | mended some, said the rest cannot be | (stopped) | mended two, said the rest cannot be |
| A ruling | 12 min: set aside for the owner | | 13.6 min: set aside for the owner; 5.9 min more after the last look |
| What no claim required and was still unlike at the end | not counted then | | ten places, listed by the last ruling "for the owner" |

Once set aside, the claim is nobody's work: what a claim required and what none did went to the owner together,
and the second kind was never mended. That is the fault, and the builder's look does not touch it.

**Changed** (`50c6f03`): the plan words the claim with its exception ("except where another claim of this contract
requires otherwise"), and whoever verifies it reads the other claims for every difference: what one of them
requires stands and is written, with the claim, into a file that is the claim's evidence, for the owner who said
yes to the drawing; what none requires is the claim shown false, every place named, and is mended like anything
else shown false.

**Tried** on both of today's builds as built, the claim reworded by hand as the plan now would
(`claim-test/prompt-*.txt` are the prompts the runs gave the claim's verifier, with the one instruction changed).
Both verifiers did it: the claim's own exceptions, what other claims require with each claim named (the wage rule
and the source's sentence, the form's PDF read again that day, the limits a field must hold), what no claim
requires as a numbered list, and what was left out of the comparison and why. Both recorded the claim false with
that file as its evidence.

Not shown: a fixer working from such a list and the look after it, and a planner wording the claim so (a test of
the prompt only).

## The first whole first pass under the verifier's rule did not close

The compared run is also the first first pass run to its end since the rule that a claim a verifier broke is
refuted. (`b-compared/returns.md` has every verdict in full.)

| Stage | Minutes | What it returned |
|---|---|---|
| plan | 9.8 | 20 claims |
| build | 70.5 | all 18 screens; 12 places left unlike the drawing, each with a claim |
| first look (five: 38, 44, 49, 57, 64) | 64.2 | 7 proven, 12 false, 1 the owner's |
| fix 1 | 56.8 | eleven mended, `as-drawn` cannot be |
| ruling | 13.6 | `as-drawn` set aside for the owner |
| second look (three) | 29.3 | 6 false: four by a case nobody had tried before, one flow that the first fix broke, one picture |
| fix 2 | 28.3 | the six handed to it, by its own account |
| third look (three) | 21.1 | 4 false |
| ruling, close | 5.9, 0.9 | the product is wrong; the contract stays open |
| **request to the end** | **304** | 14 proven, 4 false, 1 set aside, 1 the owner's; 114.99 dollars at list prices |

Eighteen agents, 1.40 million output tokens, 1,488 tool calls. The control used 0.81 million to the end of its
first look.

What stayed false, and it is false: the wage-arrears rule answers "요건에 맞아 보여요" for months that are not
in a row (`s1-wage`, `rules`), the correction letter asks for the code the company already filed (`statements`),
one picture hides the line that makes its state (`pictures`). The first run had closed in 193 minutes with 18
proven; its answers included the same kind of fault, recorded then as things noticed. The harness now says so
and stops with the contract open: that is the rule working. It cost 111 minutes more.

Why the wage rule did not converge in two fixes: the builder's own test of the rule, frozen with the contract,
asks for an answer the source the screen cites refuses (two months of partial arrears that are not in a row).
Each fixer may not touch a frozen test, kept it passing, and said so in a line of what it returned; each look
then found the product wrong by the source in another case; the last ruling found the product wrong. Nobody
ruled on the test. A fixer has no place to say "this frozen check asks for what the claim's source refuses":
the builder has one ("disputes"), the fixer only "cannot be made true", which it did not use because it could
make the check pass. **Not changed.** The mend is a line in the fixer's instructions and a ruling that follows
it, and it needs a run to be tried; it is the next thing I would do to the workflow.

Also seen: the two planners differed. The control's took the wage rule from its source and recounted the
drawing's example to 63 days; the compared run's kept the drawing's 77. Both products were then shown wrong
about the rule in other cases.

## What ran in a whole run for the first time

- The close at low effort with the finishing text (`038cbbe`): all its steps, 0.9 minutes, the disk's room
  returned. Nothing to compare it with: no closer had left a step out before either.
- The disk was asked at the plan and at the close (1,763 GB on the external disk: the gate had nothing to do).
- Evidence was not pruned: the contract did not close, and an open contract keeps everything (839 MB).
- The audit's corrections (`ed9867b`): no fault traced to them in either run.

## Not shown

- Any of this with a builder on Claude Fable 5.2. Every run here is Opus 5.5.
- The spread between two runs of the same harness is known from one pair only (79 and 75 on the word
  comparison); the change's 82 is one run.
- A product whose screens are not web pages: on a phone the builder's look would be taken on a simulator.

## Left on the machine

`/Volumes/DEV-SSD/sz-scratch.noindex/drawing-compare/` (3.2 GB): the two copies (`arm-a` stopped after its first
look, `arm-b` as its run left it, contract open), the evidence kept at the builder's return and at the end of
each first look (`snap-a`, `snap-b`), the looks the word comparison was made from, the two copies of the
one-verifier test, and the session records of the four headless sessions (`sessions.tar.gz`). The owner may
delete the folder; everything this record cites is copied here. Nothing of it is running.

One thing was left running and found two hours later. The control's session had made a copy of the product for
the owner when its builder returned and started it (the work skill says to: the owner looks while the run
verifies). Ending the run by its process tree does not end that copy's server, which is started apart from it.
It was ended by its ids and the copy removed with `sz-eyes copy <folder> --end`. Whoever stops a run from
outside has to look for its show copy; a run that ends by itself takes its own away.
