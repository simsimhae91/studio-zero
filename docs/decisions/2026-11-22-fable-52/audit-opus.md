# Prompt audit of the sz plugin (worktree `stop-wording` at `be666dd`)

## 1. Scope and target assumptions

- **What was audited:**
  - `plugin/skills/**`: 12 `SKILL.md` files and 10 reference files.
  - `plugin/agents/*.md`: 5 agent files.
  - `plugin/workflows/build.js`: the prompt strings and the schema `description` fields. Code comments were used only as provenance.
  - The text that `route.mjs`, `session-start.sh`, `stop-owed.mjs` and the four `guard-*.mjs` hooks print back. `hooks.json` and `shell.mjs` print nothing.
  - `USAGE` in `packages/eyes/src/cli.ts:38-380`. I read it against the command dispatch (`cli.ts:442-1400`) and against `worth.ts`, `image.ts` and `release.ts`.
  - I ran nothing.
- **Target models:**
  - Claude Fable 5.2 for the skills, the hook output, and the build.js prompts of the planner, designer, builder, fixer, closer and joiner. Effort is the session's (`xhigh`) for planning; `high` for build, fix and design; `low` for `sweep:design`, `close`, `join` and `stage` (`build.js:64`).
  - Claude Opus 5.5 for the five agent files and the verifier and arbiter prompts (`build.js:844-849, 855-862, 939-952, 1149-1157`).
- **Not audited separately:**
  - `args.model: "sonnet"` can put builders on Sonnet 5.5. I did not audit them against Sonnet 5.5.
  - The ASK prompt in `backend/arms/read.md:38` is product code for Sonnet 5.5. It gets only a Group 4 flag.
- **Not read:** settings files and `.mcp.json`, as the procedure says.
- **Output form:** as asked, each finding carries its replacement text. There is no separate diff.

## 2. The findings that matter most

1. **Three older lines tell the model to stop, or to start a stage, where newer text says the opposite.**
   - `onboard/SKILL.md:36` ends onboarding with "Then stop: onboarding starts no work". But `route.mjs:30`, `session-start.sh:7`, `work/SKILL.md:10` and `build.js:52` all send a build request through onboarding and then on into `sz:work`. Fable 5.2 is documented to stop early on long tasks, so this line is the one most likely to end a turn with the owner's request undone.
   - `build.js:808` tells a builder to put a wrong claim under "blocked". The newer schema text (`build.js:250`, 2026-11-21, written after a run was lost exactly this way) says that anything under "blocked" stops the run, and to leave it empty where the milestone stands.
   - `tend/SKILL.md:22` makes a trial a step of tend. That is the one thing `route.mjs:31` and `trial/SKILL.md:3,10` forbid.
2. **The list of commands to run outside the command sandbox is stale.** `build.js:39` ends "Everything else stays inside", and `verify/SKILL.md:13` says the same. Both were written on 2026-11-16, before `sz-eyes image make`, `image use --size`, the login relay and the Supabase wiring existed. `USAGE` says those must run outside the sandbox. In the owner's sandboxed sessions, the designer is therefore told to keep `image make` inside the sandbox.
3. **Eight "never"s, read as absolute, forbid something the plugin itself wants done.** The weightiest is "A missing key is never worked around with an example" (`backend/SKILL.md:42`, `cli.ts:252`). The workflow's own mechanics accept an example when the owner allowed it in quoted words (`build.js:116, 129, 146`; `work/SKILL.md:93`). The two rules disagree, and only the owner can say which way it goes.

## 3. Counts

| Group | Findings |
|---|---|
| 1a pressure language | 0 |
| 1b scaffolds replaced by API features | 0 |
| 1c over-specification | 0 |
| 1d fossils (Fable 5.2: absolute rules without their exception; approval wording) | 5 (#8, #9, #10, #11, #13) |
| 1e prohibition clusters | 0 |
| 1f output clamps | 4 (#14, #15, #18, #19) |
| 1g who owns the code | 1 (#17) |
| Re-baselining adds (keep-list item 11) | 2 (#16, plus #21 as a flag) |
| 2 brittle configuration (contradictions, stale facts) | 7 (#1, #2, #3, #4, #6, #12, #20); #8 and #11 are also conflicts |
| 3 tool description (`USAGE`) | 2 (#5, #7) |
| 4 request config and architecture | 2 flags (#22, #23) |

Total: 23 findings (15 with a proposed rewrite or add at high or medium confidence, 1 high-confidence flag (#8) that carries proposed text, 7 low-confidence flags).

**"never" in model-facing text:** 210 occurrences. Skills have 145, agents 23, build.js 18 (the other 4 are in code comments), `USAGE` 20, and hook output 4 (`route.mjs` 2, `guard-others.mjs` 1, `guard-paid-image.mjs` 1; the rest are comments).

| Kind | Count |
|---|---|
| (1) A boundary meant to be absolute | 175 |
| (2) Forbids something the plugin wants done elsewhere | 8: `work:119`, `build.js:52`, `guard-others.mjs:32`, `cli.ts:285`, `backend:42`, `cli.ts:252`, `tend:10`, `verifier.md:42` (findings #8 to #11) |
| (3) Not an instruction | 27 |

Per surface: skills 133 / 3 / 9; agents 16 / 1 / 6; build.js 15 / 1 / 2; hook output 3 / 1 / 0; `USAGE` 8 / 2 / 10.

Five examples of kind (1):
- `ship/SKILL.md:18` "**Never yours:** deleting or resetting a hosted database" (`guard-live.mjs` enforces it)
- `design/SKILL.md:36` "never the owner's product name, texts or data"
- `verify/SKILL.md:54` "Never run it without `--reads-only` on an address people are using"
- `verifier.md:47` "never by its port or its name: other projects of the owner's run on this machine"
- `handbook-phone.md:53` "Never from the stock: a mark two products share is nobody's"

Five examples of kind (3):
- `work/SKILL.md:87` "a map that never loaded"
- `verifier.md:35` "an app that had never been built"
- `cli.ts:73` "A value found is never printed"
- `read.md:84` "never used for training without express permission"
- `user.md:54` `never-asked` (an enum value)

Note on the taste handbooks (45 occurrences, all counted as kind 1): their preamble (`handbook-*.md:3`) makes each rule a departable default, but the "never"s sit in rules about type, colour roles, pictures and measured faults that `design/SKILL.md:70` and the `--house` audit treat as fixed, and the composition "never"s (E6) back the owner's rejection of flat screens. I did not class them as kind 2.

## 4. Findings, highest confidence first

**#1. Onboarding stops where the request should go on**
- **Location:** `plugin/skills/onboard/SKILL.md:36`
- **Evidence:** "Then stop: onboarding starts no work."
- **Pattern:** Group 2, files that contradict each other; also a stop condition (b).
- **Why:** `route.mjs:30` (2026-11-16, newer) says "load the sz:onboard skill first ..., then sz:work, and follow them". `session-start.sh:7`, `work/SKILL.md:10` and `build.js:52` say the same. Fable 5.2 stops early on multistep work, so it may take this literally and end the turn after writing the map. The skill's own description also covers "continue, take over". One run went on anyway (`docs/runs/2026-11-15-ship/README.md:80`). No dated note beside the line.
- **Confidence:** high
- **Action:** rewrite (the older line, to match the newer ones)
- **Replacement:** "Then stop if getting to know the project was what was asked: onboarding itself starts no work. When it ran because a request to build, change or fix something came first (a project with no map is onboarded before `sz:work`), go on with that request in `sz:work`."

**#2. A wrong claim is sent to "blocked", which stops the run**
- **Location:** `plugin/workflows/build.js:808`
- **Evidence:** `If a claim is wrong about what was asked, build what you can and say so in "blocked".`
- **Pattern:** Group 2 contradiction inside one prompt; also a stop condition (b).
- **Why:** The `BUILT.blocked` description (`build.js:250`, 2026-11-21, asserted by `build-workflow.test.ts:1025`) says: "Anything written here stops the run before anyone verifies: where the milestone stands, leave it empty, and say what else there is to say ... in the summary". Lines 825-829 stop the run with "could not be built". The 808 clause is from 2026-11-15, so it is the older one. The code comment at `build.js:178-181` (provenance only) records the run of 2026-11-19 that stopped this way.
- **Confidence:** high
- **Action:** rewrite. There is also a flag: `built.summary` is read nowhere after line 789, and the entry at line 1042 does not carry it. The note will only reach anyone if the summary is carried into the log or the entry (a code change, the author's to decide).
- **Replacement:** `' If a claim is wrong about what was asked, build what you can and say which claim and why in "summary", not under "blocked": what is written there stops the run before anyone looks at a milestone that stands.'`

**#3. Tend makes a trial one of its steps**
- **Location:** `plugin/skills/tend/SKILL.md:22`
- **Evidence:** "this step is a trial (`sz:trial`)"
- **Pattern:** Group 2 contradiction.
- **Why:** `route.mjs:31` (2026-11-16, asserted by `ship.test.ts:696`) says "never as a step of something else". `trial/SKILL.md:3` says "nothing else starts one", `trial:10` says "not as a step of other work", and `work/SKILL.md:69` says "Do not start a trial for this". The tend line is from 2026-11-15, the older one. The direction tightens the rule.
- **Confidence:** high
- **Action:** rewrite
- **Replacement:** "   When the question is whether people would pay, or the product is about to ask for money, say in one line of the report that `/sz:trial` would have stand-ins for the people it is for use it the whole way, over several days: a trial starts only when the owner asks for one."

**#4. The outside-the-sandbox list leaves out commands that need it**
- **Location:** `plugin/workflows/build.js:39` (IN_SANDBOX) and `plugin/skills/verify/SKILL.md:13`. `build.js:40` (MAYBE_SANDBOX) defers to the verify list.
- **Evidence:** "Everything else stays inside." and "Starting the product itself, unit tests and everything else stay inside"
- **Pattern:** Group 2, volatile specifics (contradicted by the repository).
- **Why:** `USAGE` says `image make` must "run it outside the session's command sandbox" (`cli.ts:372`). It says `image use --size` "runs outside" (`cli.ts:340`), and that the login relay must run outside (`cli.ts:276-277`); `guard-paid-image.mjs:41` says the same of `image make`. `sz-eyes supabase start` drives Docker and starts the relay. All four arrived on 2026-11-17, after the lists (2026-11-16). The designer is told to start `image make` (`design/SKILL.md:88`, `build.js:525`) while IN_SANDBOX says everything else stays inside. The repository already records this kind of gap: on 2026-11-22, `kill` and `ps` were refused inside eight times in one run (`build-workflow.test.ts:662`).
- **Confidence:** high
- **Action:** rewrite both lists. Keep the `kill`/`ps` sentence, which the test at line 663 asserts.
- **Replacement (build.js:39, the list part):** "every `sz-eyes web`, `sz-eyes electron`, `sz-eyes ios`, `sz-eyes docker` and `sz-eyes supabase` command, `sz-eyes login relay start`, `sz-eyes image make` (codex keeps what it makes in `~/.codex`), `sz-eyes image use` with `--size` (the resize works in the system\'s temporary folder), and the project\'s own flows and tests that open a browser."
- **Replacement (verify:13):** "every `sz-eyes web`, `sz-eyes electron`, `sz-eyes ios`, `sz-eyes docker` and `sz-eyes supabase` command, `sz-eyes login relay start`, `sz-eyes worth cite`, `sz-eyes image make` (codex keeps what it makes in `~/.codex`), `sz-eyes image use` with `--size`, and the project's own flows and tests that open a browser. Starting the product itself (unless that is one of these), unit tests and everything else stay inside;"

**#5. `USAGE` for worth leaves out values the code accepts and the skill uses**
- **Location:** `packages/eyes/src/cli.ts:184` and `cli.ts:195-197`
- **Evidence:** "Lines: who, now, pays, gap, reach, edge, price, runs, does, returns, paid." and `[--kind stake|edge|more]` and `[--ours have|lack|not-doing|planned|unknown]`
- **Pattern:** Group 3, under-described (the contract does not match the behaviour); also a Group 2 stale fact.
- **Why:** The code accepts `switch` (`worth.ts:25`), `must` (`worth.ts:122`) and `thin` (`worth.ts:125`). The skill tells the model to use them (`worth/SKILL.md:78, 82, 91`; `scout.md:33`). An agent that checks the man page finds them missing.
- **Confidence:** high
- **Action:** rewrite. The same stale list is in the error text at `worth.ts:331`, which is outside this scope.
- **Replacement (184):** "... Lines: who, now, pays, gap, switch, reach, edge, price, runs, does, returns, paid."
- **Replacement (195):** `sz-eyes worth row <id> <row-id> [--where "<where along the job>"] [--need "<what a person needs there>"] [--kind stake|must|edge|more] [--has <other-id>=yes|no|?]... [--cite <cN>]... [--ours have|thin|lack|not-doing|planned|unknown] [--by "<the standing claim or picture / what it lacks / why not / which milestone>"]`
- **Replacement (196-197):** "one row of the whole job: who gives it already and whether this product does. A stake is what two or more of the others have, a must what has to be there whoever has it; "have" is shown by a standing claim or a picture, never said, and "thin" says with --by what it lacks"

**#6. The app-icon command in the handbook fails as written**
- **Location:** `plugin/skills/taste/references/handbook-phone.md:53` and `handbook-web.md:56`
- **Evidence:** `` `sz-eyes image make --size 512x512 --kind "app icon" --what "<the product>: <what it shows>" --no-stock` ``
- **Pattern:** Group 2, volatile specifics.
- **Why:** `image.ts:405` refuses `image make` without `--prompt` and `--name`, and `USAGE` (`cli.ts:359`) lists both as required.
- **Confidence:** high
- **Action:** rewrite. The parenthetical about the owner choosing the flat icon is the reason for the rule: keep it.
- **Replacement:** `` `sz-eyes image make --prompt "<the product's object as one flat shape, as below>" --name icon-<n> --size 512x512 --kind "app icon" --what "<the product>: <what it shows>" --no-stock` ``

**#7. The `secret set` example has a form that fails in the owner's own terminal**
- **Location:** `packages/eyes/src/cli.ts:242`
- **Evidence:** "(pbpaste | sz-eyes secret set host/cloudflare/api-token)"
- **Pattern:** Group 3, contract accuracy.
- **Why:** The code comment at `build.js:137-140` records that this exact form answered "command not found" in the owner's shell. Line 250 of the same `USAGE` gives the working form, `! pbpaste | sz-eyes secret set <id>`.
- **Confidence:** high
- **Action:** rewrite
- **Replacement:** "the owner's: puts what comes on stdin in the vault (! pbpaste | sz-eyes secret set host/cloudflare/api-token, typed in this session's prompt: sz-eyes is not on the PATH of their own terminal)"

**#8. "A missing key is never worked around with an example" against the owner-allowed example**
- **Location:** `plugin/skills/backend/SKILL.md:42` and `cli.ts:252`
- **Evidence:** "build nothing that needs the key until it exits 0. A missing key is never worked around with an example."
- **Pattern:** 1d, "never" kind (2); also a Group 2 conflict.
- **Why:** The workflow asks the owner to "give it, or say in their words that it may be an example for now" (`build.js:146`, also `:437`). It lets an entry stand on the owner's quoted words (`NOT_REAL.said` at `:116`, `waitsFor` at `:129`), and `work/SKILL.md:93` agrees. The backend line is 21 minutes newer (`e62bad4`, 2026-11-17 15:38) than that path (`db87a88`, 15:17), and it is the stricter one. Under the procedure, a fix in either direction is the owner's call: loosen the newer prohibition, or remove the owner's-example path from build.js.
- **Confidence:** high (the two rules disagree)
- **Action:** flag. Proposed text, if the owner keeps the example path:
- **Replacement (backend:42):** "... and build nothing that needs the key until it exits 0, or until the owner says in their own words that it may be an example for now (their words go word for word into what the build is given, as `sz:work` says of what is real). A missing key is never worked around with an example on anyone else's word."
- **Replacement (cli.ts:252):** "a missing key is never worked around with an example the owner did not allow in their own words"

**#9. "never a number you chose" leaves out the one case `sz:verify` allows**
- **Location:** `work/SKILL.md:119`, `build.js:52`, `cli.ts:285`, `guard-others.mjs:32`
- **Evidence:** "never a number you chose" and "Never choose a number"
- **Pattern:** 1d, "never" kind (2).
- **Why:** `verify/SKILL.md:39` (same commit, `b36523e`, 2026-11-15) wants a product that cannot be told its port started "on the port the map names only when nothing is listening there". `onboard/SKILL.md:19` plans for that case. The Fable 5.2 guidance is to write the exception into the rule: a separate line does not lift a "never".
- **Confidence:** medium
- **Action:** rewrite
- **Replacement (work:119):** "What you launch gets its port from the machine (`PORT=$(sz-eyes port)`), never a number you chose; a product that cannot be told its port is the one exception, started on the port the map names only when nothing listens there and said as a finding (`sz:verify`). You check that it is yours that answers before you look at it."
- **Replacement (build.js:52):** "... never a number you chose (a product that cannot be told its port is started on the one the map names, only when nothing listens there, and you say so)."
- **Replacement (cli.ts:285-286):** "Never choose a number (a product that cannot be told a port is started on the one its map names, only when nothing listens there), and never end whatever holds a port"
- **Replacement (guard-others.mjs:32):** "# a port from the machine, never a number you chose (sz:verify: a product that cannot be told one)"

**#10. Tend forbids working on what is live, then its step 0 does it**
- **Location:** `plugin/skills/tend/SKILL.md:10`
- **Evidence:** "and on a copy of the data, never on what people are using."
- **Pattern:** 1d, "never" kind (2).
- **Why:** Step 0 (`tend:14`, added five hours later on 2026-11-15) has the verifier run the release's live lines "on the address people reach". `ship:37` and `verifier.md:23` explain why that is allowed.
- **Confidence:** medium
- **Action:** rewrite
- **Replacement:** "... and on a copy of the data. On what people are using, only the live lines of the last release are run, by the `sz:verifier` agent (step 0), and nothing else."

**#11. The verifier's rule against an earlier verdict, against the look after a fix**
- **Location:** `plugin/agents/verifier.md:42`
- **Evidence:** "A claim is never left `proven` on an earlier run."
- **Pattern:** 1d, "never" kind (2); also a Group 2 conflict with `build.js:859`.
- **Why:** At a look after a fix, the verifier is told "Claims you did not look at again keep their verdict: leave them out." (since 2026-11-15; the verifier rule is from 2026-11-18). Read absolutely, the rule pushes an Opus 5.5 verifier to look at every claim again, or to mark it unchecked. That costs the minutes the owner weighs.
- **Confidence:** medium
- **Action:** rewrite. Update the regex at `build-workflow.test.ts:846` (`never left \`proven\``) to `never recorded \`proven\``.
- **Replacement:** "A claim is never recorded `proven` on an earlier run. (At a look after a fix, a claim you did not look at again keeps the verdict the contract has: you record nothing for it.)"

**#12. The `lsof` check is blind inside the sandbox**
- **Location:** `verify/SKILL.md:39` and `guard-others.mjs:35`
- **Evidence:** "(`lsof -nP -iTCP:<port> -sTCP:LISTEN` prints nothing)"
- **Pattern:** Group 2, a volatile environment fact.
- **Why:** In Claude Code's macOS sandbox, a command sees only the processes it started. `lsof` leaves the others out without an error, so "prints nothing" also happens while another project's server listens. The owner's sessions run with the sandbox on. The repository already knows that `ps` and `kill` are refused inside (`verify:13`). The basis is the host's documented sandbox, not the repository, hence medium.
- **Confidence:** medium
- **Action:** rewrite
- **Replacement (verify:39):** "... (`lsof -nP -iTCP:<port> -sTCP:LISTEN` prints nothing; in a session with a command sandbox, run it outside the sandbox: inside, it sees only what that one command started and prints nothing for another project's server)."
- **Replacement (guard-others.mjs:35):** "find the one process (`lsof -nP -iTCP:<port> -sTCP:LISTEN`, `ps -o pid,lstart,command -p <pid>`, both outside the session's command sandbox if it has one: inside, they do not see what an earlier command started), make sure ..."

**#13. "ask before a build" reads as an approval rule**
- **Location:** `verify/SKILL.md:66`
- **Evidence:** "ask before a build that writes many"
- **Pattern:** 1d / Fable 5.2 "Approvals": approval rules are applied as written.
- **Why:** The intended "ask" is "ask the disk", as `build.js:771` says ("run `sz-eyes room`"). Read as an approval, the line holds routine builds for an owner who may not be there.
- **Confidence:** medium
- **Action:** rewrite
- **Replacement:** "gigabytes free on the disk the project is on (first line); run it before a build that writes many"

**#14. Word limits on agents' returns**
- **Location:** `scout.md:56`, `skeptic.md:42`, `worth/hunt.md:36`
- **Evidence:** "In under 250 words" (twice) and "up to 700 words"
- **Pattern:** 1f, numeric output ceilings.
- **Why:** The procedure removes word caps even when they have an operational reason, and re-expresses the goal. The goal here: the record is in the case and in `reports/`, and returns "can arrive cut short" (`hunt.md:11`, a reason, kept). Hunt's 700 is a brief's override of the scout's 250, not a conflict.
- **Confidence:** medium
- **Action:** rewrite
- **Replacement (scout):** "Briefly, since the quotations are in the case and whoever sent you reads several scouts' answers side by side: for each line you covered, ..."
- **Replacement (skeptic):** "Briefly, since your objections and what you weighed are in the case: the objections by weight, ..."
- **Replacement (hunt):** "- What it says back is the short form of its report (the whole of it is in `reports/<ground>.md`): candidates, at most eight, ..."

**#15. Line limits on replies to the owner**
- **Location:** `onboard/SKILL.md:36` and `feedback/SKILL.md:34`
- **Evidence:** "Ten lines at most:" and "six lines at most:"
- **Pattern:** 1f.
- **Why:** These are numeric ceilings on replies written by the Fable session. Fable follows hard style rules closely enough to make prose choppy.
- **Confidence:** medium
- **Action:** rewrite (onboard:36 is the same line as #1; the two replacements combine)
- **Replacement (onboard):** "Short enough to read at a glance: what the project is, ..."
- **Replacement (feedback):** "For each thing they said, these, a line each:"

**#16. The finishing text for the short stages at low effort**
- **Location:** the four `low`-effort prompts: `build.js:443-456` (sweep:design), `:1029-1037` (close), `:1101-1116` (join), `:1248-1259` (stage). The levels are set at `:64`.
- **Evidence:** "effort('close')", "effort('join')"
- **Pattern:** keep-list item 11 (Fable 5.2, "Finish the whole task": agentic work at low effort qualifies).
- **Why:** At low effort the model is more likely to end before the work is done. The run records show no closer skipping a step (each close took a minute), so the owner may decline. In Anthropic's testing the text raised output tokens by about 30%.
- **Confidence:** medium
- **Action:** add a constant and append `${FINISH}` at the end of each of the four prompts.
- **Replacement:** `const FINISH = ' Do every step above before you return: nobody is watching to say "go on", and a step left out is found later by someone else, or not at all. An ordinary obstacle (a command that times out, a file that is locked, an answer that comes back empty) is looked into and worked through: wait and try again, mend the call, or take another way. What was decided as a stop is not worked past (a command the plugin refuses, a call outside the sandbox that is refused, a merge that conflicts, a contract that will not close): say what you found in what you return. This lifts none of the limits above on what you may change.'`

**#17. The ownership sentence for the fixer**
- **Location:** `build.js:982` (fixer)
- **Evidence:** "You are fixing a product so that claims shown false on it become true."
- **Pattern:** 1g, row 3: nothing is said about ownership, and the notes show cases added where a restructure was wanted.
- **Why:** In `docs/runs/2026-11-22-toesa-mend/README.md:78-89`, two fixers each "taught the scrubber the forms it had been shown". There is no rule limiting scope in this prompt. The "mend the kind" line (`build.js:979`) already worked once (README:123-135), but only on a claim handed over a second time. The documented sentence must be adapted because "the owner" in this harness is the human. The measured costs:
  - about 1.7 to 1.8 times the output tokens;
  - changes nobody asked for (tests, documentation);
  - an existing feature's behaviour changed in 1 of every 6 to 10 tries.
  Frozen checks would catch behaviour changes, at the price of another look. Leave the sentence out for a brownfield project the owner wants changed as little as possible.
- **Confidence:** medium
- **Action:** add
- **Replacement:** "You are fixing a product so that claims shown false on it become true. You are the long-term maintainer of this product's code, and its design is up to you ("the owner", here and below, is the person the product is made for)."

**#18. Length caps on files later sessions read (flag)**
- **Location:** `onboard:30`, `feedback:76`, `design/references/handoff.md:28`
- **Evidence:** "At most 140 lines", "Forty lines at most", "ten to twenty-five lines"
- **Pattern:** 1f.
- **Why:** These are numeric caps. But they bound files that every later session loads ("it is read before every build" is a reason), so they act as a context budget more than a reply style.
- **Confidence:** low
- **Action:** flag

**#19. "In N lines" content specifications (flag)**
- **Location:** `work:21, 65, 89, 99, 101, 103, 107`; `trial:27, 64`; `tend:35`; `worth:110`; `backend:17`; `design:68`; `build.js:198, 248, 268`
- **Evidence:** "tell the owner in two lines"
- **Pattern:** 1f.
- **Why:** Most of these name the items the lines hold, so they act as format, not as a ceiling. `BUILT.summary` and `STARTED.summary` are not read after the run (see #2).
- **Confidence:** low
- **Action:** flag; no edit

**#20. The scout is told to start with the money whatever lines it was sent for (flag)**
- **Location:** `scout.md:48` against `worth/SKILL.md:58, 60`
- **Evidence:** "Start with the money. If, after an honest search, nothing ... say so and stop"
- **Pattern:** Group 2 conflict, from the same commit (`b6ee823`).
- **Why:** The skill sends the money scout first and then scouts for `who`/`now`, `gap`/`switch` and `reach`. A reach-only scout is told by its agent file to search money first and to stop if it finds none. History cannot order the two.
- **Confidence:** low
- **Action:** flag. Suggested: "When `pays` is among your lines, start with it: ..."

**#21. Update lines for quiet turns (flag)**
- **Location:** `session-start.sh:10`, `work:99, 101, 122`
- **Evidence:** "the short lines while work is under way included"
- **Pattern:** keep-list item 11 (Fable 5.2 update lines).
- **Why:** The repository shows the behaviour once, on 2026-11-16 (`docs/runs/2026-11-16-first-app/README.md:15, 35`). Targeted lines were written after it, and no later record shows a quiet stretch. Whether the session renders `display: "updates"` is the host's setting, not the plugin's.
- **Confidence:** low
- **Action:** flag; add Fable's update text (b) only if it happens again.

**#22. Opus 5.5 verifiers and arbiters inherit the session's `xhigh` (flag)**
- **Location:** `build.js:64-71`, with `effort('verify')` at `:848, 862, 952, 1156`
- **Evidence:** "DEFAULT_EFFORT = { build: 'high', close: 'low', join: 'low' }"
- **Pattern:** Group 4, effort sized for the model.
- **Why:** The migration guide says Opus 5.5 defaults to `medium` and to reserve `xhigh` for measured gains, with longer turns there. The repository's measurement (`docs/runs/2026-11-16-speed`, cited in the comment at `build.js:55-58`) was on builders. This is the owner's decision.
- **Confidence:** low
- **Action:** flag (measure first)

**#23. The read-arm template's `max_tokens` (flag)**
- **Location:** `backend/arms/read.md:48-49`
- **Evidence:** "max_tokens: 4000" with "effort: 'low'"
- **Pattern:** Group 4, `max_tokens` sized without room for thinking.
- **Why:** On Sonnet 5.5, thinking counts toward `max_tokens`. A long estimate can stop at the limit and be reported as unreadable. The fallback is graceful (`cannotRead`). This is product code, not plugin prompt text.
- **Confidence:** low
- **Action:** flag

## 5. What I checked and found clean

- **Group 1:** no shouted emphasis (`MUST`, `NEVER` and the like), no hedges on requirements, no think-less or scratchpad lines, no reasoning fields in the schemas (structured output through `schema` throughout), no retired model names (only the `opus`/`sonnet` aliases), no anti-formatting rules.
- **Agent files:** they describe their failure modes ("Agents that verify tend to go wrong ..."). These are kept: the incidents at `verifier.md:43-44` show them on the target. The taste handbook names the specific defaults to avoid, which is the form that works.
- **Dated parentheticals:** every one I read next to a rule gives that rule's cause, so I counted it as a reason. None was narrative only.
- **Paths:** every path named exists (`docs/runs/2026-11-16-order`, `docs/research/2026-11-15-ship`, `docs/guides/studio-zero/shared-login-apps.html`, `docs/research/2026-11-16-worth/{korea-sources,real-tests-korea}.md`, `plugin/skills/backend/arms/`).
- **Commands and flags:** every `sz-eyes` command and flag named in the skills, agents, build.js and hooks is defined in the `cli.ts` dispatch. The only gaps are #5, #6 and #7. The gate lines `rc-strangers`, `rc-shape`, `rc-data` and `rc-stands` exist in `release.ts`, and `--days-later` is at `cli.ts:687`. The prices and model IDs in `read.md` match the claude-api reference.
- **Overrides, not conflicts:**
  - `design/SKILL.md:70` names the handbook it overrides.
  - `work:55` (an M builder writes flows first) and `work:90` (L milestones: the verifier writes them) are separated by lane.
  - The wait protocol in `whenToUse` repeats `work:107` on purpose; `build-workflow.test.ts:992` asserts both.
  - `route.mjs` prints on every prompt, but it is routing text with a demonstrated cause (its comment: no sz skill loaded in the owner's first real use).
- **Stop conditions (b):** all are needed and uncontradicted except #1 and #2. Each of these was checked against the other instructions in its prompt or skill: work:27, 57, 63, 79, 93, 105, 107, 123; verify:15, 73, 87; build.js:170, 327, 331, 527, 640, 771, 783, 810, 989, 1111, 1133, 1256; worth:58; verifier.md:14, 35; user.md:30; arbiter.md:19, 24; stop-owed.mjs:44 (said once per list, never a loop); guard-frozen.mjs:60; ship:46, 50. The scope point in #20 is separate. `build.js:645` ("Do not stop to report in between") does not conflict with the `UNREAL` stop at `:170`: it is about progress reports.
- **Delegation (c):** every line that starts an agent is structural, because independence is what the owner pays for. That covers the arbiter (work:16, 61, 95), the verifier and up to five verifiers (work:63, 88; tend:14; ship:46, 49), the user, scout and skeptic agents (trial:41; worth:50, 58, 60, 98; hunt.md), and the workflow on the owner's word (work:107: "Tell the owner it will use many agents"). The design stage forbids helpers (`design:76`, `build.js:473, 525, 551`). No line invites delegation in general, and the workflow journals show no builder starting agents. The Agent tool's description is Claude Code's, so no description is proposed.
- **What the Fable 5.2 guidance says to add (g):**
  - Finishing text: qualifies for the low-effort stages (#16).
  - Ownership sentence: the repository shows the behaviour (#17).
  - Update lines: shown once, already answered by targeted lines (#21).
  - Report text: the repository shows no unreadable reports, so it is not proposed.
  - Subagent tool description: not shown, and not the plugin's, so not proposed.
- **Group 4:** the five agents are distinct. The mechanical stages are agents because "A workflow script runs no command and reads no file" (`docs/runs/2026-11-22-room-and-evidence/README.md:10`), and they already run at `low`. The plugin makes no API calls of its own. Cost is accounted (`evidence --took`, and dollar figures in the run records).
