# Depth: what makes a product feel production-level, and how an agent plans and audits it

Research for the harness, 2026-11-16. Each source is marked with how it was read:

- **[F]** fetched and read today
- **[S]** seen only in search-result text; the page was not opened
- **[L]** read today in a file installed on this machine
- **[R]** recalled, not checked today

## 1. Findings

### 1.1 Job map and outcome-driven innovation

Strategyn gives the eight steps verbatim [F] (https://strategyn.com/jobs-to-be-done/customer-centered-innovation-map/):

1. **Define**: "Determine their goals and plan resources."
2. **Locate**: "Gather items and information needed to do the job."
3. **Prepare**: "Set up the environment to do the job."
4. **Confirm**: "Verify that they're ready to perform the job."
5. **Execute**: "Carry out the job."
6. **Monitor**: "Assess whether the job is being successfully executed."
7. **Modify**: "Make alterations to improve execution."
8. **Conclude**: "Finish the job or prepare to repeat it."

The source is Bettencourt and Ulwick, HBR, May 2008. Only the introduction is readable without a subscription (https://hbr.org/2008/05/the-customer-centered-innovation-map) [F].

How the map is used:
- At each step, look for "the biggest drawbacks of current solutions". Judge them by "speed of execution, variability, and the quality of output".
- Write outcomes in the form "minimize the time it takes to…" [S].
- Score each one as **Opportunity = Importance + (Importance − Satisfaction)**, both measured as top-two-box percentages. A market has "100-plus outcomes" (https://strategyn.com/quantify-your-customers-unmet-needs) [F].

Depth is measured per outcome, not per feature. Ulwick's "consumption chain" [R] (buy, set up, learn, maintain, dispose) is, in software, accounts, onboarding, export and deletion.

### 1.2 Kano

The categories (https://foldingburritos.com/blog/kano-model/) [F]:

| Category | What it means |
|---|---|
| Must-be | Absence dissatisfies; presence adds nothing. |
| One-dimensional | More is better. |
| Attractive | Unexpected delight. |
| Indifferent | Users don't care either way. |
| Reverse | Users prefer it absent. |

Each feature is classified from a pair of questions, one about having it and one about not having it, read through an evaluation table. The original paper is Kano et al., 1984 [R]. Categories decay over time: "Attractive features turn into Performance and Must-be features as time goes by" [F].

Can reviews do the classifying? Only weakly, and worst on must-be:
- Binder et al. (2023) reached 0.928 accuracy in cross-validation but **0.725 on an independent set of 1,622 app reviews**. They name "an inherent problem of missing information about the context in app reviews" (https://www.emergentmind.com/papers/2303.03798) [F].
- Alamoudi et al. (IEEE REW 2022) found "attractive app aspects better than must-be and one-dimensional aspects" (https://pure.kfupm.edu.sa/en/publications/extracting-attractive-app-aspects-from-app-reviews-using-clusteri/) [F].

So use how common a feature is among competitors as the must-be signal. Use 1–2★ "missing" or "broken" complaints only to confirm it.

### 1.3 Teardown and parity

Keller, Sternthal and Tybout (HBR 2002) [R] split a brand's claims in two:
- **Points of parity**: category parity is what a product needs to be considered at all; competitive parity neutralises a rival's edge.
- **Points of difference**: what sets the product apart.

Parity is "a necessary evil, but… not sufficient" (https://mixpanel.com/blog/points-of-parity-vs-points-of-difference/) [S]. Practitioner guides (https://www.productboard.com/glossary/competitor-analysis/) [S] record:
- a capability × competitor grid, with *maturity* rather than yes/no;
- how common each capability is across competitors;
- "every competitor strong, you absent" as a critical gap.

BMAD's installed competitive pack [L] adds: "changelog and release notes are roadmap truth"; "their customers' 1–3★ reviews are your wedge"; "sales-facing comparison pages overclaim".

One signal the guides miss: **the paywall shows what the market already charges for.**
- MyFitnessPal Premium is "Faster calorie counting with barcode scan, meal scan & voice logging" (https://apps.apple.com/us/app/myfitnesspal-calorie-counter/id341232718) [F].
- Lose It! Premium includes Photo Meal Logging, AI Voice, Barcode Scanner and Fitness App Syncs (https://apps.apple.com/us/app/lose-it-calorie-counter/id297368629) [F].

### 1.4 Features versus bloat

**Thompson, Hamilton and Rust, "Feature Fatigue", JMR 42(4), 2005.** Consumers weight capability before use and usability after it. This held even when participants picked every feature themselves. The authors conclude that "choosing the number of features that maximizes the consumers' initial choice means including too many features", which lowers customer lifetime value (https://acawiki.org/Feature_Fatigue:_When_Product_Capabilities_Become_Too_Much_of_a_Good_Thing) [F]. In-store, "66 percent preferred the model with the most features"; after use, "56 percent preferred a simpler model" (https://www.rhsmith.umd.edu/news/feature-fatigue-research-proves-simpler-products-are-better-manufacturers-advised-lose-extra) [F]. The detail that participants picked about 20 of 25 features is recalled and unverified [R].

**Meyer, Zhao and Han, Marketing Science 27(6), 2008.** Players showed "high willingness to pay for a new version" but "fail to fully exercise the option to use these controls after purchase" (https://econpapers.repec.org/RePEc:inm:ormksc:v:27:y:2008:i:6:p:1083-1096) [F].

**Mukherjee and Hoyer, JCR 28(3), 2001.** Novel attributes help "only in the case of low-complexity products". For complex products, adding them "can actually reduce product evaluation" (https://ideas.repec.org/a/oup/jconrs/v28y2001i3p462-72.html) [F].

**Gill, Journal of Marketing 72(2), 2008.** A utilitarian base gains more from a *hedonic* addition than from another utilitarian one (https://www.scinapse.io/papers/1988648456) [S].

**Pendo, 2019.** Across 615 B2B subscriptions over three months, "80 percent of features… are rarely or never used", and "12% of features generate 80% of average daily usage volume" (https://www.pendo.io/resources/the-2019-feature-adoption-report/) [F].

Do not cite the Standish "64%": "four internal applications. No commercial products" (https://www.mountaingoatsoftware.com/blog/are-64-of-features-really-rarely-or-never-used) [F].

**Verdict.** The owner is right about the moment of purchase and wrong about use, which is where satisfaction and retention are decided. Cal AI shows this. It does one thing, photo to calories, and reached "over 15 million downloads and over $30 million in annual revenue in under two years". MyFitnessPal bought it in March 2026, and its CEO said: "Cal AI is for those preferring speed over accuracy" (https://techcrunch.com/2026/03/02/myfitnesspal-has-acquired-cal-ai-the-viral-calorie-app-built-by-teens) [F]. These figures come from the company and were not audited.

### 1.5 Retention, with diet apps as the worked example

**Day 1 / 7 / 30 retention by category** (OneSignal 2024, via https://getstream.io/blog/app-retention-guide) [F]:

| Category | D1 | D7 | D30 |
|---|---|---|---|
| Health & Fitness | 28% | 18.13% | 8.48% |
| Productivity | 32.86% | 24.23% | 9.63% |
| Games | 32.22% | 18.08% | 7.67% |
| Lifestyle | 25% | 13.13% | 5.94% |

Phiture and Braze put it near 3–4% (https://phiture.com/mobilegrowthstack/managing-retention-rate-benchmarks-and-expectations/, https://www.braze.com/resources/articles/mobile-app-retention) [S]; treat D30 as 3–9%.

**Six-month retention, good versus great** (https://www.lennysnewsletter.com/p/what-is-good-retention-issue-29) [F]:

| Category | Good | Great |
|---|---|---|
| Consumer social | ~25% | ~45% |
| Consumer transactional | ~30% | ~50% |
| Consumer SaaS | ~40% | ~70% |

**RevenueCat 2025** (https://www.revenuecat.com/state-of-subscription-apps-2025/) [F]:
- Health & Fitness trial-to-paid conversion: median 39.9%, top decile 68.3%.
- Revenue per install at 60 days: $0.63, against $0.31 for all apps.
- Subscribers retained after one year (all apps): 44.1% on annual plans, 17.0% on monthly plans.
- Health & Fitness refund rate: 4.71%.

**What makes people return:**
- **Stored value.** "Every time users input data, they create stored value" (https://www.nirandfar.com/makeyourusersdothework/) [F].
- **Streaks.** Duolingo: "learners who reach a streak of 7 are 2.4 times more likely to continue using Duolingo the next day". Separating the streak from the daily goal raised day-14 retention by 3.3% in relative terms (https://blog.duolingo.com/improving-the-streak/) [F]. The often-quoted "3.6×" has no primary source.
- **Social stakes.** In the DietBet study (Leahey and Rosen 2014, nearly 40,000 players), winners "lost an average of 4.9 percent… and won an average of $59 in four weeks". Winning was associated with "betting more money, sharing on Facebook… more weigh ins, and… more social interactions" (https://eurekalert.org/news-releases/591353) [F]. The intention-to-treat loss was 2.6% [S]. The study is observational.
- **Competitions.** Apple Watch competitions run 7 days and award the winner a medal unique to that pairing (https://www.macrumors.com/how-to/start-an-activity-competition-in-watchos-5/) [S].

**What diet-app listings offer in 2025–26** [F]:
- **MyFitnessPal** (4.7★, 2.4M ratings):
  - 20.5M+ foods
  - GLP-1 logging, water, workouts and steps
  - a meal planner
  - barcode, photo and voice logging
  - an AI Coach
  - 40+ connected trackers

  Its release notes fix edges such as copying foods "from another day" and "deleted logs that reappeared".
- **Lose It!** (4.8★, 785K ratings): photo, voice and barcode logging; groups; sync with HealthKit and devices.
- **MacroFactor** (https://macrofactor.com/annual-report-2025/):
  - photo logging (April 2025)
  - Favorites "with your preferred serving sizes"
  - an Apple Watch app with voice logging
  - recipe import from a URL
  - an adaptive expenditure algorithm

  It grew from 185k to 400k users between September 2024 and September 2025.

**Table stakes:** several *fast* ways to log (search, barcode, photo, voice, favourites, copy yesterday); a large food database; adaptive goals; a weight trend; health-platform sync; history that builds up. **Each leader's edge:** speed (Cal AI), the algorithm (MacroFactor), breadth (MyFitnessPal), money stakes (DietBet).

### 1.6 States: demo versus product

- **Hurff's UI stack** covers five states: ideal, empty, error, partial and loading. His rule: "Your product shouldn't undo, destroy, or delete anything entered or uploaded by your customer in the event of an error" (https://www.scotthurff.com/posts/why-your-user-interface-is-awkward-youre-ignoring-the-ui-stack/) [F].
- **NN/g on empty states:** they show status, teach, and give "direct pathways for getting started with key tasks" (https://www.nngroup.com/articles/empty-state-interface-design/) [F].
- **Apple 5.1.1(v):** apps that create accounts "must also let people initiate deletion of their account within the app", and deactivation alone "is insufficient" (https://developer.apple.com/help/app-review/guideline-reference/5-1-1-account-deletion) [F].
- **Google Play** requires deletion both in the app and through a web link (https://support.google.com/googleplay/android-developer/answer/13327111) [S].

**The state list a verifier should cover:** first use (timed to first value); empty, one item, many (two years of logs); slow and offline; errors with recovery and no data lost; edit, undo and delete of every record; settings (units, time zone, reminders); account (reset, sign-out, second device); paywall (trial, lapsed, restore) [R]; export; delete; notifications (opt-in, quiet hours); return after a lapse.

### 1.7 Criticism of AI app builders

- **Osmani:** the last 30% is "Error handling, edge cases, performance optimization, security hardening, accessibility". He adds that "AI excels at prototypes where the 70% is sufficient" (https://addyosmani.com/agentic-engineering/the-70-percent-problem/) [F].
- **Replit's CEO, January 2026:** "Everything kind of looks the same, all the images, all the code, everything" (https://venturebeat.com/infrastructure/why-ai-feels-generic-replit-ceo-on-slop-toys-and-the-missing-ingredient-of) [F].
- **Six vibe-coded codebases** (https://dev.to/jsgurujobs/i-reviewed-6-vibe-coded-codebases-here-is-what-i-found-m0o) [F]:
  - "Every error returned the same generic message".
  - Four of the six skipped per-resource authorization.
  - A declined card gave "No retry option".
- **Lovable, CVE-2025-48757:** 170 of 1,645 showcase apps had 303 endpoints that anyone could read or write (https://www.superblocks.com/blog/lovable-vulnerabilities) [S].
- **Same-brief tests:** "no tool wrote meaningful tests" (https://dev.to/nishilbhave/replit-agent-vs-bolt-vs-lovable-2026-honest-tests-1kjg) [S].

I found no rigorous study of the *feature depth* of AI-built apps; most criticism comes from vendors who sell fixes. The pattern: happy path only, a generic look, dead or unsaved interactions, weak authorization, no tests. My inference: nobody judges scope against competitors, because these builders never look at any.

### 1.8 Spec-driven workflows

- **Spec Kit** (https://github.com/github/spec-kit/blob/main/spec-driven.md) [F] says "Focus on WHAT users need and WHY". It uses "[NEEDS CLARIFICATION]" markers and requires "No speculative or 'might need' features", which works against breadth by design.
- **Kiro's** `requirements.md` "captures user stories, acceptance criteria, or bug analysis" (https://kiro.dev/docs/specs/) [F].
- **Böckeler, October 2025** (https://martinfowler.com/articles/exploring-gen-ai/sdd-3-tools.html) [F]:
  - In Kiro, one bug fix became "4 'user stories' with a total of 16 acceptance criteria".
  - Spec Kit produced "a LOT of markdown files".
  - The agent did "not follow all the instructions".
- **BMAD** alone looks outward. Its optional "Competitive teardown of named competitors" feeds the brief [L], as prose that nothing later checks against the product.

All three make *what was asked* precise. None decides *what should be asked*.

## A. Depth-audit method

1. **Write the job:** verb + object + context. For example: "win a 30-day weight-loss bet against friends without anyone cheating". Split lists that mix several jobs.
2. **Pick the reference class (4–5):**
   - the paid leader
   - the fastest-growing challenger
   - the product most people use for this exact job
   - one non-software substitute, such as a group chat of scale photos or a spreadsheet
   - the top Korean store result for the job

   For a diet battle: DietBet, Lose It!, MyFitnessPal, Cal AI, Apple Fitness competitions, a weigh-in chat.
3. **Build the rows from six generators:**
   - the eight job steps
   - the consumption chain: discover, sign up, onboard, pay, help, export, delete
   - time: day 1, day 7, day 30, and the return after a lapse
   - alone, with a rival, in a group, with strangers
   - data in and out: manual entry, device or HealthKit, import, export
   - every capability any reference advertises

   Each row cites a job step and a URL.
4. **Fill each cell** as absent, basic or deep, with tier, URL and date. Sources:
   - the store description, screenshots and What's New
   - the pricing page and what sits behind the paywall
   - the help-centre index, the best public proxy for depth
   - 1–2★ reviews, newest first, as the must-be signal
   - 5★ reviews, as the attractive signal

   A hands-on trial beats marketing copy.
5. **Mark our product.** "Have" means a verifier claim passed. A row is **deep** only when all of these hold:
   - it works on real persisted data
   - it passes the §1.6 states
   - edit, undo and delete work
   - it matches the best reference on measured time or taps
   - it feeds another row

   Every "not doing" row needs a reason.
6. **Save the table** in the repo, grouped by job step, with each row's class and owning milestone.

## B. Table stakes, edge, bloat

**Table stakes** meet any one of these:
- at least 3 of 5 references have it, or every paid one does
- leaders' 1–2★ reviews say it is missing or broken
- a platform or the law requires it: deletion, a privacy policy, restore purchases

Build table stakes plainly, to parity; going beyond parity adds nothing.

**The edge** is one outcome, at most two, taken from the step that is high in importance and low in satisfaction. Write it as a measured comparison. For example: "a verified weigh-in in under 20 s that an old photo cannot fake, against DietBet's code word plus a human referee". It must be hard to copy. If it does not beat every reference on a stated number, it is not an edge.

**Bloat** is any of these:
- a row with no job step
- a row fewer than 2 references have and no review asks for
- a second path to an outcome that already has one, unless the references make it table stakes or it is measurably faster (several input modes are table stakes in diet apps)
- a delighter built before the table stakes are deep
- a feature whose states can't be built within budget, because shallow features cost usability (§1.4)

**Delighters** come only after the edge and the table stakes, and only on the core loop. A win/lose animation at *Conclude* qualifies: it is a cheap hedonic addition (Gill). Generic tips are probably indifferent; that is my judgment, not verified.

## C. Milestones

**M1 proves the edge end to end, with real accounts:**
1. Create a battle.
2. Invite a friend.
3. Both do verified baseline weigh-ins.
4. One fast daily input.
5. Standings.
6. Verified final weigh-in.
7. Result and rematch.

The edge is a measured claim.

**Later milestones each make one cluster deep, in this order:**
1. Loop-blocking table stakes: photo or barcode logging, favourites, HealthKit weight.
2. Accumulating value: history, trend, streak, reminders.
3. Social: groups, ranking, matchmaking.
4. The consumption chain: paywall, export, deletion.
5. Delighters.

**Rules for every milestone:**
- A row is never "done" at basic; it is either deep or labelled a stub.
- Each milestone updates the table and reports "table stakes deep: x/y".
- Earlier claims still pass, so every milestone leaves a working product.

## D. Deep enough to charge

All of these must hold:
1. Every table-stakes row is at least basic, and 80% or more are deep. No row flagged in 1–2★ reviews is missing.
2. The edge claim beats the best reference's number.
3. **30-day replay.** A persona is driven through days 1, 2, 7 and 30 on seeded or time-shifted data. It sees accumulated value and hits no dead end.
4. Every core screen passes the §1.6 states.
5. Sign-up, reset, purchase and restore, export, and deletion all work.
6. Everything behind our paywall is something a reference already charges for.
7. **Switch test.** An independent agent given the references' store pages names a reason other than price to switch, and that reason is the edge.

Once live, compare trial-to-paid conversion with the 39.9% median for Health & Fitness.

## E. What should change in the design

1. **Replace the five questions with a researched depth table as the scope artifact.** The owner gives three things: the job sentence, who they'd compete with, and which candidate edge they believe. They then review a table, not a blank page.
2. **Your position is wrong that competitor feature pages yield the table stakes.** Feature pages overclaim and lead with delighters. Take table stakes from three sources instead:
   - how common a capability is across the reference class
   - what sits behind each paywall
   - 1–2★ complaints

   Release notes and help-centre indexes reveal the edges. Do not classify with Kano inferred from reviews: one study scored 0.725 out of sample, and another found it weakest on must-be.
3. **"Depth is not feature count" is right but incomplete.** A row counts only when it is deep: its states, edit/undo/delete, speed parity with the best reference, real data, and feeding another row. Put this rubric into every claim so the verifier rejects one-page features.
4. **The owner is half right; design for both halves.** Breadth sells at purchase: 66% chose the most-featured model, and willingness to pay rises with features. Usability rules after use: 56% then preferred the simpler model, and new features go unused. So show breadth on the store page and in the paywall list, and keep the daily loop to one fast screen, as MyFitnessPal and Lose It! do.
5. **Pick the job before the features.** The diet-battle list mixes three jobs. For "compete", the true references are DietBet and Apple Fitness competitions. Photo calories and HealthKit are already table stakes: MyFitnessPal, Lose It!, MacroFactor and Cal AI all have them. The edge lies in honest verification and the battle loop. Tips and recommendations come later.
6. **M1 proves the edge; each later milestone makes one cluster deep.** Ban "basic" rows from claims unless they are labelled stubs. This stops "finished in two pages" at the root.
7. **Add a 30-day replay to the verifier.** Accumulated value (streaks, history, rankings) is invisible in a one-session demo. Retention, and the feeling of thinness, turn on it.
8. **Make the consumption chain a fixed checklist for every product with accounts.** It covers deletion (Apple 5.1.1(v), Google Play), export, password reset, restore purchases, and the empty, error and offline states. It is cheap, and it is exactly where AI builders are criticised.
9. **Do not adopt Spec Kit or Kiro for depth.** They tighten correctness and by design forbid speculative scope. Keep the contract of claims, and derive the claims from the table's rows.
10. **Write the edge into the contract as a competitive number:** "beats the best reference by X on metric Y". The verifier measures our side. The reference side comes from the audit, measured by hand or estimated from a public demo video, and flagged as such.

**Not verified today:** HBR full texts (paywalled); Thompson et al.'s "20 of 25"; the Gill paper (search text only); Apple's competition rules; the full DietBet paper (CAPTCHA); Fast Company's "vibe coding hangover" (403); Cal AI's figures (company and acquirer only); D30 benchmarks, which disagree by 2–3×.
