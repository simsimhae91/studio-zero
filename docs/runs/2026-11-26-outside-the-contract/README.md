# 2026-11-26: the changes of that day, tried on the run they came from

A run on the owner's project `worktape` stopped that morning after 138 minutes with one claim of seven
(`split-tail`) shown false and its milestone `day-true` open. The changes made from it (`cbe72eb` to `876ee9e`; the
decision record is `docs/decisions/2026-11-26-outside-the-contract.md`) were tried twice on clones of that project
as the run left it. The owner's own folder was only read. Every figure here is from one run.

Both trials: Claude Code 2.1.332, Opus at xhigh, the command sandbox on with auto mode, as the owner's sessions
run; the plugin as it stood at `6aed62b`. The requests were written by the session mending the harness and say so
in their first line.

## 1. The milestone, through the real workflow

`run-milestone.sh` and `request-milestone.txt`: the saved workflow `sz:build`, started with the arguments the owner's
session had given it (their request and answers, not copied here) plus `maxMilestones: 2`, so that it took up
`day-true` and nothing after it.

| | The morning's run (old text) | The trial (new text) |
|---|---|---|
| Wall clock | 138 min | 37 min |
| Agents | 12 | 6 |
| Tokens | 1.56M | 0.62M (9.68 dollars at list price) |
| How it ended | open, `split-tail` shown false after two fixes and three looks | closed: 7 proven, 0 false, 19 earlier promises held |

What it shows:

- **The script runs in the Workflow runtime.** The tests answer agents from a table and cannot show what the
  runtime refuses; this run could. The lines it said are in `milestone-log.txt`: the fix begun and back, every
  claim shown again, the look back with its figures.
- **The line between a claim shown false and a case outside the contract was drawn as written.** The look after
  the fix (25 min) found a fault the fix had put in: with the speech detector slowed to 60 ms a frame, sound from
  after the window's end gets into a chunk. That is what `window-edge` is about, and under the old text it would
  have been that claim shown false and another round. The verifier first tried to bring the running app there
  (30 busy processes on 10 cores, load average 38; 96 app runs with no line of the lagging path in their logs),
  could not, recorded it as a notice naming the claim it is nearest, how it was made and the figure, and gave
  `window-edge` the verdict its own flows showed. Its return is in `milestone-returned.json`.
- **The sentence to whoever fixes was not followed.** The fixer was handed a claim whose finder had written that
  the running app could not be brought to the case, and was told not to bend the product to such a case. It
  mended the product (6 min, commit `3dafd52` in the clone), and that mend is what put in the fault above. The
  milestone closed all the same, because the look after it drew the line. What kept this run out of the morning's
  loop was the verifier's text, not the fixer's.
- **The session said nothing while it ran.** It started the workflow and waited, as the request told it to do
  nothing else. Whether a session keeps the wait on the run's journal that the skill now describes was not tried.
- **Not reached in this run:** the stop with a claim still false, the closer leaving a contract open and writing
  the backlog, a look shared among several verifiers, a ruling.

## 2. The ruling, one agent

`run-ruling.sh`, `request-ruling.txt`: one `sz:arbiter`, handed the request the workflow gives whoever rules at the
end of a run (`prompt-rule.txt`, produced by `make-prompt.mjs` from the trial's own plan and start), on a second
clone as the morning's run left it. 19 min, 3.84 dollars. Its return is `ruling-returned.md`.

- It gave the claim back (the fourth case of the request, the fifth of its own file), and did what the case asks
  before deciding. It ran the claim's own check (63 of 63). It read how the case had been made (a stand-in
  detector at 60 ms a frame, the frames handed over all at once). It named the machine the spec says the product
  is for (the owner's own Mac). It measured the detector there (0.087 ms a frame idle; under 30 busy processes
  0.734 ms mean, 188 ms at worst). It ran the app under that load and stopped it five ways (the power three
  times, sleep, quitting): 5 to 10 ms from the event to the stop each time, against the 600 the case needs. It
  tried a stand-in for the Mac sleeping (the app frozen for 3 s just after it was told).
- It recorded the case as a notice and the claim as proven by its own check, and `sz-eyes contract status` then
  said nothing was owed.
- It said what its freeze test could not show, and left the decision whether the state becomes a claim to the
  owner.
- It loaded the machine to a load average of 78 while it measured. A session of the owner's building beside it
  would have felt that.

## What neither trial shows

One product, one claim, one run each. A verifier or an arbiter that is wrong the other way (a fault people do
reach, written down as a notice) would look the same from here until someone meets the fault. The clone of the
first trial is kept at `/Volumes/DEV-SSD/sz-scratch/worktape-trial-20261126` (while that disk is plugged in) with
the closed milestone on its `main`; the second was removed.
