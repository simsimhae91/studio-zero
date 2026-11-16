# Stand-ins: what LLM personas can and cannot tell about a product

Researched 2026-11-16. **Read** = I fetched and read the page or PDF today. **Search-only** = the claim was seen only in a search summary; the source would not open. **Recalled** = from memory.

## 1. The evidence

**Demand, purchase intent, willingness to pay**

- **Brand, Israeli, Ngwe, "Using LLMs for Market Research"** (first circulated as "Using GPT for Market Research"), MSI Report 25-136, 6 Oct 2025. Read: abstract (https://thearf-org-unified-admin.s3.amazonaws.com/MSI/2025/MSI_Report_25-136.pdf) and 2024 slides (https://www.microsoft.com/en-us/research/wp-content/uploads/2024/05/AIsraeli_GPT_May2024_AICE_final.pdf).
  - Conditioning: "A customer is randomly selected while shopping… annual income is $70,000," two products plus "the option not to purchase," repeated hundreds of times.
  - Results: demand slopes down; fluoride willingness to pay is "$3.4, consistent with Fong et al (2023) $3.27." The model "gravitates toward the first option presented" and has brand preferences.
  - Fine-tuning on prior surveys helps "existing and, importantly, new product features," but brings "no similar improvements… for new product categories or for differences between customer segments."
  - Unverified: "often inaccurate and in some cases wrong-signed," attributed to the SSRN version (403).
- **Maier et al., PyMC Labs with two Colgate-Palmolive authors, arXiv 2510.08338.** Read (https://arxiv.org/html/2510.08338v2; v3 page 1).
  - Data: 57 personal-care concept surveys, 9,300 US respondents. Models: GPT-4o and Gemini-2.0-flash with demographic personas.
  - Direct 1–5 rating: ρ≈80% of the test–retest ceiling, but KS distribution similarity 0.26/0.39; models "mostly answered 3."
  - Free text mapped to anchors by embedding similarity (SSR): ρ=90%, KS=0.88 (GPT-4o).
  - No persona: KS 0.91, but ρ fell from 92% to 50%, with more positive ratings.
  - Temperature 0.5 vs 1.5 made little difference. Gender and region effects were not reproduced.
  - Limits: anchors were tuned on the same surveys; the target is stated intent, not purchases.
- **Kaiser et al., NIM Marketing Intelligence Review 18(1), March 2026.** Read (https://nim.org/en/publications/detail/leaving-insight-to-digital-twins).
  - Brand choice matched 79%; 7-point ratings were off by 1.2 points.
  - Brand choice and attitudes were overestimated, most for well-known brands, with less variance.
  - SSR is "an improvement, but not a replacement," and is still too positive and too uniform.
- **Arora et al. 2025**, via NN/g only: dog-food survey of 605 people.
  - Purchase likelihood 1.66 human vs 1.58 synthetic; uniqueness 2.12 vs 2.48.
  - Lower variance; retrieval (RAG) over interviews raised it.

**Simulating people**

- **Argyle et al., Political Analysis 2023.** Read, pp. 343–346 (https://www.cambridge.org/core/services/aop-cambridge-core/content/view/035D7C8A55B237942FB6DBAD7CAA4E49/S1047198723000025a.pdf/out-of-one-many-using-language-models-to-simulate-human-samples.pdf).
  - GPT-3 was given ANES backstories. Vote-choice tetrachoric correlation: 0.90 / 0.92 / 0.94 for 2012 / 2016 / 2020.
  - Pure independents: 0.31 / 0.41 / 0.02.
- **Bisbee et al., Political Analysis 2024.** Read, pp. 401–406 (https://www.cambridge.org/core/services/aop-cambridge-core/content/view/B92267DC26195C7F36E63EA04A47D2FE/S1047198724000056a.pdf/synthetic-replacements-for-human-survey-data-the-perils-of-large-language-models.pdf).
  - ChatGPT-3.5 personas, 30 per ANES respondent. Means landed within one SD, with "far less variation."
  - "48% of coefficients… statistically significantly different… the sign of the effect flips 32% of the time."
  - The same prompt gave different results in April and July 2023, and results were sensitive to wording.
- **Park et al., arXiv 2411.10109.** Read the current abstract.
  - 1,052 people, each with a two-hour interview. Accuracy is normalized by the person's own two-week retest.
  - Interview 83%, surveys 82%, both 86%, demographics only 74%; gains are "modest."
  - v1 figures, per NN/g: GSS 0.85, Big Five 0.80, economic games 0.66.
- **Toubia et al., digital-twin mega-study, arXiv 2509.19088.** Read (https://arxiv.org/html/2509.19088v2).
  - 19 studies, 164 outcomes; each twin was built from about 500 of the person's answers.
  - Accuracy 0.748 vs 0.629 random vs 0.817 human retest. Twin SD was lower in 154/164 outcomes (93.9%), and means differed in 76.2%.
  - Twins were weakest on "valenced evaluations," pro-technology, and "hyper-rational."
  - Richer personas raised correlation, not accuracy. Temperature 0 was best.
- **Hewitt, Ashokkumar, Ghezae, Willer.** Read the project page (https://ai4pb.stanford.edu/projects/predicting-results-of-social-science-experiments-using-large-language-models).
  - 70 experiments, 476 effects: r=0.85 predicted vs actual, and r=0.90 on unpublished studies.
  - "Overestimated effect sizes" is search-only.
- **Horton et al., "Homo Silicus," arXiv 2301.07543 v2 (Feb 2026).** Read the abstract.
  - Qualitatively replicates classic results, including status quo bias.
  - The authors hold a financial interest in expectedparrot.com.
- **Gui & Toubia, arXiv 2312.15524 (search-only).** Changing the price in a prompt silently changes other things in the simulated world. Their fix is to state the design to the model.
- **Hu & Collier, ACL 2024 (search-only).** Persona variables explain "<10%" of annotation variance.
- **Wang, Morgenstern, Dickerson, Nature Machine Intelligence (arXiv 2402.01908).** Read the abstract.
  - LLMs "misportray and flatten" identity groups (4 LLMs, 3,200 people).
  - Inference-time fixes reduce the problem but do not remove it.

**Agents operating real interfaces**

- **AgentA/B, arXiv 2504.09723 v4.** Read.
  - 1,000 Claude 3.5 Sonnet agents in a live Amazon.com filter test.
  - 6.05 actions per session vs 15.96 for humans; 1.42 searches vs 6.40.
  - Purchase actions 0.81 vs 0.62. The effect "aligned directionally," with no human effect size given.
- **Lu et al., arXiv 2503.20749 v3.** Read.
  - On 31,865 real shopping sessions, prompt-only next-action exact match was 8–12%; fine-tuned 7B reached 17.26%.
  - Claude showed a "noticeably higher purchase rate while conducting only a single search per session."
- **UXAgent, arXiv 2504.09407 v3.** Read.
  - No comparison with real users. 16 UX researchers rated trust 0.57 on a −2..2 scale; one said "Some behaviors are abnormal."
- **Kuric et al., "What Would GPT Click," arXiv 2605.18302 (May 2026).** Read pp. 1–4.
  - 12 real first-click tests, n=3,431. GPT's click distributions differed significantly in 53% of tasks.
  - Personas, chain of thought and sampling had "superficial effects." The authors sell human testing.
- **UX-LLM, arXiv 2411.00634 v3.** Read.
  - Precision 0.61–0.66, recall 0.35–0.38 on two iOS apps.
  - Testing with 10 users per app found 26 issues; UX-LLM found 29, 8 of them unique. It missed navigation and cross-screen problems.
- **Zhong et al., arXiv 2507.02306.** Read the abstract.
  - An LLM heuristic evaluation found 73% and 77% of issues, against 57% and 63% for five experts.
  - It was weak on multi-screen violations.
- **GenderMag agents, ACM TiiS 2026, DOI 10.1145/3801978 (search-only).**
  - Broad overlap with humans on generic issues; agents rated severity higher.
  - Humans caught "emotional and interactive" problems the agents missed.
- **AppLooper, arXiv 2608.14093 (Aug 2026).** Read pp. 1–2. Its virtual users carry "documented persona provenance, applicable contexts, and uncertainty boundaries."

**Agreeableness and sameness**

- **NN/g, Rosala & Moran, June 2024.** Read (https://www.nngroup.com/articles/synthetic-users/).
  - "Shallow or overly favorable feedback." Synthetic learners claimed course completion and praised forums that real learners called "contrived."
  - "Every idea is often seen as a good one." Synthetic users are fit for hypotheses and interview-guide pilots.
- **NN/g, Budiu, Aug 2025.** Read (https://www.nngroup.com/articles/ai-simulations-studies/). "Capture general trends… but fail at capturing the magnitude."
- **Sharma et al., arXiv 2310.13548.** Read the abstract. Assistants match users' stated views, and preference data rewards agreement.
- **"Artificial Hivemind," arXiv 2510.22954 (search-only).** Strong similarity across models; decoding alone does not create diversity.
- **Schoenegger et al., Science Advances 2024 (search-only).** A 12-LLM ensemble was indistinguishable from 925 human forecasters.

**Retention.** I found nothing that validates simulated "coming back" against real cohorts.

## A. What stand-ins are good for, and what they are not

**Reliably good for:**

- **Observable faults on the path.** These are dead ends, missing feedback, broken saves, unclear labels and layout problems. LLM evaluations reach 60–66% precision, and their coverage matches or beats single expert reviews (UX-LLM; Zhong). Agents also find functional faults that humans skip (GenderMag).
- **Direction and ranking in well-trodden categories.** Demand falls with price (Brand). The better of two concepts gets the higher score (PyMC ρ≈90%). Treatment effects are ranked correctly (Hewitt r=0.85).
- **Generating hypotheses, and piloting the questions to ask real people** (NN/g).

**Unreliable for:**

- **Magnitudes:** willingness-to-pay levels, effect sizes and conversion rates.
- **Spread and subgroups.** Variance is too low in 93.9% of outcomes, and subgroup coefficients are wrong-signed in 32% of the differing cases (mega-study; Bisbee). Segments are not improved by fine-tuning (Brand).
- **Torn or ambivalent people** (Argyle's independents, r=0.02 in 2020).
- **New categories** (Brand).
- **Affective and interactive problems** (GenderMag).
- **Where people actually click and how they explore.** First clicks differed in 53% of tasks. Agents take 6 actions where people take 16, and they buy more readily (AgentA/B; Lu).

**Never conclude from them:**

- That real people want the product, will pay a given price, or will come back.
- That "3 of 3 would pay" is a conversion rate.
- That no findings means usable.
- That stand-ins who agree with each other are right. They share one model's priors ("Artificial Hivemind").

**The asymmetry that matters for the trial.** Stand-ins are more goal-directed and more agreeable than people (NN/g, NIM, AgentA/B, Lu, Sharma). A stand-in that gets stuck, or refuses to pay with a concrete reason, is informative. A stand-in that succeeds or says yes is weak evidence.

## B. Techniques that raise fidelity, with their evidence

1. **Ground personas in real text, not labels.** Interviews raised accuracy from 74% to 83% (Park). Interview-based twins beat persona-based ones (NN/g), and RAG restored variance (Arora). Labels flatten groups (Wang). The gains are modest: richness raised correlation but not accuracy (mega-study).
2. **Free text, then map to a scale by similarity.** KS similarity rose from 0.26 to 0.88 (PyMC). The positive bias remains (NIM). Never ask a stand-in for a 1–5 number.
3. **Forced choice against the status quo at a real price.** Choice with a no-buy option gave demand curves consistent with theory (Brand), and status quo bias reproduces (Horton). State the design explicitly (Gui & Toubia). No head-to-head study of rating versus choice for adoption was found.
4. **Behaviour, not opinion, and the product's behaviour over the agent's.** Synthetic accounts of past experience are unreliable (NN/g). Agents match people's next action only 8–12% of the time (Lu). Trust what the screen did.
5. **Calibration against known outcomes.** It helps within a category, not across categories (Brand). Anchors tuned in-sample may not transfer (PyMC).
6. **Several models.** An ensemble matched human forecasters (Schoenegger), but models are strongly alike ("Hivemind"). Use several models as a robustness check, not as a source of diversity.
7. **Number of personas.** Studies of distributions use hundreds of draws and still under-disperse (Bisbee; PyMC). I found no saturation curve for problem discovery. With 2–3 stand-ins, nothing distributional can be concluded.
8. **Temperature and independence.** Temperature had little useful effect (PyMC; mega-study; "What Would GPT Click"), so diversity has to come from the cards. Results are sensitive to wording (Bisbee), so each briefing should be identical apart from its card. Keeping each stand-in blind to the others is my inference; no study of it was found.

## C. Changes to the trial, in order of expected value

**C1. Label every line on the page by what kind of evidence it is, and read the verdicts asymmetrically.**

The page gets three fixed classes:

- **"Happened on the product."** Seen, and reproduced by the checker. Label: *seen, reproduced*.
- **"Met once."** Seen, but not reproduced.
- **"A stand-in's reading."** Guessed. Label: *AI guess, ask a person*.

The verdict block is retitled **"What the stand-ins said: not a forecast."**

- It shows each stand-in's choice and reason in words. It never totals the verdicts ("2/3 would pay") in a heading.
- It carries this fixed caption: "AI stand-ins judge more kindly and more alike than people do, and buy more readily (NN/g 2024; NIM 2026; AgentA/B 2025). A *no* with its reason is worth acting on. A *yes* is not evidence that anyone will pay."
- `block` findings lead, as now.
- A stand-in's "would pay" never unlocks building the payment by itself. It counts only together with zero `block`/`worth` findings, and it is shown as "reached the price wanting it: unconfirmed."

**C2. Replace the end questions.**

`--pay yes|no|not-yet` is replaced by four things:

- **(a) Reason first.** "Before choosing: in your own words, what do you have now that you did not have on day 1, and what does paying add?" This text is kept verbatim.
- **(b) A forced choice against the card's status quo, at the product's real price.** "It is day 8. The screen asks ₩X/month. [Instead-tool] still works and costs [its price/effort]. Pick one: pay now / keep only the free part / go back to [instead-tool] / stop using both." Plus: "What exactly would you lose by going back?"
- **(c) Behaviour from the notes, not opinion.** "On day 3, what brought you back: a notice from the product, a need named on your card, or only the instruction to return?" If it was only the instruction, `--returned` records `no-pull`, not `yes`.
- **(d) A comprehension check.** "Tell a friend in one sentence what this is." It is compared with what the landing page claims.

If the owner wants a 1–5 figure, a separate judge maps text (a) onto fixed anchor sentences. The stand-in never rates itself.

**C3. Ground every card in real words, and say on the page when a card is not.**

Each card gains `--voices`: 5–10 verbatim quotes with their URLs, from people in that moment, about the status-quo tool. Sources are store reviews, forum threads and review sites. It also gains `--instead-cost`: the real price of the status quo and what switching loses (data, habit, colleagues). Demographic labels are dropped. Before writing the cards, the trial gathers these with web search.

A card without voices is marked **ungrounded** on the page, and its guessed findings are shown greyed.

**C4. Get diversity from the cards; keep the stand-ins independent and split across models.**

- Each stand-in gets an identical briefing apart from its card, a fresh context, its own product copy (as now), and never sees another stand-in's notes.
- Assign Opus and Sonnet alternately across the cards, and show the model next to each person on the page.
- A finding met under both models is ranked above one met under only one.
- Do not touch temperature.
- The three cards must differ in their moment and their status quo, not only in their name.

**C5. Make "came back" about what the product does, which can be seen.**

The day-2/3/7 notes must answer three things:

- Was my work still there?
- Did anything reach me between days?
- Is there more for me today than on day 1?

The page shows these as seen facts. "Would come back" moves to "what only real people can tell." I found no evidence that LLMs predict retention.

**C6. Turn guesses and splits into the questions for real people, and test the questions on a stand-in.**

- Generate the questions from every `guessed` finding, every place where the stand-ins split, and the strongest reason given for "no."
- Phrase them as past behaviour: "When did you last…, what did you use, what did it cost you?"
- Before handing them over, put them to one stand-in. Drop or rewrite any that draw a vague or flattering answer. Piloting an interview guide this way is the use NN/g endorses.

**C7. A planted-fault canary in each run.**

Plant one known fault in one stand-in's copy, for example: an unlabeled icon on the main path, an error with no message, or a price that does not say what it includes. If the stand-in does not report it, the page says "this run missed a planted fault; few findings here does not mean few problems." This is cheap for web products with their own copy. For desktop apps, use the data folder (for example, a corrupted entry on day 2).

**C8. Show calibration status in the page header** (see D): "Stand-ins last checked: [date, model]. Planted faults found x/y. Known pair separated: yes/no/never checked."

## D. Calibration protocol

1. **Planted-fault recall: every trial, plus a full run whenever the model changes.**
   - Keep a fixed set of 6 fault types: a dead button on the main path, an entry lost by day 2, a price with no statement of what it includes, an unlabeled icon, an error with no message, and a step that silently does nothing.
   - Plant 3 of them in a throwaway copy of the owner's product, and run one stand-in.
   - Score: faults found / planted, and "fine" notes written over a planted fault.
   - Rule: if fewer than 2 of 3 are found, the page states it, and "no blocks" is not reported as good news.
   - Cost: one extra stand-in run.
   - Rerun the full set when the model version changes, or every three months. The same prompt drifted over three months (Bisbee).
2. **Real issues filed by real users: once per product category.**
   - Take 2–3 open-source apps in the owner's category that have public issue trackers. Run the trial on an old release, chosen before a batch of usability issues was filed and fixed.
   - Score the recall of those filed issues, and the false alarms: findings that no user ever filed and that the maintainers did not change.
   - This is the cheapest real-world ground truth that is available.
3. **A known pair, run blind: once per category, and after a model change.**
   - Run the same cards on one product that is plainly succeeding and one that stalled or shut down in the same category.
   - Prefer small products, or products released after the model's training cutoff. Hide brand names where possible: models favour brands they know (NIM; Brand et al.), and Hewitt checked unpublished studies for the same reason.
   - Score: does the forced choice in C2(b) favour the successful product over the status quo more often than it favours the failed one, across 3 cards × 2 runs?
   - Also score the overlap between the findings and the top complaint themes in each product's public reviews.
   - Rule: if the pair is not separated, pay and return verdicts are shown only as reasons, never as a lean.
4. **A ledger of real people, ongoing.**
   - When the owner's first real users arrive, record each one's reached / returned / paid, and the reason in their words, in `.sz/`. Set each beside the stand-in with the closest card.
   - After about 10 people, the page can say "a stand-in's *no* matched a real *no* in x of y."
   - The ledger is the only measure of demand fidelity; everything above it measures fault finding and direction.

## What I could not verify

- The "wrong-signed" wording attributed to the SSRN version of Brand et al.
- Hewitt et al.'s overestimation of effect sizes.
- The GenderMag recall figures.
- Agent4Rec's alignment numbers.
- Arora et al. directly; I know it only through NN/g.
- Wang et al.'s specific remedies.
- Why the current Park abstract (83/74) differs from the v1 figures (0.85, and 0.71 recalled for demographics).

I found no study that validates simulated retention, or simulated multi-day use, against real cohorts.
