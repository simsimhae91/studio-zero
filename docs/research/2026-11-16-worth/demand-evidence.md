# Demand evidence: what public traces predict that people will pay

Research note, 2026-11-16. Question: without interviewing anyone, what observable public evidence best predicts that people will pay for a small software service, and how can an agent with search and page fetching find it?

**Tags.** [F] = fetched and read today from the primary source. [F2] = fetched today, but a secondary source. [S] = seen only in search-result summaries, page not opened or blocked. [R] = recalled, not verified today. One caveat matters for the design: my fetch tool returns excerpts extracted by a model, not raw HTML. I did not compare the quotes below byte for byte against the pages. That is exactly the gap that mechanical re-fetching has to close.

---

## Findings by topic

**1. Sales Safari and 30x500.** Hoy: "Write down pain points, beliefs, worldviews, complaints, questions, struggles, products, desires" for "10, 20, 30 hours", then "Organize it, distill it, label the patterns." Her buying test: "They need it, but do they want it?… Do they just bitch and never buy? You can tell, by studying them." [F] https://stackingthebricks.com/how-do-you-create-a-product-people-want-to-buy/. Pain has a first, "obvious" level and a second level: "why is this even being talked about? what's the core here?" [F] https://stackingthebricks.com/vintage-sales-safari-in-action/. As taught, the ingredients are "Pain, Jargon, Recommendations". The places to look ("watering holes") include "product reviews (Amazon...)" [F2] https://egghead.io/learn/30x500/sales-safari. Commoncog adds Worldview [F2] https://commoncog.com/speedrunning-the-skill-of-demand/. Hillman: "the answers come from how people behave, even (especially) when you're not in room asking questions" [F] https://stackingthebricks.com/validation-is-backwards/. **I could not verify how pains are ranked.** That sits in the paid course. Publicly there is only "label the patterns" plus the buying test. "Recommendations" (what people tell each other to use) is the documented route to what they already pay for.

**2. Jobs to be Done, demand side.** "The push is the problem with the current situation… The pull is the magnetism of the new way… Anxiety is the fear of the unknown… Habit is the comfortable inertia", and a switch happens when "Push + Pull > Anxiety + Habit" [F] https://jobstobedone.org/the-four-forces/. The struggling moment is "this isn't working, and I need to do something about it". It ends in a switch, in more searching, or in nothing, because "The options are too expensive, too complicated, not available, or they don't know what to look for" [F] https://jobstobedone.org/the-struggling-moment/. A switch interview is "a forensic, backward walk through a real purchase" with people who switched in the last 30–90 days [F] https://jobstobedone.org/switch-interview/. Event 2 on the timeline "often has a deadline quality" [F] https://jobstobedone.org/the-timeline/. Klement's coffee-and-kale framing [R]; his interview on Medium returned 403.

*What public text can show:* push (complaints that name a circumstance), pull (praise for an alternative), anxiety (fears in "should I switch" threads), habit ("we still use Excel because…"), deadline events. Capterra reviews have "Switched from", "Alternatives considered" and "Reasons for choosing" fields [S], but Capterra returned 403 to fetch and curl, and a Cloudflare check to a real browser today [F]. *What it cannot show:* one person's whole timeline, and the people who stay silent.

**3. The Mom Test.** As recorded on Goodreads [F2] https://www.goodreads.com/work/quotes/26235307: "The world's most deadly fluff is: 'I would definitely buy that.'" "They're always more positive, excited, and willing to pay in the imagined future than they are once it arrives." "Ask about specifics in the past instead of generics or opinions about the future." "Rule of thumb: People stop lying when you ask them for money." "That person is a complainer, not a customer." "Some problems don't actually matter." Summaries give commitment three currencies: time, reputation and money [S].

*Rules for public text:*
- Future tense weighs zero.
- Count only past specifics: what they did, when, at what cost.
- For every complaint, find what they already tried. If nothing, it is a complainer.
- Commitment you can see in public: a price they paid, a workaround they built and shared, a tool they defend under their own name.

**4. Reviews, markets, search, pre-sales.**
- **Reviews.** Copywriters mine reviews for the customer's own words [S] https://copyhackers.com/write-copy-amazon-review-mining/. In a study of Amazon reviews, extreme ratings were judged less helpful for experience goods [S] Mudambi & Schuff 2010, https://papers.ssrn.com/abstract=2175066. So read 2–3 star reviews first. G2, Capterra and Medium returned 403 to my plain curl today. The Wayback Machine held a 2020 copy of a G2 page and none of the Capterra page [F].
- **Paid substitutes.** A Kmong gig selling cafe-post automation shows "총 거래 건수 14,146건", "리뷰 (94)", from ₩25,000 a month [F] https://kmong.com/gig/204990. The same page shows a trap: the demand is real, but the job may break a platform's rules.
- **Charts.** Apple's legacy feed still returns Korea's top-grossing apps by genre. The productivity top 5 today: ChatGPT, Claude, Gemini, Grok, Gmail [F] `itunes.apple.com/kr/rss/topgrossingapplications/limit=5/genre=6007/json`. RevenueCat (75,000 apps): median download-to-paid is 12.11% with a hard paywall and 2.18% with freemium, and "nearly 20% of new apps reach $1,000 in revenue and 5% reach $10,000 within two years" [F] https://www.revenuecat.com/state-of-subscription-apps-2025.
- **Search.** Google Trends is normalized to 0–100 [S] https://support.google.com/trends/answer/4365533. "네이버 데이터랩 API의 숫자는 검색 횟수가 아니라 상대 지수입니다" [F2] https://www.digitalmarketer.co.kr/insights/naver-datalab-api-data-for-non-developers. Absolute counts need the 검색광고 키워드도구, which requires an ad account [S]. McKenzie matched pages to the exact queries teachers typed [S] https://www.kalzumeus.com/2006/07/14/the-long-tail-of-search.
- **Smoke tests.** At Buffer, only "a small number of people were clicking on paid plans" on the pricing page, and the first payment came "within 4 days of launching" [F] https://buffer.com/resources/idea-to-paying-customers-in-7-weeks-how-we-did-it. A fake-door test "will still overestimate actual conversion rates"; in one case about 500 people on a waitlist led to about 60 purchases [F] https://www.revenuecat.com/blog/growth/customer-validation-subscription-app. Across 28 studies, the "median ratio of hypothetical to actual value [was] only 1.35", strongly right-skewed [F] https://econpapers.repec.org/RePEc:kap:enreec:v:30:y:2005:i:3:p:313-325.
- **Crowdfunding.** About 40% of Kickstarter projects succeed overall; the Web subcategory was near 8% in one analysis [S]. Crowdfunding is weak evidence for software.

**5. Y Combinator guidance and post-mortems.** Graham: avoid "made-up" or "sitcom" ideas; pick "something a small number of people want a large amount"; ask "who wants this right now?" [F] https://www.paulgraham.com/startupideas.html. Friedman's questions include "How Acute Is This Problem?", "Is There a Proxy for Your Idea?" and "Did This Only Recently Become Possible or Necessary?". He holds that "the presence of competitors is usually a good sign" and warns of tar-pit ideas [F2] https://www.mit.edu/~edchen93/posts/how-to-get-and-evaluate-startup-ideas/. YC's own page renders only through JavaScript. CB Insights (March 2026) studied 431 shutdowns: poor product-market fit 43%, bad timing 29%, unit economics 19%; running out of capital (70%) is the final cause, not the root [F] https://www.cbinsights.com/research/report/startup-failure-reasons-top/. Failory: "the biggest problem by far is lack of product-market fit" [F] https://www.failory.com/blog/startup-failure-rate. The indie failures had attention and no payment: 300+ signups led to 3 paying users; about 6,000 visits from Hacker News led to $0 [S] https://www.indiehackers.com/post/300-waitlist-signups-launched-march-12-and-only-3-paying-users-where-is-our-gtm-failing-808aec814d.

**6. AI validators and LLM research.** ValidatorAI takes an idea, an "ideal customer" and a problem, and returns a score. A "Customer Feedback Simulator" generates "realistic customer reactions". The page makes no claim that results cite sources [F] https://validatorai.com/. Most criticism (rubber-stamping, invented market sizes, a score moving 65→78 when re-prompted) comes from competing vendors [S]. The studies, though, agree with it:
- Citations: "55% of the GPT-3.5 citations but just 18% of the GPT-4 citations are fabricated" [F] https://pmc.ncbi.nlm.nih.gov/articles/PMC10484980/.
- AI search tools gave "incorrect answers to more than 60 percent of queries", "with alarming confidence" [F] https://www.cjr.org/tow_center/we-compared-eight-ai-search-engines-theyre-all-bad-at-citing-news.php.
- Deep-research agents leave "large fractions of statements unsupported by their own listed sources", with citation accuracy of 40–80% [F] https://arxiv.org/abs/2509.04499. DeepResearch Bench measured 39–94% (OpenAI Deep Research 77.96%) [F] https://deepresearch-bench.github.io.
- LLM estimates of willingness to pay are "often inaccurate and in some cases wrong-signed" [S] (SSRN returned 403; the MSI summary is more positive [F] https://www.msi.org/working-paper/using-llms-for-market-research-2/).
- Asked directly for ratings, LLMs give "unrealistic response distributions" [F] https://arxiv.org/abs/2510.08338.
- "sycophancy is a general behavior of state-of-the-art AI assistants" [F] https://arxiv.org/abs/2310.13548.

**7. Consumers versus small businesses.** McKenzie: "customers are not willing to spend more than $5 to $10 a month on backup", while "Businesses… are capable of rationally valuing data… 'price insensitivity'". He contrasts Bingo Card Creator ("deeply non-critical", $29.95) with Appointment Reminder ("core infrastructure") [F] https://www.kalzumeus.com/2014/04/03/fantasy-tarsnap/. Appointment Reminder's price was anchored to one missed appointment [S]. For consumers, evidence means volume: ranks, sales counts, conversion near 2%. For small businesses, it means the cost of failure, an existing spend line (software, a freelancer, staff hours), and whether the payer is the one in pain. Small-business owners post less, and in Korea often only in members-only Naver cafés, which cannot be fetched or re-verified [R].

---

## A. Evidence hierarchy (strongest first)

0. **Money paid to you.** A deposit, a pre-order, a real checkout. This is an experiment, not public evidence. Trace: a payment record.
1. **Switching with money.** People left one paid solution for another for this job, which shows push and pull already beat anxiety and habit. Trace: a review saying "Switched from X… because…", or a dated post "moved our shop from X to Y".
2. **Paying today for a worse way.** Incumbent prices with buyer counts, a human hired to do it, templates sold for it. Trace: a Kmong gig with 14,146 transactions at ₩25,000 a month.
3. **Paid but unhappy, specifically.** Dated 2–3 star reviews naming the failure for this job. Trace: "we pay for X but still re-enter bookings by hand every Sunday."
4. **Time spent on a workaround.** Shared spreadsheets and scripts, "here's my process" posts.
5. **Active looking.** "Alternatives to X" and "is there a tool…" threads, absolute counts for searches that name a solution, job ads for the task.
6. **Complaints without behaviour.** "Bitch and never buy."
7. **Stated intent.** Waitlists, upvotes, "I'd pay". About 1.35× inflated at the median, with a long tail; 500 on a waitlist became about 60 buyers.
8. **LLM opinion, simulated customers, validator scores, model-made market sizes.** Weight zero. Use only to suggest search queries.

## B. A method an agent can run

1. **Seed.** With a domain or a kind of person, list the watering holes. With nothing, **start from the money**: Kmong categories by transaction count, top-grossing charts by genre, funded Wadiz and Tumblbug projects, template stores, review-site categories. Derive (person, job) pairs from them. Record whether each venue can be fetched.
2. **Safari** on a fixed time budget. Store each record as: URL, date, author handle, verbatim span, trace type (money, switch, time, search, complaint, intent), and the jargon used.
3. **Cluster** into (person, moment, job) patterns, counting **distinct people**. A pattern becomes a candidate at ≥10 people across ≥3 venues. This fits the 10–30 interviews of a typical voice-of-customer study [F] https://stuff.mit.edu/~hauser/Papers/Gaskin_Griffin_Hauser_et_al%20VOC%20Encyclopedia%202011.pdf.
4. **Map the money** for the top 3 patterns: price pages, buyer counts, paid human substitutes, 2–3 star reviews.
5. **Read the forces** from text: push, pull, anxiety, habit, deadline events.
6. **Reach:** a URL where these people were active in the last 90 days and the maker may post, or an absolute keyword count.
7. **Price** from substitute prices and the cost of failure, never from stated willingness to pay.
8. **Write claims** (section E). Verify them, give them to the skeptic, reach a verdict.
9. **Paid door**, with the owner's approval.

**Believable** means ≥3 independent sources: different authors and venues, none quoting another, at least one dated within the last 24 months. A money claim also needs one primary price or transaction trace and one buyer's own words. A claim with one source is a lead.

## C. Kill criteria

- No money trace of any kind (product, freelancer, template, staff hours) within the search budget.
- Many complaints but no workarounds, no recommendation requests, no "alternatives to" threads.
- A free or bundled tool's reviews are mostly 4–5 stars for this exact job, and the only complaint is price.
- The person in pain does not pay, and the payer leaves no trace.
- The only gathering places are closed, with no search volume and no marketplace.
- The job depends on breaking a platform's rules.
- The observed price ceiling is below a viable price.
- The job comes up once a year or less, but would be sold as a subscription.
- All traces are more than 3 years old, or earlier attempts died for lack of buyers.
- The chart is held by giants with free tiers.

## D. False positives

- Signups, waitlists, upvotes, launch traffic.
- Compliments, "I'd pay", "someone should build this".
- Searches for "free" or "how to" queries. Trends and DataLab indices read as counts.
- Market-size figures, especially ones made by a model.
- A competitor's existence or funding read as revenue. A subsidized free incumbent is a wall.
- Incentivized review counts [R].
- One loud person posting across several venues.
- The founder's own followers counted as the market (Buffer's first users came from the founder's Twitter followers and Hacker News).
- Employees complaining about tools their employer chose.
- An LLM agreeing, including the agent agreeing with its own candidate.

## E. How to word a claim

Shape: **[who, by role and situation] in [moment] [did what, past tense] [amount, frequency] as of [date]. Evidence: N spans (URL, fetch date, hash). False if: [observation].**

- Use observable verbs: paid, cancelled, switched, hired, built, searched. Never want, need, would.
- One fact per claim.
- Bad: "Small businesses struggle with scheduling." Good: "Owners of 1–3 chair Korean salons taking bookings via KakaoTalk paid ₩X a month for [tool], and in ≥3 reviews dated 2025–26 they report re-entering bookings by hand."
- Mark every number as *observed* (a quoted span) or *derived* (formula shown).
- Every claim names its falsifier and the counter-search that would find it.

## F. What should change in the design

1. **Make the money claim the gate, and check it first.** Verify "what they pay today, in money or in named labour" before anything else, and stop if it fails. When there is no seed, generate candidates from the money (gigs, charts, review categories) instead of from pains. Pains are plentiful; paid jobs are rare.
2. **"The quote is on the page" is necessary and not enough.** Re-fetching catches fabrication (18–55% of citations in the studies above). It does not catch misreading: agents leave "large fractions" of statements unsupported by sources they themselves cite, and citation accuracy runs 40–94%. Add a support judge that sees only the claim and the span, nothing else from the case. Add an independence check across authors, venues and dates.
3. **Plan for sources that refuse fetching.** G2, Capterra and Medium returned 403 today; Capterra challenged a real browser too. Naver cafés need membership. At collection time, store a snapshot and a hash, and ask the Wayback Machine to archive the page. A quote that can only be checked against the snapshot cannot carry a gate claim alone.
4. **Count people, not quotes.** Put the thresholds in code: a pattern needs ≥10 people across ≥3 venues; a claim needs ≥3 independent sources; a money claim needs a primary trace plus ≥2 buyer voices.
5. **Your "strongest evidence" needs a correction.** Paying for a worse way can also mean switching costs are high, so a better product still loses. Add two claims: **"people in this job have switched before"** (tier 1) and **"what keeps them where they are"** (anxiety and habit, quoted). Without these the case cannot tell an open market from a locked one.
6. **Add the claims your set is missing.** How often the moment recurs (a subscription needs a recurring job). Payer = sufferer. Why now, and why the incumbent has not fixed it (YC's "only recently possible" question and the tar-pit check). Reach as a URL with recent activity.
7. **Two standards.** For consumers, require spending on this job at or above the target price, and plan for about 2% conversion with freemium. For small businesses, require a cost-of-failure trace and an existing spend line, and anchor the price to that cost.
8. **Ban generated numbers.** Market size, willingness to pay and percentages may enter a case only as quoted spans or as arithmetic over them. LLM estimates of willingness to pay can have the wrong sign.
9. **The skeptic must search, not just read.** Give it search tools and a quota of counter-searches (a free good-enough tool, earlier post-mortems, the platform's rules). Its objections need quoted spans too, or it swaps flattery for contrarian invention.
10. **The desk case is not the last gate.** "Do not build" is the right default. A case that passes should earn a paid door (a real price and checkout, or a refundable deposit) before a full build, with the owner's approval. Desk evidence ranks below one person paying.
