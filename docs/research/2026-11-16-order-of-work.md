# In what order a product is built, shown and checked: cases

Research note, 2026-11-16. The owner's two runs that day (a web product: one page after 3 h 01 min; a phone
app: nothing to look at after 4 h) led them to ask for the process to be re-made if it had to be, and then:
"사례를 찾아보되 소신을 가지고 진행". Four readers (Opus) read primary sources the same evening. This note keeps
what they found that bears on the decisions; `docs/decisions/2026-11-16.md` section 9 says what was decided.

**Tags.** Quotations are as the readers returned them from pages fetched that day. [P] = the author's or the
company's own page. [3] = a third party. Not read = named by a source and not opened. Page texts the readers
saved: the session scratchpad under `order-research/` and `lra-web/` (not kept in the repository).

---

## 1. What is built and shown first: methods and their cases

The methods disagree, and each has a case behind it.

**The whole thing thin, first**
- Jeff Patton, story mapping [P] https://www.jpattonassociates.com/the-new-backlog/ (2008): the top row of the
  map is "the smallest possible system you could build that would give you end to end functionality… I always
  try to build this first." "We're slowly building up the system not a feature at a time, but rather by
  building up all major features a little at a time. That way we never release a car without brakes."
- Harlan Mills via Brooks, "No Silver Bullet" (1986): "the system should first be made to run, even though it
  does nothing useful except call the proper set of dummy subprograms. Then, bit-by-bit it is fleshed out."
  "One always has, at every stage in the process, a working system."
- Cockburn, walking skeleton [P, archived] (2008): "a tiny implementation of the system that performs a small
  end-to-end function… it should link together the main architectural components." It is "permanent code,
  built with production coding habits, regression tests".
- Polygon Treehouse (the game Röki) [P] (2017): "At the beginning of the project we went wide", the whole game
  in grey boxes, then a polished slice. Their warning: viewers of the grey version "may very well assume that
  it is indicative of the final quality of the game."

**One piece deep, first**
- Basecamp, Shape Up [P] https://basecamp.com/shapeup/3.2-chapter-11 : "make something tangible and demoable
  early… integrating vertically on one small piece of the project instead of chipping away at the horizontal
  layers." The failure it names: "Lots of things are done but nothing is really done." The first piece is
  core, small and novel; the rest is stubbed. It also concedes: "Sometimes we need to see all the features
  working as a whole to judge what we can live without".
- 37signals, Getting Real [P]: "With Basecamp, we started with just the messages section. We knew that was the
  heart of the app so we ignored milestones, to-do lists, and other items for the time being."
- Valve, Half-Life [P] (1999): after a year of broad work, "There were some really wonderful individual
  pieces, but as a whole the game just wasn't working." One level made deep for a month became the vision.
- Volition [P, GDC 2015]: "We did the whole shotgun approach and developed wide, not deep"; the lesson,
  "Develop Deep. Not Wide". Their caveat on a slice: it "doesn't do a good job of telling how much work there
  is when you scale up".

**How finished the first thing must look**
- GV design sprint [P]: "If the quality is too low, people won't believe the prototype is a real product. If
  the quality is too high, you'll be working all night and you won't finish."
- Volition: a vertical slice is "Representative of final quality".
- Shape Up, against: "Beautiful alignment, colors, and typography don't matter on the first pass."

**How much to prove before anyone sees it**
- Heavy: Freeman & Pryce [P, draft]: "Starting with build, deployment and test on a non-existent system
  sounds odd, but we think it's essential."
- Light, by phase: Kent Beck [P] https://newsletter.kentbeck.com/p/to-test-or-not-to-test-thats-a-good :
  "When I started Max I didn't have any automated tests for the first month… After I got the first few
  subscribers I went back and wrote tests for the existing functionality." "Applying the approach from one
  phase to an idea in another phase kills ideas."

Not confirmed in a primary source: "make it work, make it right, make it fast" as Beck's.

## 2. What the products that build whole apps do

From their own documentation and announcements (2025 to 2026).

| Product | Shown first | Order of the build | How it is checked | A phone app |
|---|---|---|---|---|
| Replit Agent | a design ("under two minutes", front end only) or the app ("About 10 minutes for complete apps") | the whole app in one build; later requests as parallel tasks, conflicts resolved by sub-agents (Agent 4) | a testing sub-agent in a real browser, for web apps | web preview by default, Expo Go by QR code, the native build at Publish |
| Lovable | the whole first version, "a few minutes" | one pass; its guide: "Keeping your first version free of logins and databases" | tests it writes for rules; browser testing "conservative by default" | web apps only |
| v0 | questions when needed, then a preview | one pass, then follow-up prompts | the agent opens the app, takes screenshots | web only |
| Bolt.new | a running preview | one pass | "autonomous debugging" (claim) | Expo Go by QR code; the native build is the person's, outside Bolt |
| Base44 | questions, a plan, and "4 working previews of your app's main screen to choose between" | "starts with your app's first screen, then builds the rest", 10 to 15 minutes | a background check for errors | a web view wrapped at store time |
| Bubble | questions, a blueprint | "in one pass" | the person clicks through | a simulated device in the browser |
| Firebase Studio | a blueprint, then a preview | the UI first; "Firestore and Auth are not in the initial app blueprint" | a "Fix Error" prompt | being shut down |

None builds slice by slice with a check after each slice. None makes a native build while building.

What third parties report of the first versions [3]: "Lovable's map is not a map"; a two-factor option that was
"a front-end shell"; "The agent specifically told me it has fixed the issue … but again no changes were done";
in one four-way comparison Replit's was the most complete and its automated UI testing was about 75% of its
cost. Replit names the fault itself [P]: "Potemkin interfaces… Event handlers are missing, the data is mocked,
and links go nowhere."

## 3. What teams that run coding agents for hours report

**What they agree on**
- Left alone, the builder overreaches and then says it is done. Anthropic [P, 2025-11-26]: "attempt to
  one-shot the app"; a later session "would look around, see that progress had been made, and declare the job
  done." Cursor [P, 2026-02-05]: "frequently stopped to proclaim success despite being far from it."
- "Done" is written down outside the model, in checkable units (a feature list, acceptance criteria per
  milestone, a "sprint contract").
- The running product is checked as a user would use it. Anthropic: unit tests and curl "would fail recognize
  that the feature didn't work end-to-end"; a browser "dramatically improved performance."
- A separate checker with a fresh context finds more than the builder. Cognition [P, 2026-04-22]: "even on
  PRs written by Devin, Devin Review catches an average of 2 bugs per PR, of which roughly 58% are severe",
  best "when the coding and review agents do not share any context." The checker fails too: Anthropic
  [P, 2026-03-24]: "identify legitimate issues, then talk itself into deciding they weren't a big deal".
- Harness is removed as models improve. Anthropic: "every component in a harness encodes an assumption about
  what the model can't do on its own."

**How often the check runs: the direction of travel**
- Anthropic's own harness for building applications [P]
  https://www.anthropic.com/engineering/harness-design-long-running-apps (2026-03-24): first, sprints, each
  with a contract agreed before code and an evaluator clicking through the running app. With a newer model
  "the sprints were removed", the builder "ran coherently for over two hours without the sprint
  decomposition", and the evaluator moved to "a single pass at the end of the run": "for tasks within that
  boundary, the evaluator became unnecessary overhead… It is worth the cost when the task sits beyond what the
  current model does reliably solo." That run: 3 h 50 min; build rounds of 2 h 07, 1 h 02 and 11 min; three
  checks of 7 to 10 minutes each. The check at the end still found that "several core DAW features are
  display-only".
- Cursor [P, 2026-02-05]: requiring "100% correctness before every single commit… caused major
  serialization"; they accept "some error rate" and a final pass. The judge "was removed."
- OpenAI [P, 2026-02-11]: "minimal blocking merge gates… corrections are cheap, and waiting is expensive."
- The other way: Carlini's compiler [P, 2026-02-05] tightened its checks late, because "Claude started to
  frequently break existing functionality each time it implemented a new feature".

**Several builders at once**
- For: Cursor (hundreds of workers, one branch), Replit Agent 4 ("resolve merge conflicts automatically 90%
  of the time"), Carlini (16 agents on independent failing tests).
- Against, for coupled work: Cognition, "writes stay single-threaded" and "Our original observations still
  hold today for parallel-writer swarms"; Factory, "Serial execution with targeted parallelization has worked
  better than broad parallelism"; Anthropic's research-system post, "most coding tasks involve fewer truly
  parallelizable tasks than research".

**The person**
- OpenAI [P, 2026-09-11]: "A requirement to stop for review after the first implementation will pull the
  model toward an earlier stopping point".
- Cursor [P, 2026-02-26]: agents return "something quickly reviewable: logs, video recordings, and live
  previews rather than diffs."
- Claude Code documentation [P]: "you find out the next morning that it spent the whole night building on the
  wrong assumption"; "watch the first few runs of anything new before trusting it unattended."

**Heavy specification up front** [3]: Scott Logic measured a spec-first toolkit at about ten times the time of
small increments each checked at once; Thoughtworks: "I'd rather review code than all these markdown files."

## 4. Where a phone app is looked at while it is built (Expo, React Native)

- Expo [P, 2026-11]: a development build is "Intended for production projects"; Expo Go is "a playground
  app". Expo Go "cannot be used for local development and testing of OAuth or OpenID Connect-enabled apps"
  (no custom scheme). So Expo Go is not a way to look at a product that signs people in through other
  services.
- The web target is "first-class"; React Native for Web's own table lists the keyboard, the status bar and
  KeyboardAvoidingView as mocks, and Expo Router "disables automatic safe-area measurements on web".
  Modules without a web version: SecureStore, notifications; SQLite needs WebAssembly and headers.
- Bluesky (one codebase for web, iOS and Android) [P]: native setup "is NOT required when developing for
  web"; "After you do `pnpm ios` and `pnpm android` once, you can later just run `pnpm web`".
- For flows, Expo's own guide: "A release build includes the JavaScript bundle, so tests do not need a
  running development server." A new bundle can be put into an existing build ("repack"): on one large app
  about 23 minutes of native build against about 5.
- Maestro on iOS: `back` is "supported only on Android and Web"; `clearState` "causes Maestro to reinstall
  the entire app".
- Against waiting: Expo advises development builds "from as early on as possible, instead of starting off
  with Expo Go and having to make a switch later." No source gives a rule for when to first build natively
  when the app already runs in a browser.

Measured here the same evening, on a copy of the owner's app: the web export took 19 seconds and a look 3;
it needed `react-native-web` installed and the fonts loaded at start.
