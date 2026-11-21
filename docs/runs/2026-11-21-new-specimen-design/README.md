# 2026-11-21: the design stage of a new specimen, from a case that ended in "no"

A new product, 퇴사점검 (a worker whose employer filed "left of their own accord" checks their reason against the
law's own table), taken through the design stage of `sz:build`: screens planned, a reference board made, every
screen drawn as one prototype, measured, and put before the owner. It is the first run that starts from a case
(`sz:worth`), and the case had ended in "no" as a thing to sell: it is built as a specimen, to measure the harness
on a product of another shape than the diet battle (questions and answers, a rule table, forms; no accounts, no
other people). Headless, Opus 5.5, session effort xhigh, plugin at local `main` `da0c820`.

Its folder is `~/.studio-zero/specimens/2026-11-21/toesa-check/` (a git repository of its own).

## What is here

| File | What it is |
|---|---|
| `request.md` | The owner's idea and ground, word for word, and under its own heading what the one who started the run decided (not the owner's words) |
| `design-request.txt`, `run-design.sh` | What the headless session was asked and how it was started (both times) |
| `clock.txt` | When each session started and ended |
| `journals/design-1.jsonl`, `design-2.jsonl`, `design-3.jsonl` | The workflow's journal of each session (the third is the redraw) |
| `timelines.txt` | Per agent: model, effort, wall-clock, tokens |

## Two sessions: 45 minutes that measured nothing, then 8 that did

| Stage | first session | second session |
|---|---|---|
| plan (where the design stands) | 1.1 | 0.4 |
| screens planned (18) ∥ reference board ∥ drawing | 19.1 ∥ 15.5 ∥ 38.4 | 0.7 ∥ 0.4 ∥ 5.1 (each took up what was there) |
| measuring (sweep) | 0.3, 0.3, 0.4: the tool did not start | 0.8: 31 drawings, 31 hold |
| mending between sweeps | 0.7, 1.7: nothing to mend | none |
| **session** | **44.9**, no contract | **8.1**, contract `design`: screens proven, feel the owner's |

The owner had been put four questions an hour before (form, papers, payment, whether to judge the prototype) and
had not answered: `asked: "away"`, their own ground passed word for word, and what the starter had decided passed
under a heading that says it is not the owner's.

## What it shows

1. **Eyes that did not run cost forty minutes and were worked round four different ways.** The copy of the plugin
   made for the run (a new git worktree) had no dependencies installed; every `sz-eyes` command ended with a module
   error and exit 1. The plan noticed in its first minute and ran another checkout's `sz-eyes` in its place, telling
   whoever came next to do the same. The designer measured its 31 drawings and mended six findings (its return does
   not say with which copy). The measurer refused to (three times: "not
   measured, so none counts as holding"), which was right. One fixer wrote a module-loader shim to run the broken
   copy's code against the other copy's packages. A measurer deleted the pictures already taken before a sweep that
   then did not run. And the stop hook read the command's exit 1 as claims owed and held the session back with an
   empty list. **Changed (`d33e382`):** the command's wrapper says in one line that its copy has no dependencies
   and exits 127; the plan returns what it printed and the workflow starts nothing; the stop hook does not take a
   failed command with nothing listed for claims owed. The fault itself was the starter's: a worktree needs
   `pnpm install` before it is a plugin.
2. **A stage run again took up what was there.** The second session planned nothing, searched nothing, and drew
   nothing again: plan and board answered in under a minute, the designer measured and corrected for five, and the
   sweep recorded the contract. Eight minutes.
3. **The case steered the design without anyone handing it over.** The planners read the case
   (`sz-eyes worth show`) and the starter's note, and decided, marking each as decided and as open to the owner at
   the drawing: no payment and no price on any screen; the "의견서 초안" of the request as a frame the person fills
   in their own words, with prompts and no model; "가능성" and never "판정", in three fixed phrases, each with its
   article; no referral to a named 노무사 (공인노무사법 제27조의2), only free public channels; no account, and
   what a person enters kept on their phone. The edge rows of the case (figures of one's own against the line the
   law draws, the list of proof by reason, the statement's frame) are the centre of the drawing: the key screen
   lays the days a wage was late against the sixty the table asks.
4. **Mobbin could not be reached from a headless session** (it asks for a sign-in); the board was made from the
   house library alone (eight screens kept).
5. **A legal reading is drawn as if settled.** The key screen counts "임금체불 2개월 이상" as sixty days of
   lateness added up across months. That is a reading, and the drawing presents it as the law's line. Whether each
   threshold is the law's own words or the product's reading has to be a claim of the first pass, shown against the
   table's text, before anything is built on it.

## The owner's look, and the prototype drawn again (14 minutes)

At 21:5x the owner, in their words: "시안 봤고 좋아보이는데, 너무 단조로워보이는 느낌도 있어요. 한가지색만
쓰는데 원색이라 쨍한느낌이랄까." It holds both "looks good" and something to change; the one who started the run
read it as "change it", recorded it on `design/feel` as no in those words, told the owner so, and started the
workflow again (`design2-request.txt`, `run-design2.sh`, `journals/design-3.jsonl`; plugin at `c8d9f13`).

| Stage | minutes |
|---|---|
| plan (finds "again" and the owner's words on the contract) | 0.4 |
| the designer draws again from those words | 8.3 |
| measuring: 31 drawings, 31 hold | 0.9 |
| **session, request to stop** | **14.2** |

The designer changed what was said and nothing else: a second colour (a lemon highlighter, with a job of its
own: the pen colour marks what the person wrote, the highlighter the lines the law draws), both colours quieter
(the blue from `#2F4CC4` to `#3B5690`), by tokens and five parts, so every screen made of them changed with them;
placement, words and screens as they were. The first prototype is kept in the specimen under
`kept/first-prototype/`. The redrawn one waits for the owner again.

## What waits

The prototype waits for the owner: `.sz/design/prototype.html`, pictures in `.sz/design/shots/`. Their verdict is
recorded in their words (`sz-eyes contract judged design feel --verdict yes|no --said "..."`), and the four
questions stand. Nothing is built before that.
