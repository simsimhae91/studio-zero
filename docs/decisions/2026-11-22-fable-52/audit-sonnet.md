# Prompt audit of the sz plugin (skills, agents, workflow, hooks, USAGE)

## 1. Scope and target assumptions

- Read-only. I changed nothing and ran nothing. All checks were by reading, `grep -n` and `git blame`.
- In scope: 12 skills and their reference files (including `backend/arms/*` and the `taste` handbooks); 5 agent files; prompt strings and schema `description` fields in `plugin/workflows/build.js` (code comments used only as provenance); text the hooks print; the `USAGE` string in `packages/eyes/src/cli.ts` (lines 38 to 380).
- Claude Fable 5.2 (effort `xhigh` in the owner's sessions) is the target for every skill, the hooks' output, and the `build.js` prompts of planner, designer, builder, fixer, closer and joiner.
- Claude Opus 5.5 is the target for the five agent files (`model: opus`) and the `build.js` prompts of verifier and arbiter.
- Effort in `build.js`: build and fix `high`; plan and verify unset ("as the session"; `DEFAULT_EFFORT`, lines 63-71). Four agents run at `low`: `sweep:design` (457), `close:*` (1038), `join:*` (1117), `stage:*` (1260).
- Provenance: every line blames to 2026-11-15 through 2026-11-21. The only run record on a model, `docs/runs/2026-11-22-toesa-first-pass`, was Opus 5.5 at `xhigh`. Nothing here has been measured on Fable 5.2, so "re-test" means a first measurement.

## 2. The findings that matter most

1. Opposite instructions for the same situation.
   - A frozen claim wrong about what was asked: `work/SKILL.md:57` and `hooks/guard-frozen.mjs:60` say stop and tell the owner. The newer `arbiter.md:19`, `work/SKILL.md:95` and the `build.js` rule path say set it aside and go on (the `build.js` comment: "Two of four runs on one request stopped for the night").
   - After onboarding: `onboard/SKILL.md:36` says "Then stop: onboarding starts no work"; `session-start.sh:7`, `route.mjs:30`, `work/SKILL.md:10` say continue with the request.
   - Fix limits: `work/SKILL.md:63` says "twice at most"; `build.js` and `work/SKILL.md:107` say a claim twice and a milestone four times (rule dated 2026-11-19).
   - Fable 5.2 follows the literal older line, so the run stops where the harness wants it to go on.
2. "Never" rules whose exception is stated elsewhere in the plugin: "never a number you chose" / "never the owner's dev-server port" versus `verify/SKILL.md:39` (use the map's port when nothing listens); "never end whatever holds a port" versus `guard-others.mjs:35` (end a verified leftover); `backend/SKILL.md:42` "never worked around with an example" versus the owner's own words in `work/SKILL.md:93` and `build.js` `REAL`; `work/SKILL.md:123` "never built from a plan that is no longer the spec" versus the same bullet's "let the milestone in progress finish". The Fable 5.2 guidance measured a model under a bare "never" taking an approved step about one try in ten, against nine in ten when the rule carried its go-ahead.
3. The `USAGE` man page is behind the code: it omits `switch` (worth cite lines, `worth.ts:25`), `must` (row kind, `worth.ts:122`) and `thin` (`--ours`, `worth.ts:125`), all of which the worth skill and scout agent instruct agents to use.

Behind these: missing sandbox lines on three agents, unbounded wait loops, several numeric output caps.

## 3. Counts

Findings per group (24 findings, each counted once under its primary group):

| Group | Findings |
|---|---|
| 1a pressure language | 0 (the "never" cases counted under 1e) |
| 1b scaffolds (caps counted under 1f) | 0 |
| 1c over-specification | 1 (F19) |
| 1d fossils | 2 (F17, F18) |
| 1e prohibition clusters | 5 (F6, F7, F8, F9, F20) |
| 1f output-shaping | 1 (F14) |
| 1g ownership | 1 (F16, flag) |
| Group 2 | 10 (F2, F3, F4, F5, F10, F11, F12, F13, F22, F23) |
| Group 3 | 1 (F1) |
| Group 4 | 2 (F21, F24) |
| Keep-list 11 `add` | 1 (F15) |

"Never" counts (occurrences in model-facing text, hand-classified, +/-3):

| Surface | Occurrences |
|---|---|
| skills, agents, handbooks | 168 (handbooks 45) |
| `build.js` strings | 18 (4 more are comments, not counted) |
| hook output | 4 |
| `USAGE` | 20 |
| Total | 210 (186 without hooks and USAGE, matching "about 190") |

| Class | Count | Notes |
|---|---|---|
| (1) absolute boundary with reason beside it | about 145 | keep |
| (2) rule with an exception stated elsewhere | 41 | F6: 8, F7: 7, F8: 2, F9: 1, F12: 22 (handbook layout and type), F20: 1 |
| (3) not an instruction | 24 | |

Five examples of (1): `ship/SKILL.md:18` ("Never yours: deleting or resetting a hosted database…", reason and owner path beside it); `ship/SKILL.md:20` (never ask for a key in the conversation); `agents/scout.md:58` and `skeptic.md:44` (no owner or project name in queries, privacy boundary); `verify/SKILL.md:54` (never run strangers without `--reads-only` on a live address); `work/SKILL.md:77` (never write that they did not answer, incident beside it).

Five examples of (3): `skeptic.md:27` ("common and never in the moment described"); `arbiter.md:17` ("text the claim never mentions"); `user.md:54` (enum `never-asked`); `verifier.md:35` ("an app that had never been built"); `USAGE` "A value found is never printed" (describes tool behaviour).

## 4. Findings

### High

**F1. `USAGE` is behind the code and the skills.**
- **Location:** `packages/eyes/src/cli.ts:184` (`worth cite`) and `:195` (`worth row`).
- **Evidence:** `Lines: who, now, pays, gap, reach, edge, price, runs, does, returns, paid.` and `[--kind stake|edge|more]` ... `[--ours have|lack|not-doing|planned|unknown]`.
- **Pattern:** Group 3 contract/behaviour mismatch; also Group 2 stale fact.
- **Why:** `worth.ts:25` has `switch` in `WORLD_LINES`; `worth.ts:122` has `must` in the kind enum; `worth.ts:125` has `thin` in `ours` and `worth.ts:343` requires `--by` of 8+ characters for `thin`. `worth/SKILL.md:27` and `:81-90` and `scout.md:34` tell agents to use all three.
- **Confidence:** High.
- **Action:** rewrite.
- **Replacement:** `Lines: who, now, pays, gap, switch, reach, edge, price, runs, does, returns, paid (and others, for what a person uses instead).` / `[--kind stake|must|edge|more]` / `[--ours have|thin|lack|not-doing|planned|unknown]` / add to the description: `must is what has to be there whoever else has it; thin needs --by saying what it lacks.`

**F2. A wrong claim: stop, or set aside and go on?**
- **Location:** older (2026-11-15) `skills/work/SKILL.md:57`, `hooks/guard-frozen.mjs:60`; newer `agents/arbiter.md:19` (2026-11-16), `skills/work/SKILL.md:95` (2026-11-16), `workflows/build.js:924-927` and `:949` (2026-11-19).
- **Evidence:** older: "If the contract turns out wrong, stop and say so; it is reopened deliberately"; "if a claim is wrong about what was asked, stop and tell the owner." Newer: "set it aside for them so that the rest of the work is not held up"; "the work goes on".
- **Pattern:** Group 2 conflict; also a stop condition.
- **Why:** two opposite instructions for one condition; the newer is backed by code and by the `build.js` comment about runs that stopped for the night. A session reading `work/SKILL.md:57` stops.
- **Confidence:** High.
- **Action:** rewrite the older two; the newer loosens a stop, so the owner confirms.
- **Replacement** (`work/SKILL.md:57`, last sentence of the Freeze paragraph): "If the contract turns out wrong, do not adjust it to fit what was built. A claim whose own words state a fact about the world that its source gives otherwise is set aside for the owner by the `sz:arbiter` agent (below) and the work goes on; any other wrong claim is reopened deliberately, with the owner."
- **Replacement** (`guard-frozen.mjs:60`, tail): "...If a check it names is wrong about how it checks, the sz:arbiter agent settles that. If a claim states a fact the world gives otherwise, the sz:arbiter agent sets it aside for the owner (`sz-eyes contract dispute`) and the work goes on; if a claim is wrong about what was asked in any other way, stop and tell the owner."

**F3. Onboarding: "Then stop" versus "then handle the request".**
- **Location:** `skills/onboard/SKILL.md:36` (2026-11-15) against `hooks/session-start.sh:7` (2026-11-15), `hooks/route.mjs:30` (2026-11-16), `skills/work/SKILL.md:10`.
- **Evidence:** "Ten lines at most: ... Then stop: onboarding starts no work." Hook: "load the sz:onboard skill and write .sz/map.md ..., then handle the request with the sz:work skill."
- **Pattern:** Group 2 conflict; also a stop condition.
- **Why:** the hooks, newer and fired together with the skill, say to continue. A literal "Then stop" ends the turn before the owner's request.
- **Confidence:** High.
- **Action:** rewrite the older.
- **Replacement:** "Then onboarding is done: it started no work and changed no product code. If it was loaded for a request to build, change or fix something, go on to that request with `sz:work`; otherwise stop here."

**F4. Fix limits: "twice at most" versus twice per claim and four per milestone.**
- **Location:** `skills/work/SKILL.md:63` (2026-11-15) against `workflows/build.js:960-964` and `:973` (2026-11-19) and `skills/work/SKILL.md:107` (2026-11-21).
- **Evidence:** "fix the product and send it back for those; twice at most, then report what stands" versus "A claim is handed to a fixer twice at most and a milestone is mended four times at most".
- **Pattern:** Group 2 conflict. The `build.js` comment: "Until 2026-11-19 a milestone was mended twice".
- **Why:** the older line carries a rule the harness replaced, and is ambiguous between per claim and per milestone.
- **Confidence:** High.
- **Action:** rewrite.
- **Replacement:** "If a claim is refuted or a standing one is found broken, fix the product and send it back for those. A claim is handed to a fixer twice at most and a milestone is mended four times at most (the `sz:build` workflow keeps the same limits); then report what stands."

**F6. "Never a number you chose" / "never the owner's dev-server port", with the exception in `verify`.** Class (2), 8 occurrences.
- **Location:** rules: `work/SKILL.md:118` and `:119`, `agents/verifier.md:46`, `skills/onboard/SKILL.md:19`, `workflows/build.js:52`, `hooks/guard-others.mjs:32`, `cli.ts:285-286`. Exception: `skills/verify/SKILL.md:39` (same date, 2026-11-15).
- **Evidence:** "Never use the owner's own simulator, browser or dev-server port."; "never a number you chose." Against: "use the port the map names only when nothing is listening there".
- **Pattern:** Group 1e, scoped "never".
- **Why:** the map's port is usually the owner's dev-server port. Read as absolute, the rule forbids what `verify` says to do for a product that cannot be told its port. The Fable 5.2 guidance says to write the exception into the rule.
- **Confidence:** High (the plugin itself contradicts the absolute reading).
- **Action:** rewrite.
- **Replacement** (`verifier.md:46`, `work/SKILL.md:118`): "Never the owner's own simulator, browser profile or working tree, and never a dev-server port that something is listening on. The eyes have their own."
- **Replacement** (the "number you chose" clauses): "a port from the machine (`sz-eyes port`), not a number you chose; the one exception is a product that cannot be told its port, which `sz:verify` covers."

### Medium

**F7. "Never end whatever holds a port" versus the hook's leftover procedure.** Class (2), 7 occurrences.
- **Location:** rules: `verify/SKILL.md:39`, `verifier.md:47`, `work/SKILL.md:119`, `build.js:52`, `cli.ts:286`. Exception: `hooks/guard-others.mjs:35`.
- **Evidence:** hook: "If something of yours is left over from before and you no longer have its id, find the one process (`lsof -nP -iTCP:<port> -sTCP:LISTEN`, ...), make sure from its command and folder that it is yours, and end that id."
- **Pattern:** Group 1e, class (2).
- **Why:** the guard's own text describes ending a verified leftover found by its port, contradicting "never by its port" read as absolute.
- **Confidence:** Medium.
- **Action:** rewrite `work/SKILL.md:119`, likewise the other four.
- **Replacement:** "...never whatever holds a port, never everything of a name. If something of yours is left over and you no longer have its id, find the one process, read its command and folder, and end it only when both show it is yours."

**F8. "Never worked around with an example" versus the owner's own words.** Class (2), 2 occurrences.
- **Location:** rules: `skills/backend/SKILL.md:42` (2026-11-17), `cli.ts:252` (`arm need`). Exception: `skills/work/SKILL.md:93`, `build.js:101` and `:175`.
- **Evidence:** "A missing key is never worked around with an example." Exception: "is made an example or left out only on their own word, quoted".
- **Pattern:** Group 1e, class (2); the `USAGE` copy is also behaviour steering inside a tool description (Group 3).
- **Why:** the harness lets the owner allow an example for now; the absolute rule forbids what the plugin allows.
- **Confidence:** Medium.
- **Action:** rewrite `backend/SKILL.md:42`; move the `USAGE` sentence out (the skill already carries it).
- **Replacement:** "A missing key is not worked around with an example unless the owner said, in their own words, that an example will do for now (`sz:work`, section 4)."

**F9. "A milestone is never built from a plan that is no longer the spec."**
- **Location:** `skills/work/SKILL.md:123` (2026-11-16).
- **Evidence:** the same bullet says "let the milestone in progress finish if the change does not touch it (stop it at once if it does)".
- **Pattern:** Group 1e, class (2).
- **Why:** a milestone in progress was planned from the old spec and is built anyway; read as absolute, the model stops it at once.
- **Confidence:** Medium.
- **Action:** rewrite the last sentence.
- **Replacement:** "A milestone is not started from a plan that is no longer the spec. One already in progress finishes only if the change does not touch it."

**F10. The sandbox line for the verifier and stand-in omits `kill` and `ps`.**
- **Location:** `agents/verifier.md:14`, `agents/user.md:14`, `workflows/build.js:40` (`MAYBE_SANDBOX`).
- **Evidence:** the agents name "a browser, a desktop app, a simulator or Docker"; `verify/SKILL.md:13` and `build.js:39` (`IN_SANDBOX`) also name ending or listing a process (`kill`, `ps`).
- **Pattern:** Group 2 stale or incomplete fact; the run record shows the failure reproducing.
- **Why:** `docs/runs/2026-11-22-toesa-first-pass/README.md:111-115` records eight refusals of `kill` or `ps` inside the sandbox, each costing a retry, and says "the line every agent is given about the sandbox now names ending and listing such a process". The agent files and `MAYBE_SANDBOX` did not get that change; the user agent does not load `sz:verify`.
- **Confidence:** Medium.
- **Action:** rewrite.
- **Replacement:** extend the parenthetical in both files to "run every command that opens a browser, a desktop app, a simulator or Docker, and every `kill` or `ps` of a process an earlier command started, outside the sandbox from the first try".

**F11. Scout and skeptic have no sandbox line, though `verify` says `worth cite` runs outside the sandbox.**
- **Location:** `agents/scout.md:31-37`, `agents/skeptic.md:20-30`, `skills/worth/SKILL.md:50-58`, against `skills/verify/SKILL.md:13` (2026-11-16).
- **Evidence:** `verify/SKILL.md:13` lists `sz-eyes worth cite` among commands to run outside the sandbox and says "Tell an agent you start that this session is sandboxed". Grep for "sandbox" in `scout.md`, `skeptic.md`, `worth/SKILL.md` finds nothing.
- **Pattern:** Group 2 conflict: a rule one skill sets that its sibling files never pass on.
- **Why:** scouts run `worth cite` all day; a sandbox refusal would read as `NOT SEEN` and a quotation "counts for nothing" because of the sandbox.
- **Confidence:** Medium.
- **Action:** add.
- **Replacement:** in `scout.md` step 1 and `skeptic.md` step 2: "If you were told the session has a command sandbox, or `sz-eyes` says the sandbox stopped it, run `sz-eyes worth cite` outside it from the first try (`dangerouslyDisableSandbox: true` on the Bash call). A page the sandbox kept you from reading is not `NOT SEEN`: say that the sandbox was the reason." In `worth/SKILL.md` section 2 add: "Tell each scout whether this session is sandboxed."

**F5. Unbounded waits next to a bounded one.**
- **Location:** `workflows/build.js:513` (refs agent: `until [ -e .sz/plan/frame.md ]; do sleep 10; done`); `skills/design/SKILL.md:17-18` (`until [ -e .sz/plan/screens/DONE ] || ...; do sleep 5; done`); `skills/work/SKILL.md:107` (`until sz-eyes contract built ...; do sleep 20; done`). Bounded: `build.js:527`.
- **Evidence:** `build.js:527`: "If either is still not there after twenty minutes, draw nothing and return saying which."
- **Pattern:** Group 2 conflict between two prompts of one stage.
- **Why:** if the planner fails and `frame.md` never appears, the refs agent waits forever and `beside()` waits for it; the designer has a bound, the skill's loop has none; the `work` loop never ends if the run stops before anything is built (needed keys, sandbox, disk).
- **Confidence:** Medium.
- **Action:** rewrite.
- **Replacement** (`build.js:513`): "...(wait for it if it is not there yet: `until [ -e .sz/plan/frame.md ]; do sleep 10; done`). If it is still not there after twenty minutes, write no board and say so under "problem"."
- **Replacement** (`design/SKILL.md:18`): add "If no new file has come in twenty minutes, draw what is there, say which part of the plan is missing when you return, and stop waiting."
- **Replacement** (`work/SKILL.md:107`): add "Stop that wait when the run returns without BUILT."

**F12. Handbook header versus the design skill: how binding the handbook's "never" rules are.** Class (2), 22 occurrences (layout and type lines).
- **Location:** `skills/taste/references/handbook-phone.md:3` and `handbook-web.md:3` (2026-11-15); `skills/design/SKILL.md:70` (2026-11-17); `skills/taste/SKILL.md:28` (2026-11-15).
- **Evidence:** handbooks: "Each rule is a default with its numbers: depart from one only for a reason that comes from this product's subject". Design: "Its rules about type, text, the hand and pictures hold. Its numbers for how a screen is composed are defaults". Lines such as "never a sentence", "never aligns to the end", "never dim text with opacity", "A page is never one column of paragraphs".
- **Pattern:** Group 2 conflict; the 22 type and layout "never"s are class (2); the 23 picture and mark "never"s carry reasons and are class (1).
- **Why:** the newer design skill splits the handbook into binding rules and default numbers; the handbook says everything is a default.
- **Confidence:** Medium.
- **Action:** rewrite the header in both files.
- **Replacement:** "Each number is a default, and so is each rule of layout: depart from one only for a reason that comes from this product's subject, and say so when you finish. The rules about type, text, the hand and pictures (T, C and I) hold as written." (The exact binding rules are for the author to set.)

**F13. Flows first or flows by the verifier, in the same lane M.**
- **Location:** `skills/work/SKILL.md:55` (2026-11-16) against `:87` (2026-11-16), `:90` (2026-11-18), `workflows/build.js:639` (2026-11-18).
- **Evidence:** `:55`: "write it in the project's own format ... before the code: it is the oracle." `:87`: "The flows are written by whoever verifies". `:90`: "Each is an M of 3 to 7 claims, checked as the first pass is: its tests of pure rule written before its code, its flows by whoever verifies." `build.js:639`: "Do not write the flows".
- **Pattern:** Group 2 conflict: an M milestone in the L lane and a standalone M follow different procedures.
- **Why:** the newer rule applies to every workflow milestone and rests on a measured 92-minute loss in a phone milestone whose builder wrote flows first. Whether it also applies to the session's standalone M lane is not recorded.
- **Confidence:** Medium.
- **Action:** rewrite, owner confirming the direction.
- **Replacement** (`work/SKILL.md:55`): "Prefer checks the project already has (its e2e flows, its tests) over new ones. Write first only the tests of what is pure rule, and run each before the code exists and read why it fails. A flow that has to be written is written by whoever verifies the claim, on the product as it stands, in the project's own format and folder, and the contract holds it (`sz-eyes contract add-check`)." Keep the "reaching its last line" and `${name}` rules.

**F14. Numeric ceilings on output.**
- **Location:** `agents/skeptic.md:42` and `agents/scout.md:56` ("In under 250 words"); `skills/worth/hunt.md:36` ("up to 700 words"); `skills/onboard/SKILL.md:36` ("Ten lines at most") and `:30` ("At most 140 lines"); `skills/feedback/SKILL.md:34` ("six lines at most"); `skills/trial/SKILL.md:27` ("in three lines"); `skills/work/SKILL.md:89` and `:103` ("in two lines"); `workflows/build.js:248` ("three sentences at most"), `:268` ("two sentences at most"), `:198`, `:209`, `:218`.
- **Pattern:** Group 1f (hard word caps) and Group 1b ("re-baseline, prefer qualitative length guidance").
- **Why:** caps tuned against older models' padding. The Fable 5.2 guidance says effort barely changes reply length and hard style rules are followed closely enough to make prose choppy; a stated reason does not convert a ceiling into a keeper. What stays: the content lists, the file holding the full report (`hunt.md:11`), and real contract limits (`CLAIM_MOST` 400, `LINE_MOST` 300, `eyesDown` `maxLength`, "four questions at most" = the tool's maximum, the claim counts which are measured, and `feedback/SKILL.md:76` "Forty lines at most" whose reason is beside it).
- **Confidence:** Medium.
- **Action:** rewrite.
- **Replacements:** `skeptic.md:42`: "Keep it short enough to read at a glance: the objections by weight, each in a line; which lines you could not shake and what you tried on each; and, if the case as stated should not be built, whether a narrower one inside it might stand (for whom, on what evidence you saw)." `scout.md:56`: "Keep it short enough to read at a glance: for each line you covered, ..." (rest unchanged). `hunt.md:36`: "What it says back, briefly (the whole report is in its file): candidates, each with the one thing most likely to kill it; **dropped**, a line each with the reason; **not found**." `onboard/SKILL.md:36`: "Report briefly: what the project is, ..." (then F3). `feedback/SKILL.md:34`: "For each thing they said, a few lines:". `build.js:248`: "what was built, briefly"; `:268`: "what you had to do to make it start, briefly; empty if it started as said"; `:198`: "what the product is, for whom, and the shape you chose"; `:209`/`:218`: drop the sentence counts. `work/SKILL.md:89`, `:103`, `trial/SKILL.md:27`: "in two/three lines" becomes "briefly".

**F19. "When in doubt between two lanes, take the smaller one" versus the lane definitions.**
- **Location:** `skills/work/SKILL.md:29` and `:121`, against `:25` and `:27`.
- **Evidence:** "When in doubt between two lanes, take the smaller one". S requires "nothing irreversible"; L is "anything touching data, auth, payment or what cannot be undone".
- **Pattern:** Group 1a ("If in doubt, default to X") with Group 1c strategy coaching.
- **Why:** a literal reading sends an uncertain irreversible change to S, which has no contract and no verifier. Probably deliberate (the owner weighs time); it needs its exception, not removal.
- **Confidence:** Medium.
- **Action:** rewrite.
- **Replacement:** "When in doubt between two lanes, take the smaller one, except where the work might touch data, auth, payment or what cannot be undone: that is L. Say what would make you move up. Move up when you find the work is bigger than it looked; never quietly."

### Low

**F15. Finishing text for the low-effort stages.**
- **Location:** `workflows/build.js:457` (`sweep:design`), `:1038` (`close:*`), `:1117` (`join:*`), `:1260` (`stage:*`), each at `effort('close')` or `effort('join')` = `low`.
- **Pattern:** keep-list 11, finishing text (qualifies for agentic work at `low` or `medium` effort).
- **Why:** multi-step agents (the closer has seven steps) at `low`, where the Fable 5.2 guidance says early stops are most frequent. The repository does not show the behaviour; the run records show no early stop by these agents. Cost per the guidance: about 30% more output tokens. These prompts already have deliberate stops (contract refused, merge conflict, sandbox refusal); the text below keeps them.
- **Confidence:** Low to medium (qualifies only through the low-effort clause).
- **Action:** add.
- **Replacement:** a constant appended to the four prompts:
```
const FINISH = ` Finish the whole job you were given: do not stop while a step of it is still owed, and do not end with a list of what remains or an offer to continue. Nobody is there to answer you; the run goes on from what you return. Ordinary obstacles (an error, a timeout, a locked file, an empty result, a failing command) are yours to diagnose and work through with what you have (wait and retry, fix the command, use another way) before you report one. What a step above tells you to leave alone, or a refusal it names (a contract that will not close, a merge that conflicts, a sandbox refusal), is not an obstacle to work past: do what that step says, say plainly what you found, and go on to the next step.`
```

**F16. The ownership sentence (flag).**
- **Location:** `workflows/build.js:52` (`GROUND`), `:790` (builder), `:982` (fixer).
- **Evidence:** none of these prompts says who owns the code. The comment at `build.js:966-969` records that on 2026-11-22 "two fixers each taught the scrubber the names it was shown"; the prompt at `:979` and `:989` already says "Mend the kind". A scope rule exists: `work/SKILL.md:117`, "Add nothing it does not use unless that is the request".
- **Pattern:** Group 1g, third row with a scope rule present: flag both and name the decision for the user.
- **Why:** the behaviour is adjacent to the documented patching, not a repeated-code finding. The sentence is "You are the owner and long-term maintainer of this codebase, and its design is up to you." Measured cost: restructured in about three quarters of tries, 1.7 to 1.8 times the output tokens, unrequested changes (mostly tests and documentation), and a closing summary that often leaves out small changes. It would suit products the run itself started (mode "new"), not an owner's existing code they want changed minimally.
- **Confidence:** Low.
- **Action:** flag. The user decides which goes, by whether structure should improve.

**F17. The routing line printed on every prompt.**
- **Location:** `hooks/route.mjs:26-31`.
- **Pattern:** Group 1d, re-insertion every turn.
- **Why:** it repeats on every prompt over 5 characters what `session-start.sh:12` already says once. The reason is not retention: `route.mjs:2-5` records a session in which 47 minutes and six requests loaded no skill. That behaviour is unmeasured on Fable 5.2.
- **Confidence:** Low.
- **Action:** flag. Test a Fable 5.2 session with only the SessionStart line for `sz:work` routing; keep the "stages start only when asked" sentence either way.

**F18. A trait claim about vision.**
- **Location:** `skills/verify/SKILL.md:21`, `agents/verifier.md:25`.
- **Evidence:** "A vision model misses most subtle visual defects; do not call a layout right because a screenshot looks fine to you."
- **Pattern:** Group 1d, visual-input scaffolding (flag-only when unpaired).
- **Why:** the Opus 5.5 guidance says it reads screenshots considerably more precisely. The rule "decide from state" still stands for reproducibility, which is separate from the capability claim.
- **Confidence:** Low.
- **Action:** flag, optionally rewrite.
- **Replacement:** "Decide by what can be read exactly: the words on the screen, the controls and their sizes, a flow's steps, a command's exit, a row that was saved. A measurement can be run again and can fail a check; a picture cannot. Pictures are for the owner."

**F20. "Never buy time by dropping a check ... say which you chose."**
- **Location:** `skills/work/SKILL.md:121`.
- **Pattern:** Group 1e, class (2): forbids dropping a check, then allows choosing either.
- **Confidence:** Low.
- **Action:** rewrite.
- **Replacement:** "Never buy time by dropping a check that catches faults: when the two pull apart, keep the check and say what it cost in minutes."

**F21. `max_tokens: 4000` in the arm's request example.**
- **Location:** `skills/backend/arms/read.md:48-49` (`claude-sonnet-5-5`, `max_tokens: 4000`, `effort: 'low'`).
- **Pattern:** Group 4, thinking config and `max_tokens`.
- **Why:** thinking counts toward `max_tokens`. The code degrades safely (`stop_reason !== 'end_turn'` goes to `cannotRead()`), so the cost is wrongly refused reads, not a fault.
- **Confidence:** Low.
- **Action:** flag, or rewrite to `max_tokens: 16000` with the comment "thinking counts toward this".

**F22. Repository-only paths in text meant for other projects.**
- **Location:** `skills/backend/arms/login-google.md:20` and `login-kakao.md:20` (`docs/guides/studio-zero/shared-login-apps.html`, also in the owner steps at `:42` and `:44`); `skills/work/SKILL.md:84` (`docs/runs/2026-11-16-order/`); `skills/backend/SKILL.md:26` (`docs/research/2026-11-15-ship/`).
- **Pattern:** Group 2 volatile specifics. Every path exists in the repository (I checked each).
- **Why:** nothing in `plugin/` carries `docs/`. `tests.md:3` and `sources.md:3` already say "of the harness's repository"; the login files do not. An owner in another project reading "see the table in `docs/guides/...`" gets a dead pointer.
- **Confidence:** Low.
- **Action:** flag. Move the guide into the plugin, or qualify the path as the harness's repository.

**F23. A timing narrative with no consequence for its reader.**
- **Location:** `workflows/build.js:513`.
- **Evidence:** "(Made alone, a board took 10 minutes.)".
- **Pattern:** Group 2 history narrative (not the reason of a constraint: the board agent chooses nothing on its basis).
- **Confidence:** Low.
- **Action:** remove.

**F24. Effort of the pinned-Opus agents is unset.**
- **Location:** `agents/arbiter.md`, `skeptic.md`, `user.md`, `verifier.md` frontmatter. Only `scout.md` sets `effort: high`.
- **Why:** `build.js:54-62` and `work/SKILL.md:107` say verification runs "as hard as the session". With `model: opus` pinned under a Fable 5.2 session, whether the subagent inherits `xhigh` or takes Opus 5.5's default (`medium`, per the migration guide) is not decidable from the repository.
- **Confidence:** Low.
- **Action:** flag. Set `effort:` explicitly in the verifier's frontmatter if inheritance is not guaranteed, since the verifier is "the last door".

## 5. What I checked and found clean, with dispositions

**(a) "Never".** Counts and examples are in section 3.

**(b) Stop conditions.**
- Needed and consistent: `verifier.md:14` and `verify/SKILL.md:15` (stop when the sandbox call is refused; compatible with the `VERDICT.sandbox` schema field); `verifier.md:35` (ten minutes for a product that will not start); `work/SKILL.md:105-106` (a milestone must have run before its verifier gets it); `scout.md:48` and `worth/SKILL.md:58` (stop when no money moves); `user.md:30` (leave after two honest tries); `work/SKILL.md:107` (where the workflow stops, say so; do not edit or resume it; boundary with incident beside it); `stop-owed.mjs:44`; `route.mjs` (a stage starts only on the owner's ask); all `build.js` `stopped` strings (disk, sandbox, design waiting, not-real list).
- Contradicted: `work/SKILL.md:57` and `guard-frozen.mjs:60` (F2); `onboard/SKILL.md:36` (F3).
- Unbounded waits: F5.

**(c) Delegation lines.** Every one is gated by the owner starting a stage or by verification independence: `work/SKILL.md:62`, `:63`, `:88` (up to five verifiers at once, measured 13 to 17 minutes per verification), `:107`; `tend:14`; `ship:46` and `:49`; `worth:50`, `:58`, `:60`, `:98`; `trial:41`; all `build.js` agent calls. None is a general invitation to delegate. Counter-lines: `design/SKILL.md:76`, `build.js:473` and `:525` ("start no other agent"). No rewrite proposed; the subagent tool description is not in the repository.

**(d) Numeric clamps.** F14. Contract and tool limits kept: 400 and 300 characters (the CLI refuses more), `eyesDown` `maxLength`, "four questions at most" (the tool's maximum), the claim counts (measured), and the `owner.md` line limit (reason beside it).

**(e) Stale facts.**
- Every `sz-eyes <area> <command>` named in model-facing text resolves in the `cli.ts` dispatch (`web`, `electron`, `ios`, `contract`, `evidence`, `standing`, `feedback`, `trial`, `worth`, `backlog`, `release`, `migrations`, `secret`, `arm`, `docker`, `supabase`, `login`, `overview`, `port`, `copy`, `refs`, `image`, `sandbox`, `room`, `help`).
- The flags I checked against `USAGE` all exist (`--days-later`, `--clock`, `--wait`, `--reads-only`, `--version-at`, `--with`, `--end`, `--accepted`, `--supersedes`, and others). The one exception is `USAGE` itself (F1).
- The Korean strings `출하` and `점검` in `verifier.md:23` match the contract rendering (`contract.ts:224`).
- `ios hold` is deliberately undocumented ("Not for a person to type").
- Every named path inside the repository exists (`plugin/skills/backend/arms/`, `plugin/bin/sz-eyes`, all `docs/runs`, `docs/research`, `docs/guides` paths, the handbook files). Paths outside the repository (`~/.studio-zero/...`, `node_modules/react-native/...`) were not probed.
- Versions and prices carry their dates in the text.

**(g) Additions per the Fable 5.2 guidance.**
- Finishing text: F15.
- Ownership sentence: F16 (flag).
- Update lines: the repository shows silent long runs (`work/SKILL.md:99` and `:122`), but those lines already exist and `session-start.sh:10` asks for short updates. Nothing to add.
- Report text: no repository evidence of unreadable reports. Not proposed.
- Subagent tool description: not in the repository.
- Token budget shown to the model: none written into any prompt.
- "Treat that answer as done" lines: none.
- Think-less prose, `thinking`/`reasoning` fields in schemas, forced `tool_choice`, assistant prefill: none. The stand-in's per-step log (`--wanted`, `--saw`, `--did`) is a persona record, not a reasoning field.

**Groups 1 and 2 otherwise clean.**
- No caps emphasis (`MUST`, `CRITICAL`, `IMPORTANT`), no `!!`, no "try to" or "if possible" on requirements.
- The tendency claims name failures with dated incidents: `verifier.md:10` and `:44` (2026-11-22, on Opus 5.5), `scout.md:11` (the quotation-from-memory failure is machine-checked by `NOT SEEN`), `skeptic.md:10`.
- The "(2026-11-xx ...)" parentheses I read are mostly the reason of a constraint, not history: `work/SKILL.md:56`, `:75`, `:77`, `:83`, `:87`, `:90`, `:93`, `:97`, `:99`; the `verify/SKILL.md` simulator and iOS entries; the planner's `build.js` rules.
- Frontend design: the handbook's "Nothing by habit" and the "never ... emoji as an icon" lists are named patterns, the form that works on Opus 5.5; keep.
- The trigger phrases in the `worth`, `trial`, `ship`, `tend` and `feedback` descriptions are Korean example phrases for stage-start decisions, not an accreting enumeration.
- The roster of five agents has no redundant specialists.
- Group 4: `build.js` has no `thinking`, `temperature`, `budget_tokens`, prefill, forced-tool or retry shim, and builds no message arrays. I could not verify whether the Workflow runtime offers a command-running primitive; if it does, `join`, `stage` and the mechanical parts of `sweep:design` would be plain code. Noted, not a finding.
