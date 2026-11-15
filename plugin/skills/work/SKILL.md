---
name: work
description: Use for any request to build, change or fix something in a project (a feature, a bug, a screen, a whole product). Sizes the work, agrees what "done" means as a contract before building, has it proven on the running product by an agent that did not build it, and hands the owner one page of evidence.
---

# Work: as much process as the task deserves, and proof at the end

Process costs time and tokens, and a harness can cost twenty times what the same model costs alone. It is worth that only where the model alone would not reliably get it right. So the first decision of every request is how much it deserves.

If the project has no `.sz/map.md`, onboard first (`sz:onboard`). Read the map and the last lines of `.sz/progress.md` before anything else.

## 1. Size it (the lane)

Decide in a few seconds, from the request and the map. Say the lane and why in one line.

| Lane | When | What happens |
|---|---|---|
| **S** | A few files. No new screen, no new API, no schema, no money, nothing irreversible. | Do it. Run the nearest check. If a screen changed, show it before and after. No contract file. |
| **M** | One feature, or a bug whose cause is not yet known. | A contract of 3 to 7 claims, frozen. Build. One verification by `sz:verifier`. An evidence page. |
| **L** | Several features, a new product, or anything touching data, auth, payment or what cannot be undone. | Ask the owner first. A spec and milestones. Each milestone is an M. Progress is written down as it goes. |

When in doubt between two lanes, take the smaller one and say what would make you move up. Move up when you find the work is bigger than it looked; never quietly.

## 2. S: do it and show it

Make the change the way the project makes such changes. Run the type check or the nearest test. If anything a person sees changed, take a look before and after (`sz-eyes web look` / `sz-eyes ios look`, see `sz:verify`) and put both pictures in front of the owner. Report in three lines: what changed, what was run and what it said, what was not checked. Done.

## 3. M: contract, build, proof

**Write the contract** before any code:

```
sz-eyes contract new <id> --lane M --request "<the request, in the owner's words>" --target <web|ios|...> \
  --claim "<claim id>|<what will be true, as the owner would say it and could see it>|<flow|test|look|command|owner>:<how it is shown>" ... \
  --not "<what is deliberately not done>" --risk "<what could go wrong>"
```

A claim is something that will be true of the running product and can be shown: "긴 닉네임이 잘리지 않고 다 보인다", not "ellipsis 처리를 고친다". Each says how it will be shown: a flow file that will be run, a test command, a look at a named screen in a named state, a command. Include one claim for what the change must not break (the neighbouring thing most likely to). What only a person can judge (is it pleasant, is it fun) is a claim shown by `owner`, and stays theirs.

Prefer checks the project already has (its e2e flows, its tests) over new ones. Where a flow has to be written, write it in the project's own format (Maestro YAML, a Playwright test), in the project's own folder, before the code: it is the oracle.

**Freeze it:** `sz-eyes contract freeze <id> --frozen <each flow or test the claims point at>`. From here you do not edit the contract, and you do not edit the frozen files. If the contract turns out wrong, stop and say so; it is reopened deliberately, not adjusted to fit what was built.

**Build.** Follow the project's own rules (the map lists them). Run its checks as you go.

**Have it proven.** Start the `sz:verifier` agent with the contract id and nothing of your own opinion: not "it works", not what you tested. It operates the product and records a verdict for each claim. If a claim is refuted, fix the product and send it back for that claim; twice at most, then report what stands.

**Evidence:** `sz-eyes evidence <id> --took "<time and tokens if known>"` writes `.sz/evidence/<id>/report.html`. Show the owner the path and the verdict in one line each, and what is unchecked. Then `sz-eyes contract close <id>` and add a line to `.sz/progress.md`.

## 4. L: ask, plan, then milestones

**Ask the owner first**, in one message, five questions at most, only what they alone can answer: who it is for and the one thing it must do; what it must look or feel like (a reference they like); accounts, keys, money or publishing that are theirs to give; what is out of scope; when to stop and show them. Do not ask what you can decide or find out. If they are away, write the questions to `.sz/progress.md`, take the conservative answer to each, and say which answers were yours.

**Plan:** write `.sz/spec.md`: what the product is, its features in the order they will be built, and for each milestone the claims that will make it done. Each milestone must leave the product working.

**Build milestone by milestone**, each as an M (contract, freeze, build, `sz:verifier`, evidence). After each: commit, add a line to `.sz/progress.md` (what is done, what was decided and why, what is next), and tell the owner in two lines. A later session must be able to continue from the spec and the progress file alone.

## Always

- The project's grain first: its stack, its structure, its design, its tests. Add nothing it does not use unless that is the request.
- Never the owner's own simulator, browser profile, dev-server port or working tree for experiments: a worktree or a clone, the eyes' own simulator, a headless browser.
- Time and tokens are reported at each checkpoint, not enforced: the owner decides when to stop.
- When you stop, say what is proven, what is refuted, what is unchecked. Never "done" for a claim nobody showed.
