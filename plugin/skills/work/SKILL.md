---
name: work
description: Use for any request to build, change or fix something in a project (a feature, a bug, a screen, a whole product). Sizes the work, agrees what "done" means as a contract before building, has it proven on the running product by an agent that did not build it, and hands the owner one page of evidence.
---

# Work: as much process as the task deserves, and proof at the end

Process costs time and tokens, and a harness can cost twenty times what the same model costs alone. It is worth that only where the model alone would not reliably get it right. So the first decision of every request is how much it deserves.

If the project has no `.sz/map.md`, onboard first (`sz:onboard`). Read the map, the last lines of `.sz/progress.md`, and `.sz/owner.md` if there is one (what this owner has said they want) before anything else.

## What already stands

A product that has been worked on before keeps promises: `sz-eyes standing` lists every claim earlier work proved. Your change keeps them true, whatever its lane. If a check from earlier work fails after your change, the product is wrong, not the check. There are two exceptions, and both are said out loud:

- The check names something your change deliberately renamed or moved. The `sz:arbiter` agent corrects how it checks, never what it checks.
- What the owner now asks means an old claim should no longer be true. The new contract says which and why (`--supersedes`), before it is frozen; the owner reads that on the evidence page.

## 1. Size it (the lane)

Decide in a few seconds, from the request and the map. Say the lane and why in one line.

| Lane | When | What happens |
|---|---|---|
| **S** | A few files. No new screen, no new API, no schema, no money, nothing irreversible. | Do it. Run the nearest check. If a screen changed, show it before and after. No contract file. |
| **M** | One feature, or a bug whose cause is not yet known. | A contract of 3 to 7 claims, frozen. Build. One verification by `sz:verifier`. An evidence page. |
| **L** | Several features, a new product, or anything touching data, auth, payment or what cannot be undone. | Ask the owner first. A spec and milestones. Each milestone is an M. Progress is written down as it goes. |

When in doubt between two lanes, take the smaller one and say what would make you move up. Move up when you find the work is bigger than it looked; never quietly.

## 2. S: do it and show it

In this order, because a picture of "before" cannot be taken afterwards:

1. If anything a person sees will change, look at it as it is now, in the state the request is about (`sz-eyes web look|do` / `sz-eyes electron look|do` / `sz-eyes ios look`, by the command the map gives; see `sz:verify`), with `--out .sz/evidence/quick/<date>-<a few words>/ --name before`.
2. Make the change the way the project makes such changes. Find the cause; do not paper over the symptom.
3. Run the type check and the project's checks: all of them when the map says they are quick. A small change is where an old promise breaks unnoticed.
4. Look again in the same state, same size, `--name after`, into the same folder. Read the state off the look (the words, the figure), not off the picture.

Report in a few lines: the cause, what changed, what was run and what it said (the figures before and after), where the two pictures are, what was not checked, and anything you decided that the owner might have decided otherwise. What you noticed and did not do goes to the backlog (`sz-eyes backlog add "<it>" --from "<this change>"`), and a line of the backlog that this change ended is ticked (`sz-eyes backlog done "<some of its words>" --by "<the commit>"`). Add a line to `.sz/progress.md`. Done: no contract, no verifier.

## 3. M: contract, build, proof

**Write the contract** before any code:

```
sz-eyes contract new <id> --lane M --request "<the request, in the owner's words>" --target <web|ios|...> \
  --claim "<claim id>|<what will be true, as the owner would say it and could see it>|<flow|test|look|command|owner>:<how it is shown>" ... \
  --not "<what is deliberately not done>" --risk "<what could go wrong>" \
  [--supersedes "<contract>/<claim>|<what the owner asked that changes it>"]
```

A claim is something that will be true of the running product and can be shown: "긴 닉네임이 잘리지 않고 다 보인다", not "ellipsis 처리를 고친다". Each says how it will be shown: a flow file that will be run, a test command, a look at a named screen in a named state, a command. What earlier work proved is not restated: it stands, and the verifier shows it again. Name with `--supersedes` only the standing claims this request deliberately changes, and rewrite their checks before the freeze. If the change alters the shape of what is stored, one claim says that what was saved before it is still there after it, shown by a test that starts from data in the old shape: the product carries over what exists, and nobody is asked to delete their data. What only a person can judge (is it pleasant, is it fun) is a claim shown by `owner`, and stays theirs.

Prefer checks the project already has (its e2e flows, its tests) over new ones. Where a flow has to be written, write it in the project's own format (Maestro YAML, a Playwright test), in the project's own folder, before the code: it is the oracle. Run each new check before the code exists and read why it fails: one that already passes, or that fails for another reason than the thing not being there yet, proves nothing once the code is written. A claim that something cannot be done (another person cannot change my record) is shown beside one that it can (I can change mine): where the feature does not exist yet, "cannot" is true for free. A flow passes only by reaching its last line: one that dies half-way must not end as if it had passed (in the first product made here, a shell flow that died while printing its own failure ended with 0, so a failure would have counted as a pass; it stood that way through six milestones before anyone saw it). In a shell flow write `${name}` with its braces wherever text follows it: macOS's own bash reads the first byte of a Korean particle into the variable's name (`"$ID를"`). A flow starts a server of its own only when it is not handed one: given `SZ_URL=<address>` it runs against that address, because the same flows are run later on the version that is about to be released.

**Freeze it:** `sz-eyes contract freeze <id> --frozen <each flow or test the claims point at>`. From here you do not edit the contract, and you do not edit the frozen files. If the contract turns out wrong, stop and say so; it is reopened deliberately, not adjusted to fit what was built.

**Build.** Follow the project's own rules (the map lists them). Run its checks as you go.

**If a frozen check is itself wrong** (a quoting error, a selector that names nothing: it fails for a reason that is not the product), do not edit it and do not work around it. Start the `sz:arbiter` agent with the contract id, the file and exactly what is wrong. It decides whether the check or the product is wrong, corrects only how the check checks, and records the correction in the contract. Then carry on.

**Have it proven.** Start the `sz:verifier` agent with the contract id and nothing of your own opinion: not "it works", not what you tested. It operates the product and records a verdict for each claim, then shows again what stood before this work. If a claim is refuted or a standing one is found broken, fix the product and send it back for those; twice at most, then report what stands.

**Evidence:** `sz-eyes evidence <id> --took "<time and tokens if known>"` writes `.sz/evidence/<id>/report.html`. Show the owner the path and the verdict in one line each, and what is unchecked. For a claim that waits for their judgement, say in one line what to look at and where (the address of the running product, or the picture); when they answer, in any words, record it with `sz-eyes contract judged <id> <claim> --verdict yes|no --said "<their words>"` (it works after the close). Then `sz-eyes contract close <id>` (it writes what the verifier noticed and what could not be checked to `.sz/backlog.md`, and from here its proven claims stand), tick each line of `sz-eyes backlog` that this work ended and a proven claim or a commit shows (`sz-eyes backlog done "<some of its words>" --by "<contract>/<claim>"`; a line half done stays open), and add a line to `.sz/progress.md`. If the change made a line of `.sz/map.md` or `.sz/spec.md` false, correct that line.

## 4. L: ask, plan, then milestones

**A request to charge for the product, or to make it "production", is first a question of whether a person would pay.** Plan what makes it worth paying for (what a person cannot yet get to, has no reason to come back for) before the plumbing that takes the money, and put the payment itself last. Do not start a trial for this: say in one line that `/sz:trial` would have stand-ins use it and show what stands between a person and paying, and go on with what was asked.

**If the owner had a case made for this service** (`.sz/worth/`, by `sz:worth`, which runs only when they ask for it), the plan is cut from its rows: the edge first, then the stakes. Without one, plan as below; do not make a case, and do not propose one, unless they ask whether the thing is worth building.

**Ask the owner first**, three questions at most, each one a choice they can tap: with the AskUserQuestion tool when the session has it (two to four answers to a question, the one you would take put first and marked as recommended; they can always write their own), otherwise as a numbered list they can answer with a digit. Ask only where the product forks and only they can say which way: what a person keeps between visits (an account with their history, or nothing beyond this browser); where it lives (a page people reach from a search, or an app on the phone); a key, money or publishing that is theirs to give. Each answer says in a line what a person gets and what it costs (a milestone more, a key of theirs, a store account), and a limit you already know is said in the question, not found out later ("measuring the box with the camera needs a native app; typing the three sides works everywhere"). Decide the rest yourself and show it in the plan, where they can strike a line: who it is for, the look, what is left out, when you stop. Do not ask what you can decide or find out.

This step is not skipped because a command came next. `/sz:build` typed right after a request is the owner choosing how it is built, not telling you to go on without questions: ask, then start the workflow with `asked: "owner"` and what they chose, word for word, in `answers`. It does not start until it is told whether they were asked. (A session went straight from the request to the workflow with answers it had written itself: no accounts, nothing kept, a static page. The owner found out from the spec and asked where the questions had been. The same day another builder put three tappable questions to them for the same request; they answered all three, and chose accounts and saved history.)

They are away only when they said to go on without them, or when nobody is in the session to answer (`asked: "away"`). Then write the questions to `.sz/progress.md`, take the conservative answer to each, and say which answers were yours. A question you did not put to them was not asked: never write that they did not answer it (a session wrote exactly that in the spec of a product, and the owner had to correct it).

**Plan:** write `.sz/spec.md`: what the product is, its features in the order they will be built, and for each milestone the claims that will make it done. Each milestone must leave the product working. In a product that already has a spec, a large request extends it: the spec is amended to describe the product as it will be, new milestones are added after the ones that are closed, and nothing that stands is planned again.

**Show the plan before the first milestone, in one screen, and go on without waiting.** What a person will be able to do, a line each; the milestones in order with the number of claims in each; what is deliberately not built; and how long to expect: from this project's own `.sz/progress.md` when milestones were closed in it before, otherwise, for a web product, about 20 minutes a milestone in the workflow and about 35 in a session at the highest effort (measured 2026-11-16; a phone app's first build adds its own). They can strike or add a line while it is being built. (An owner who had been told nothing wrote, with the second milestone closing, that it had already run an hour and 21 minutes.)

**Say which way it will be built, in one line, before the first milestone.** There are two, and the second starts only by the owner's own command, so they have to be told it exists: here in the session, one milestone at a time, with a report after each (what happens unless they say otherwise); or the `sz:build` workflow, which they start with `/sz:build`, where agents build and verify to the end without them, milestones that do not stand on each other are built side by side when they ask for it, and each stage thinks only as hard as it needs (the session builds every milestone at its own setting). Say it once, in their language ("세션 안에서 하나씩 짓고 마일스톤마다 보여 드립니다. 끝까지 맡기거나 나란히 짓게 하려면 `/sz:build 이어서`"), and go on without waiting for an answer. (An owner who meant to try the workflow found the session already building: a plain request had gone straight here and nothing had said there was another way.)

**Build milestone by milestone**, each as an M (contract, freeze, build, `sz:verifier`, evidence). After each: commit, add a line to `.sz/progress.md` (what is done, what was decided and why, what is next), and tell the owner in two lines. A later session must be able to continue from the spec and the progress file alone.

**Unattended, to the end:** when the owner has answered and asks for it to run without them (or says to use a workflow), start the saved workflow `sz:build` with the Workflow tool, `args: { request: "<their words>", answers: "<what they answered, or the conservative answers you took, marked as yours>" }`. It writes the spec, then builds, verifies, fixes and closes its milestones, and stops rather than build on a milestone that is known to be broken. Milestones follow one another by default. Where the plan finds some that do not stand on each other (never the first, never one that changes the shape of what is stored or who may do what), it builds those at the same time, each in a folder of its own (a git worktree under `.sz/trees/`), brings them into the project's folder, and has every claim that stands shown again on the product as joined before anything is built on it. This has not yet been run for real, so a line is what happens unless asked: pass `side: 3` (or 2) in `args` when the owner asks for milestones to be built side by side. How hard each stage thinks is set in the workflow (the plan and the verification as hard as the session, building at "high", the mechanical stages at "low"); `args.effort` overrides it when the owner says so. Started again in a project whose `.sz/spec.md` exists, it continues from where the files say the work stands, or, when the request asks for more than the spec has, extends the spec with new milestones; it does not plan again what is done. Tell the owner it will use many agents before you start it. When it returns, report milestone by milestone: proven, refuted, unchecked, where each evidence page is, and where it stopped if it did.

## 5. After it is built

Putting it where people reach it is `sz:ship`: the place, the rehearsal, the release gate, proof on what answers there, and the way back. What a new product stands on (where it runs, what holds its accounts and its data) is chosen with `sz:backend`.

A product is not finished when its first version is. What the owner says about it is handled with `sz:feedback` (make it concrete, say what you think, show before and after, keep what it taught). The regular look at a product that lives (does what was proven still hold, what fails for people, what to do next) is `sz:tend`. What is known and not done is in `.sz/backlog.md`: the next work is picked from there, not from nowhere.

## Always

- The project's grain first: its stack, its structure, its design, its tests. Add nothing it does not use unless that is the request.
- Never the owner's own simulator, browser profile, dev-server port or working tree for experiments: a worktree or a clone, the eyes' own simulator, a headless browser.
- The machine is shared with the owner's other work. What you launch gets its port from the machine (`PORT=$(sz-eyes port)`), never a number you chose, and you check that it is yours that answers before you look at it. You end only what you started, by the id you kept (`pid=$!` ... `kill $pid`; a container or simulator by its own name): never whatever holds a port, never everything of a name. A port that is taken is somebody else's server; take another. The plugin refuses the commands that do otherwise.
- If the session has a command sandbox, what opens a browser, a desktop app, a simulator or Docker is run outside it from the first try, and an agent you start is told so (`sz:verify` says how). What the sandbox stopped is said to the owner as that, never as a failure of the product.
- Time is a cost the owner weighs, second only to getting it right. Spend it where it buys proof and nowhere else: take the smaller lane when in doubt; start what does not depend on something else beside it (a long check in the background while you look at a screen, the verifier while you write the map's correction); launch the product once and ask it everything, not once for each question; do not run again what did not change; do not wait where nothing is being waited for. Never buy time by dropping a check that catches faults: when the two pull apart, say which you chose.
- Time and tokens are reported at each checkpoint, not enforced: the owner decides when to stop. The evidence page says where the minutes of a piece of work went (agreeing, building, proving, closing): when one part is out of proportion, say so and why.
- When you stop, say what is proven, what is refuted, what is unchecked. Never "done" for a claim nobody showed.
