# 2026-11-22: the milestone after the first pass, on the changed harness (퇴사점검, `mend`)

The first pass of the specimen had closed with answers its verifiers knew to be wrong
(`docs/runs/2026-11-22-toesa-first-pass/`). This run is what came after it in the same folder
(`~/.studio-zero/specimens/2026-11-21/toesa-check/`): one milestone that mends those answers, planned and built by
the workflow from the backlog and from what the starter had added to `request.md` (the source's own sentences on
how unpaid wages are counted, quoted, with the reading left undecided). It ran with the plugin as it stood on the
branch `phone-again` at `51bfa6c` (a frozen copy): the first whole run in which a claim a verifier breaks is
refuted though its check passes. One headless session on Opus 5.5, session effort xhigh, nobody at the Mac,
`maxMilestones: 2`, asked "away". No release: that needs the owner's hosting account and their word.

One run: read the figures as showing what happened, not minutes to trust.

## What is here

| File | What it is |
|---|---|
| `continue-request.txt`, `run-continue.sh` | What the headless session was asked, and how it was started |
| `finish-request.txt`, `run-finish.sh`, `journals/finish.jsonl` | The same for the session that took the milestone up where it had stopped |
| `request.md` | The owner's request and ground word for word, and everything the starter added, marked as not the owner's |
| `clock.txt` | When it started and ended |
| `journals/continue.jsonl` | The workflow's own journal |
| `timelines.txt` | Per agent: model, effort, wall-clock, tokens; model minutes against command minutes; the slowest commands |

## The run: 223 minutes, left open with one claim false

| Stage | Minutes |
|---|---|
| plan (one milestone, 7 claims; two claims of the first pass replaced) | 13 |
| build | 64 (25 of them the model; 26 waiting on the first pass's flows run again) |
| an arbiter corrects eight first-pass flows that waited for the old answer | 15 |
| first look (two verifiers: 28, 37) | 37 |
| fix 1 | 23 |
| ruling on what the fixer could not make true (`server`) | 6 |
| second look (one verifier) | 17 |
| fix 2 | 21 |
| ruling | 3 |
| third look (one verifier) | 17 |
| last ruling, close | 2, 1 |
| **request to the end** | **223**, open |

| Verdicts (7 claims) | proven | shown false | the owner's |
|---|---|---|---|
| first look | 2 | 4: `rules`, `answers`, `papers`, `server` | 1 (`drawn`) |
| second look | 3 | 3: `answers`, `papers`, `server`, each by a case it had not been shown false by before | 1 |
| third look | 5 | 1: `server`, by another such case | 1 |

The fifteen claims of the first pass that the milestone did not replace held at every look. Thirteen agents, 0.72
million output tokens, 864 tool calls; 62.22 dollars at list prices by the session's own count.

## What it shows

1. **The verifier's new rule held through a whole run.** At the first look four of six claims were shown false,
   each by a case its own check does not walk. `rules`: "npm test passes all 52 tests, but the product goes
   against its source in two other cases" (a wage received on the very day the person left counted as never
   received, which turned 35 days of 60 into "요건에 맞아 보여요"). At the second look a line that had been
   carried as noticed was returned as a verdict instead: "No longer listed here: DC-02's '요청일' accepting a
   future date is still so. It is recorded as the answers verdict, not as noticed." What stayed noticed (three
   things, carried over the three looks) is about what no claim of this milestone speaks of.
2. **The question of the source went the way the harness has for it.** The plan opened the ministry's answer
   again, recounted the main example from its sentences (42 days of 60, not 77), and where the source can be read
   two ways with two answers made the product say "더 확인이 필요해요" with both figures rather than choose. It
   replaced the first pass's `rules` and `s1`, kept the other fifteen under a claim of their own (`kept`), and
   wrote a claim that is the owner's (`drawn`): the screens that no longer match the drawing they said yes to,
   set beside it. Eight flows of the first pass waited for the old answer; the builder disputed one, and one
   arbiter corrected all eight in one sitting.
3. **Words recorded as the owner's were the starter's.** The contract's record of the two replaced claims gives
   as its ground "주인: '다음 마일스톤은 닫힌 첫 판에 남은 틀린 답을 고치는 것입니다…'". That sentence is from
   `continue-request.txt`, which the starter wrote in the owner's first person, as the requests of earlier runs
   were. The owner's own words were "좋아요 진행합시다" (to the prototype, that night) and, the day before, to run
   another app to the end. Only the owner's words may replace a standing claim: the gate was passed by a sentence
   they did not write. The workflow cannot tell, because the session it runs in is told the request is the
   owner's. What the replaced claims said was false by the product's own source, and the visible change is still
   put before the owner (`drawn`); the record of who decided is wrong all the same. **Changed** in how these runs
   are started, not in the plugin: a request written for a headless session says who writes it, keeps the owner's
   words apart as quoted, and tells the session never to pass the rest on as theirs. A note saying so was added
   to the specimen's `request.md`.
4. **A claim about an open-ended kind of input did not converge, and the milestone stayed open on it.** `server`
   says nothing of a person stays in the operating records. Sent straight to the error endpoint, the first look
   got an e-mail address, a name without quotes and full-width digits through; the second "박 서연", "서연", "김구",
   "Park Seoyeon", "NGUYEN VAN AN"; the third "seoyeonPark" and "an do yoon". Each fixer taught the scrubber the
   forms it had been shown (the second moved to a list of words that may stay, and kept camel-case words and short
   English ones). Three times an arbiter ruled that the product was wrong and could be mended. A claim is handed
   to a fixer twice at most, so the run stopped there, as it is built to. The same shape showed, smaller, in
   `papers` (the page count the export sheet states: wrong for one fill at the first look and for another at the
   second) until the second fix counted pages the way the browser splits a long paragraph, and then it held. The
   difference between the two is the difference between mending a case and mending the kind. Nothing told the second fixer that it was the second:
   it was handed what the third look would later call "another form", with no word of what had been found and
   mended before. **Changed** (below).
5. **What the stricter verdicts cost.** From built to the end: 144 minutes for six claims (123 for nineteen at
   the first pass, which closed over what this run then spent 223 minutes on). Every look after a fix was one
   verifier and 17 minutes.
6. **Evidence again:** 911MB for this milestone; the specimen's folder is 3.0GB after two milestones.

## What was changed because of it

On the branch `phone-again`:

- **A claim handed to a fixer a second time comes with what was found the first time**, and the fixer is told
  this is the last time: where the new case is of the kind found before, mend the kind (change what makes such
  cases possible, so that none is left: do not take in or keep what the product cannot handle, do not state a
  figure it cannot know, work a figure out the way the thing it describes is made) and say why no further case can
  come, or put the claim under "notFixed" and say why it cannot be made true as worded. A run that takes up a
  milestone an earlier run left with claims false tells its fixer the same, from the log (it does not know how
  often the earlier run tried).

## The change, tried on the claim that had stayed false

The milestone was taken up where it had stopped, in a third session (`finish-request.txt`, `run-finish.sh`,
`journals/finish.jsonl`), with the plugin at `61c29b3`: 55 minutes, 11.71 dollars at list prices, and it closed.

| Stage | Minutes |
|---|---|
| plan (nothing new to plan; the milestone is taken up at the fix) | 5 |
| the product started again | 1 |
| fix 1 | 7 |
| look (one verifier) | 18 |
| fix 2 | 6 |
| look (one verifier) | 15 |
| close | 1 |
| **request to the end** | **55**, closed: 6 proven, 0 false, 1 the owner's (`drawn`) |

- The first fixer of this session was told, from the log, that a claim mended before and shown false again by
  another case of the kind is not mended by one more patch. It wrote: "This kind of leak was patched twice before
  (8c810b9, a446a9f) and turned up again, so I changed the rule that allows it, not just the two cases found." Its
  rule still chose what to delete, by kinds of character it knew. The look after it got circled letters and
  superscript digits through.
- The second fixer was handed that, what had been found before it, and the line that this was the last time. It
  wrote: "This mends the whole kind, not just the cases named. […] The rule now chooses what to keep, and what it
  can keep is a closed set." The look after it tried 27 further forms of a name and a number, straight to the
  endpoint and as errors on a screen; none was kept.

Two fixers before the change had each taught the rule the forms they were shown; with what was found before in
hand and told to mend the kind, the second one here turned the rule round. One claim, once: it shows the line is
read and acted on, not how often it will be.

The request for this session was written in the starter's own voice, with the owner's words named as only those
marked so in `request.md`. The session passed nothing of it on as the owner's, added a correction to the spec's
section on the milestone, and reported that the frozen contract still carries the three places where the
starter's sentences stand as the owner's: a frozen contract is not rewritten.

Not changed, and why:

- **How many times a claim is handed to a fixer** (finding 4): two is right. A third patch of the same kind would
  have met a fourth case.
- **The builder's 26 minutes of waiting on the first pass's flows**: it ran them to learn which waited for the
  answer it was changing, which is how the eight were found before any verifier met them.
