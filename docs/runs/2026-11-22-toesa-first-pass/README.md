# 2026-11-22: another product through its first pass (퇴사점검)

After four runs on the diet battle, a product of another shape: a phone-size web tool with no account and no
payment, whose one thing is a count. A person whose company filed their leaving as voluntary (code 11) puts in
their own dates and figures, and the product sets them against the thresholds of 별표 2 of the Employment Insurance
rules, shows the article behind each answer, and hands over the forms to fill in. The idea and its ground are the
owner's; the case made for it as a service says no (`docs/runs/2026-11-21-new-specimen-design/`), so it is built as
a specimen that measures the harness.

Its folder is `~/.studio-zero/specimens/2026-11-21/toesa-check/` (a git repository of its own, pushed nowhere).
The design stage is in the record of the day before. The owner said yes to the prototype drawn again at 00:00
("좋아요 진행합시다"), and the first pass was started at 00:03 with the plugin as it stood on local `main` at
`6580274` (a frozen copy with its dependencies installed). One headless session on Opus 5.5, session effort xhigh,
nobody at the Mac, `maxMilestones: 1`, asked "away": the owner had answered the prototype and not the four
questions before building, so form, papers and payment went as the prototype draws them, written down as the
starter's and not the owner's.

One run: read the figures as showing where the minutes are, not minutes to trust.

## What is here

| File | What it is |
|---|---|
| `build-request.txt`, `run-build.sh` | What the headless session was asked, in the owner's place, and how it was started |
| `request.md` | The owner's request and ground word for word, what the starter decided (marked as not the owner's), and what the owner said of each prototype |
| `clock.txt` | When it started and ended |
| `journals/build.jsonl` | The workflow's own journal |
| `timelines.txt` | Per agent: model, effort, wall-clock, tokens; model minutes against command minutes; the slowest commands |
| `rule-test/` | The first verifier's look run again on two copies after the change: its prompt, how it was started, what each returned, each copy's contract afterwards |

## The run: 193 minutes, closed

| Stage | Minutes |
|---|---|
| plan (the spec, 20 claims, one milestone) | 11 |
| build (all 18 screens; it stood 68 minutes after the session started) | 55 |
| first look (five verifiers: 20, 22, 23, 23, 32) | 32 |
| fix 1 | 27 |
| ruling on what the fixer could not make true (`as-drawn`) | 12 |
| second look (three: 7, 15, 19) | 19 |
| fix 2 | 6 |
| third look (three: 8, 9, 28) | 28 |
| close | 1 |
| **request to the end** | **193**, closed |
| built to the end | 123 |

| Verdicts (20 claims) | proven | shown false | the owner's |
|---|---|---|---|
| first look | 16 | 3: `as-drawn`, `export`, `criteria` | 1 (`feel`) |
| second look | 17 | 1: `criteria` (another place of the same kind) | 2 (`feel`; `as-drawn` set aside by the ruling) |
| third look | 18 | 0 | 2 |

Seventeen agents, 1.12 million output tokens, 1,372 tool calls. The session's own count of what it cost at list
prices: 90.14 dollars. Across all agents: 185 minutes of model time, 134 of commands (27 of them flows, 20 waits).
No simulator and no container: nothing in this run waited on a machine.

The first passes of the diet battle took 290, 211 and 221 minutes. That is another product (accounts, a database,
a live battle), so the figures do not compare stage by stage; what can be said is that the same harness took a
product of another shape from an approved prototype to a closed first pass in one stretch, with no stop that
needed a person.

## What it shows

1. **The first pass closed, 18 proven and none false, with answers its own verifiers knew to be wrong.** The
   verifiers recorded 27 notices (26 lines in what the run returned). By my reading ten of them say the product
   tells a person something that is not so, among them:
   - a month paid in full, five days late, is counted as a month with three tenths or more unpaid: with one such
     month and one month unpaid the screen says "요건에 맞아 보여요" at 40 days of the 60 required;
   - the day a late wage was received may be after the day the person left, and the days after leaving are
     counted: 132 days from one month;
   - twelve months unpaid give "2063일 / 60일": the periods overlap and run past the year the rule looks at;
   - a commute case with the date of the change left empty still answers "요건에 맞아 보여요";
   - a deadline that falls on a Saturday is not moved; opened after the benefit period has ended, the home screen
     still says the person can apply.

   Every one was found by a verifier trying to break a claim it held (the evidence lies in folders named
   `s1/break`, `kinds/break`, `steps-break`), on the very thing that claim is about. Each claim was then recorded
   proven, because its own flow or test, which walks the case the claim's figures name, ran to its end; and the
   case that broke it went under "noticed". The first of them was on the result screen of the main walk at the
   first look ("7·9·10월분은 3할 이상 못 받은 달이 2개월 이어져요": three months called two, one of them paid in
   full); three verifiers wrote it down. The wording was mended in passing because the verifier of `as-drawn` also
   listed it; the cause was not, and the second and the third look each reported it "still so". Nobody mends what
   is noticed before a milestone closes: it goes to the backlog (29 lines here), and the owner is told the claims
   hold.

   The verifier's instructions said to try to make each claim false, and said what to do with what no claim
   covers; they did not say that a case which does make it false is the verdict. **Changed** (finding 1 below).
2. **The looks after a fix carry the notices along, and that is where their minutes went.** The first verifier
   of each look after a fix is handed everything noticed before and returns what is still so. With 25 notices that
   was most of its work: 19 and 28 minutes against 7 to 15 and 8 to 9 for the other two shares, with the fix and
   then the close waiting behind it. Nothing acted on what it returned. With finding 1 mended most of those lines
   are verdicts, handed to a fixer; the rest of the carrying is not changed.
3. **`criteria` was shown false twice, for two places of one kind.** The claim says every figure on a screen
   comes from one table. The first look found "3할" written into five places of the code; fix 1 mended those and
   showed it with the table's share changed. The second look changed one more value (the years the rule looks
   back) and found the twelve months of that year written into two places. Fix 2 took 6 minutes and the look after
   it 28. The fixer's instructions told it to mend "wherever the same thing is shown" only for a claim about
   every screen. **Changed**: any claim about all of a kind. (Whether the first fixer would have found the twelve
   months that way is not known.)
4. **The drawing and the law disagreed in six places, and that was found at verification.** `as-drawn` says the
   18 screens are built as drawn; other claims say the request form is the statutory form (별지 제75호의3서식)
   word for word, that every answer carries the line "판정은 고용센터가 해요", and so on. The prototype had drawn
   the form with words the real form does not have and without parts it has, drew one case ("더 확인이 필요해요"
   for care refused) against what 별표 2 asks, and drew a state ("절반 못 받음") that the choices on its own sheet
   cannot produce. The fixer said so, an arbiter read the form from law.go.kr and set the claim aside for the
   owner in 12 minutes, and the product follows the sources. That path worked as it was built to. What it shows
   about the design stage: a prototype is measured for fit and never read against the sources the plan names, so
   a screen that reproduces someone else's document is drawn from memory.
5. **Five verifiers at the first look were even** (20 to 32 minutes; three shares by count had been 45, 61 and
   74 on 2026-11-17), each on a copy of the product of its own, all flows written by them (sixteen files under
   `e2e/`).
6. **A fixer or a verifier cannot end, inside the session's sandbox, a server an earlier command started.**
   Eight times `kill` or `ps` was refused and run again outside; nine more refusals came from copies made on the
   external disk the request had named, which the sandbox does not list; a few others (a `diff` of two streams, a
   write to `/tmp`). A retry each. **Changed**: the line every agent is given about the sandbox now names ending
   and listing such a process.
7. **Evidence: 885MB and 4,037 pictures for a web product with no film**, a 38MB evidence page, and a repository
   of 478MB. Each look after a fix took its pictures again under a folder name of its own choosing (`look2`,
   `look2-c`, `v5`, `v6`, `v6-docs`, `v6-3`).
8. **The session showed the product when it stood and could not keep it up.** It made a copy on the external
   disk and started it when the builder said it stood (01:11); a headless session's background command ends
   after two hours, and the copy went down with it. Nobody was at the Mac.

## What was changed because of it

On the branch `phone-again`:

- **A claim a verifier broke is refuted, though its check passes** (finding 1). The verifier's own rules
  (`plugin/agents/verifier.md`) and the line every verifier is given by the workflow say so: a claim's figures are
  one case of what it is about, and a case the verifier tried in which the product is wrong about the same thing
  is the verdict, not a notice. Since such a claim's frozen check passes before and after, the fixer is told the
  check shows nothing of its fix (bring the product to the case, mend the neighbouring cases, add the case as a
  test of its own where it is pure rule), and whoever looks again is handed what was found, not only the claim's
  name.
- **A fixer looks for the others of a kind** when a claim says something of all of a kind and the verifier named
  one place (finding 3).
- **Ending or listing a process an earlier command started is run outside the sandbox from the first try**
  (finding 6).

## The change, tried on the same look

The first verifier of the first look (claims `rules`, `s1`, `kinds`, `short`) had recorded all four proven and
four faults as noticed. The same look was run again after the change: two copies of the specimen as it stood built
and unverified (`e7e8e59`), one `sz:verifier` each from the plugin at `6392988`, handed the prompt that verifier
had been given with only the lines changed since (`rule-test/`: the prompt, how it was started, what each
returned, and each copy's contract afterwards). Headless Opus 5.5, session effort xhigh, 21 and 26 minutes, about
five dollars each at list prices.

| | proven | shown false | noticed |
|---|---|---|---|
| the run (before the change) | 4 | 0 | 4 faults |
| copy a (after) | 0 | 4, each with the case that broke it | 2 |
| copy b (after) | 0 | 4, each with the case that broke it | 1 |

Each wrote its claims' flows to walk the claim's own case and then a case that breaks it (in copy b each flow
stops at that step): the fix has something to be proven against. Two verifiers on one look is not a measurement
of how often; it shows the rule is read and acted on.

**What both found that eleven verifier sessions of the run had not.** Each of the two, on its own, wrote down
that the main walk's expected answer does not follow the source the product cites for it. The claim, the plan,
the frozen test and the prototype's hero screen all say that late or unpaid periods of 38, 35 and 4 days add up
to 77 of the 60 required, "요건에 맞아 보여요". The ministry's public answer that the plan names (read again on
2026-11-22) adds up periods only where the whole wage was unpaid or late (38 + 4 = 42 days), and for a wage three
tenths or more unpaid asks that "그 기간이 2개월 이상 단절없이 연속", saying in so many words that periods added
up to two months do not count. The figures on the screen had been checked against their sources at every look
(`criteria`: 31 of 31); the rule that joins them had been checked only against the plan's own summary of the
source (`rules`: "계획 9절대로 답한다", shown by a test the builder wrote from that summary). The rule the plan
already has, "a claim does not state as true a fact about the world that nobody has read from its source", was
met in form: the planner had read the source and summarised it wrongly, and everything after took the summary.
With the verifier's rule changed, a verifier trying another case went back to the source's own sentences. Not
changed further: the path for it exists (a claim whose own words are wrong is set aside for the owner by an
arbiter who reads the source), and the next run on this specimen is where it is seen to be taken or not.

Not changed, and why:

- **Reading a drawing against the plan's sources at the design stage** (finding 4): it would have the designer
  fetch and reproduce a statutory form, which costs design minutes on every product for a fault seen once, and
  the ruling that caught it cost 12. If a second product shows a drawing contradicting its own plan, the place
  for it is the measurement of the prototype, not prose.
- **Who carries the notices at a look after a fix** (finding 2): with finding 1 mended there should be few; a
  run after the change shows whether there are.
- **Evidence taken again at each look** (finding 7): the same position as on 2026-11-21. Each look's pictures
  are what its verdicts point at; the weight is real (0.9GB a milestone on a web product) and waits for a run
  with room to try a look after a fix that keeps only what changed.
- **The two-hour end of a headless session's background command** (finding 8): it is the session's, not the
  workflow's, and with the owner at the Mac the session is theirs and has no such end.
