# 2026-11-23: what happens after a fix, tried on last night's run

The confirming run of 2026-11-22 (`../2026-11-22-drawing-compare/c-confirming/`) stayed open after 297 minutes
for three reasons its record names. Two were changed on 2026-11-23 (`f68e7a8`, `cac9641`, `f7b4708`,
`6dbe9b6` on branch `honest-verdicts`); the decision record is `docs/decisions/2026-11-23-after-a-fix.md`. This
folder is the trial of those changes on the run's own state: four agents, one run each, each handed the prompt
the run really gave its agent with the new text put in.

Every figure here is from one run. The plugin was at `cac9641`; the change of `f7b4708` came out of the first
trial and was not tried.

## What was tried

| | Where the run stood | In the run (old text) | In the trial (new text) |
|---|---|---|---|
| **A look after a fix**, the first of three verifiers, seven claims, none of them shown false before | after the third fix (`29d2bb2`), which changed how a paper's text is copied | 21.3 min. Tried new cases on three claims the fix had not touched and broke one (`wage`: a month whose payday falls inside the one-year window cannot be entered) | 10.8 min, 3.91 dollars. Read what the fix changed first, wrote "none of my claims' screens or rules", showed each claim by its own check, and tried one new case where the fix did reach (the copied text, for the claim about three forbidden phrases). Six proven, none refuted |
| **The ruling after a fix** | after the first fix (`ee1bd80`) | 18.0 min. Set `criteria` aside for the owner because the frozen flow pressed "30일 넘게" and the screen, mended to the law, says "30일 이상"; set the as-drawn claim aside with four differences held by frozen flows | 17.4 min, 3.74 dollars. Corrected line 96 of `flows/criteria.sh`, the words of one press (`rule-commit.diff`), recorded it with `sz-eyes contract amend`, committed that file alone, searched the other frozen checks for the same words; the flow then ran its 224 steps. Found the product wrong on the as-drawn claim and said the flows are corrected after the mend, not before |
| **A fixer**, handed the as-drawn claim alone | at the end of the first look (`ec688f5`) | (among 13 claims, 30.1 min) left four differences because frozen flows held them, and one because its source does | 23.3 min, 6.51 dollars. Mended ten of the eleven differences to the drawing (`fix-commit-app.diff`), left "유료 전화" with its source, searched the frozen flows for what it changed, ran the seven it reached, and named the two that now read the old form with file, line, old form and new. Ended its server by its id |
| **The ruling after that fixer** | the trial fixer's commit | did not happen | 12.6 min, 3.44 dollars. Corrected `flows/next-steps.sh` (the article is read from the end of the step's text, where the drawing puts it; the expectation went from "a part that is not empty" to "text that names an article") and `flows/erase.sh` line 41 (waits for the drawn words that name the dates, not the line the mend removed). Both recorded and committed alone. Both flows then ran on to the product's own faults, which are still there (a date one day early, a notice that vanishes): no failure became a pass. Set the as-drawn claim aside with one difference left, a real question for the owner: the drawing puts 1350 under "무료로 물어볼 곳" and the ministry's page says the line is paid |

All four: 39 minutes of wall clock (09:13 to 09:52), 17.60 dollars at list price, Opus, the verifier and the
arbiters at the session's effort (xhigh), the fixer at high.

## What it shows, and what it does not

- The bound on new cases is followed. The verifier's own return: "The fix only changed the paper and copy text
  (app/js/more.js, main.js, styles.css), and none of my claims' screens or rules. So each claim was shown again
  by its own check." The slowest verifier of that look took 21.3 minutes in the run and 10.8 here.
- **Its cost is real and was seen.** The fault the run's verifier found on `wage` at the fourth look is a true
  fault of the product. Under the bound it is not found in this piece of work.
- **The bound alone would not have closed that run.** Of the three claims its fourth look showed false, one was
  a new case on a claim just mended (still tried under the bound) and one was found by the claim's own frozen
  flow (still run). Two false in place of three, and a fourth fix where the run stopped because `wage` had used
  its two.
- The chain for a frozen check that presses an old form works end to end on this state: the fixer mends and
  names the check, the arbiter corrects how it presses or reads and records why, the claim stays to be looked
  at again. What the arbiters changed is in the two diffs and in each copy's contract under `amendments`.
- The closest call was `flows/erase.sh`: a step that waited for one line of text now waits for another. The
  claim names only "날짜" among what the screen shows; the new words are the drawn ones that name the dates. The
  first arbiter had said of this very line that it must be pointed at the drawn words "without weakening it, or
  it goes to the owner".
- Not shown: any of this inside a whole run; a look after the flows were corrected; a fixer that names a check
  that is in fact right (the ruling guards that: it takes nobody's word and opens the source or the drawing);
  the bound on what was noticed before (`f7b4708`), which the first trial led to. In the run and in the trial
  alike, the first verifier walked again to all sixteen things noticed earlier, five to seven minutes, though
  the fix had reached none.

## A mistake in the setup

The run's prompts carry the run's launch line, and that line names the run's own folder (`…/drawing-compare/arm-c`)
by its whole path. On 2026-11-22 the path was replaced by the copy's; this time it was not, in the first three
prompts. Every tool call of the three sessions was read afterwards: the verifier and the fixer never named that
folder, and the first arbiter named it in two commands that only read (`ls`, `git log`, `git cat-file`), said
in its return that the line pointed at another copy, and worked in its own. The folder is as the run left it
(`2d816fe`, the same one changed file as before). The fourth prompt names the copy.

## Files

- `make-copies.sh`: the three copies, each a clone of the run's product at the commit its agent began from, with
  the contract and evidence as they stood then. `rebuild-contract.py` (and `.out`) rebuilds the contract as it
  stood at the end of the third look, from the verdicts the second and third looks' verifiers recorded: no
  snapshot was kept then.
- `make-prompts.py`: the prompts, each the run's own with the new text taken from `plugin/workflows/build.js`.
  `prompt-look.txt`, `prompt-rule.txt`, `prompt-fix.txt`, and `prompt-rule2.txt` (the frame of `prompt-rule.txt`
  with the trial fixer's three lines).
- `request-*.txt`, `run-*.sh`: how each session was started. The requests say they are not the owner's.
- `look-returned.md`, `rule-returned.md`, `fix-returned.md`, `rule2-returned.md`: what each agent returned.
- `rule-commit.diff`, `fix-commit-app.diff`, `rule2-commits.diff`: what the arbiters and the fixer committed.
- On the SSD, `/Volumes/DEV-SSD/sz-scratch.noindex/after-fix-test/` (3.6 GB): the copies with their
  commits, the sessions' streams. It can be deleted.
