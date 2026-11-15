---
name: tend
description: Use when the owner asks how a product is doing, what to do with it next, or to look after it, keep it healthy or grow it ("돌봐줘", "점검해줘", "뭘 더 하면 좋을까", "고도화"), and for the regular look at a product that is live. Checks that what was proven still holds, looks at what fails for people, how it is used and what they say, walks it as a newcomer, checks what it stands on, and leaves a ranked list of what to do next, each with evidence. Fixes what broke; proposes the rest.
---

# Tend: look after a product that lives

The first version is the smaller part of a product's life. After it, things break as the world moves (a dependency, a platform rule, a browser), people use it in ways nobody tried, and what would make it worth more shows only in use. Tending is the regular look that turns all of that into the next pieces of work. It finds and ranks. `sz:work` builds. `sz:feedback` is how the owner steers.

Read `.sz/map.md`, `.sz/spec.md`, `.sz/owner.md`, the last lines of `.sz/progress.md` and `sz-eyes backlog` first. Work from a clone or worktree, on a port taken from the machine (`PORT=$(sz-eyes port)`), and on a copy of the data, never on what people are using. End what you launched by the id you kept, nothing else.

## The look, most certain harm first

1. **What was promised.** `sz-eyes standing` lists every claim earlier work proved. Run each one shown by a flow, test or command (the project's whole check command where it has one), and look again at the ones on the path most people take. For a check file it says changed since it last held, read what changed and decide whether it still checks what its claim says. Record each: `sz-eyes standing record <contract>/<claim> --status holds|broken|unchecked --note "<what was run and what it showed>"`. A broken promise is the top of the list.
2. **What fails for people.** Where the map says failures are kept (a server log, crash reports, failed requests): what failed since the last look, grouped, each with how often and what the person was doing. If the map names no such place, that is a finding and a high one: the product is flying blind. Say the smallest thing that would end that for this product (an error log the server writes, a health address, a count of the one thing).
3. **Whether it is used.** The few counts that say whether the one thing the spec names is happening: started, finished, came back. Where people stop. If nothing is counted, that is a finding.
4. **What people say.** Reviews, a feedback box, messages the owner passed on: in their words, grouped.
5. **The first minute.** Walk it as someone who has never seen it, at phone size, operating it (`sz-eyes web do`, `sz-eyes ios flow`): arriving, doing the one thing, coming back the second time, when there is nothing yet, a wrong input, a request that fails. Read every word. Count the presses to the one thing. Take what `look` measures. Hold what you see against `sz:taste` and against `.sz/owner.md`.
6. **What it stands on.** Known vulnerabilities and end of life in its dependencies and runtime (the stack's own audit command), platform deadlines (store rules, SDK versions), keys and certificates that run out, and backups: is there one, and has getting the data back from it been tried.
7. **What slows change.** The check that is slowest or fails at random; the file every change touches; lines of the map that are no longer true.
8. **What would make it worth more.** Three proposals at most, each grown from something found above or from the one thing the spec says it must do well, not from a list of features products usually have: what, for whom, what would be true when it is done, why now, and its size.

Keep pictures and logs under `.sz/evidence/tend-<date>/`.

## What you do about it

- **Fix now**, when the cause is found and the fix is S: a standing claim that broke, a crash, a false line in the map. That restores what was already agreed, so no decision of the owner's is taken. One commit each, with before and after.
- **Tick what is already ended.** A line of the backlog that later work resolved without saying so: check it on the product as it is now, then `sz-eyes backlog done "<some of its words>" --by "<the commit or contract that ended it>"`. A list that still names what is fixed stops being believed.
- **Write down the rest:** `sz-eyes backlog add "<what, as the owner would say it>: <the evidence: a figure, a picture's path> [S|M|L]" --from "돌봄 <date>"`. Anything that changes what the product is waits for the owner.

## Report

One screen, in the owner's language:

1. In a line, how it is: promises (how many hold, how many broke and are fixed), failures, use.
2. What you fixed.
3. The five things most worth doing of what is left, in this order of kind: broken promises, failures people meet, what stops people on the way to the one thing, what it stands on, growth. Each with one line of evidence and its size.
4. Your recommendation: the one thing you would do next, and why.
5. What you could not look at (no access to where it runs, no device) and what that leaves unknown.

Add a line to `.sz/progress.md`. What the owner says to the report is feedback (`sz:feedback`). "위 셋 해" is `sz:work` for each by its lane; several features at once is the `sz:build` workflow, which extends the spec the product already has.

If the product is live and nobody looks at it regularly, say once that this look can be run on a schedule.
