# Cheapest honest tests of demand in Korea (2026-11-16)

Builds on `../2026-11-15-ship/money-korea.md` (payments, 사업자등록, PayApp, 통신판매업 exemption, 개인정보 처리방침, 앱인토스 money rules); none of that is repeated here. Everything was fetched on **2026-11-16**. Marks: **[R]** read on the page itself; **[R-ag]** read, but an agency or vendor blog, not the platform; **[E]** seen only as a search excerpt, page not opened; **[S]** commonly said, not verified. Thresholds marked **(position)** are my reading of the benchmarks, not a source. Not legal advice: this is what the pages say.

## A. Menu of tests, cheapest first

| # | Test | Money | Owner hours | Proves | Go | No | Min sample | Time |
|---|---|---|---|---|---|---|---|---|
| 1 | Five problem interviews | 0–15만 원 (5 × 1–3만 원 사례비) | 5–8 | The problem exists and what people do about it now. **Not** that they will pay | ≥3 of 5 describe the problem unprompted **and** already spend money or ≥1 h/week on a workaround | ≤1 of 5 | 5 (go to 8 if 2 of 5) | 1 week |
| 2 | Price-stated page, free channels | 0원 | 1–2 (posts under own name) | Whether people who *see the price* act. Warm traffic overstates | ≥3.8% of unique target visitors leave contact after seeing the price (position: the SaaS landing median, below) | <2% | 300 unique visitors | 1–2 weeks |
| 3 | Same page, paid cold traffic | ~16만 원 for 300 Naver clicks at ~530원 [R-ag]; 당근 from 90원/click [R] | 1–2 (ad account, card) | Intent of strangers at the price; search volume for the problem | as #2 | as #2 | 300 clicks, read per channel | 5–10 days |
| 4 | Panel survey (오픈서베이) | 5만 원 / 100 answers, ≤5 questions, VAT 별도 [R] | 1 | Stated preference in a demographic; good for sizing and screening, weak as a go | never a go alone | — | 100 | hours (1,000 answers in ~3 h [R]) |
| 5 | Platform listing (앱인토스 free mini app, Chrome extension, 카카오톡 채널) | 0원 / $5 / 0원 | 2–4 | Pull inside a platform's audience | D7 ≥13% of ≥100 installers (Adjust average) | D7 <5% | 100 installs | review 2–3 business days (앱인토스), "a few days" (Chrome) |
| 6 | Concierge / Wizard of Oz for five | 0원 if free | 10–20 | That the *outcome* is wanted enough to come back | ≥3 of 5 ask for a second round or pay | ≤1 of 5 return | 5 | 2–3 weeks |
| 7 | Pre-order / deposit with real money | 0원 registration + PG fees (see money-korea.md) | 3–5 + registration | Willingness to pay. The only test that does | ≥10 strangers pay, or ≥1% of ≥500 cold visitors (position) | ≤2 strangers after ≥300 target visitors | 300–500 visitors | 2–3 weeks |
| 8 | Crowdfunding (텀블벅, 와디즈 펀딩) | 8% + VAT of a *successful* raise on 텀블벅 Start [R] | 20–40 (page, video, updates) | Payment from the platform's audience plus own network | goal met with most backers outside own network (position) | <30% of goal at the midpoint (position) | goal you set | review ~3 business days (텀블벅) [R]; 4–8 weeks prep (와디즈, global maker guide) [R] |
| 9 | Live product: retention, free-to-paid | hosting | ongoing | Sustained value | D1 ≥26%, D7 ≥13%, D30 ≥7%; freemium 3–5% paid | D7 <5%; freemium <1% | 100 active users per cohort | 30 days |

**What the harness can prepare alone:** the page with price and honest wording (section C), consent block, deletion schedule, UTM links per channel, the click-and-reveal flow, event logging, screener and interview guide, survey, posts drafted for each channel's norms, ad copy and keyword list, the concierge intake form and run-book, the crowdfunding page draft, the pre-order page with 13조 disclosures (placeholders), and the read-out with intervals.

**Only the owner:** posts under their own name (every community below requires an account; Show GN requires the maker); ad accounts and a card (Naver, 당근, Meta, Google, 토스애즈 5만 원 minimum charge [R]); identity checks (텀블벅: 19+, ID copy, own Korean bank account and phone [R]); 사업자등록 and 통신판매업 신고 if money is taken; paying interviewees; doing the concierge work and the calls; the go/no word.

### What the platforms allow an individual without registration

- **텀블벅:** "개인은 만 19세 이상의 본인 인증 및 신분증 사본을 제출해야 합니다" [R]. Fees: platform 5% (Start), 9% (Run), 15% (Boost) + 3% 결제 대행, VAT 별도, only on success [R]. Rejects projects "only for brand promotion" and previously sold items [R]. Digital or software rewards are not addressed on the pages read; 2015 success rate 63% [E, old].
- **와디즈:** funding is open to "개인, 개인사업자, 법인사업자 모두"; "개인사업자 또는 법인사업자만 진행 가능한 프리오더/스토어는 전자상거래법의 적용을 받습니다"; 통신판매업 신고 "펀딩 프로젝트에서는 필요하지 않지만, 프리오더/스토어 … 반드시 필요" [R]. Fee for global makers: 12% + settlement fee [R]; Korean fee table not reached. Until 2026-12-31: 90% of platform fee covered for individual makers in 후원·팬덤 [R, VentureSquare 2026-07-10].
- **앱인토스:** "사업자 등록이 없는 사람도 별도 제휴나 계약 없이 콘솔에서 계정만 만들면 바로 시작"; "검수는 보통 영업일 기준 2~3일" [R, 2026-03-16]. Platform: 10,000+ mini apps, MAU 4M (2026-08-14) [R], i.e. about 400 MAU per mini app *on average* if the MAU were split evenly; the median is surely lower. Stricter review since July 2026, retroactive [R]. A listing is a channel, not a test.
- **카카오톡 채널:** "국내 사업자등록번호나 고유번호가 없어도 일반 채널로 생성 가능"; general channels show "'사업자 정보가 확인되지 않은 채널'에 대한 주의 문구" [R]. 알림톡 needs a verified business channel [E].
- **Chrome Web Store:** $5 once [E, Chromium blog]; "review is completed within a few days, but it can take up to a few weeks" [R]. **App Store:** "at least 50% of submissions in less than 24 hours and 90% in less than 48 hours" [R]. Google Play's 12-tester rule is in money-korea.md. Traffic a new listing gets: no public figure found for any store.

### Paid traffic: what an individual can do

- **네이버 검색광고:** Naver's own business privacy notice (2026) lists "개인 광고주 : DI(중복가입확인정보), 대표자명" at ad-account creation [R], so individuals can open accounts. Min bid 70원, avg CPC ~530원, ~850원 for top 3, CTR 0.8–2.4% [R-ag, AMPM 2025-04-16, no source for the CPC]. 비즈머니 from 1만 원 [E-ag].
- **당근:** search ads "비즈프로필로만"; CPC "최소 90원부터 최대 10만원"; most spend ≥1만 원/day [R]. 사업자인증 is optional except "통신판매업, 휴대폰 판매업, 부동산중개업"; "광고 진행을 위해 서류 심사가 필요해요" [R]. Whether an unregistered person passes ad review: not found. Reach is limited to chosen neighbourhoods (MAU 20M+, 2026-01) [R].
- **토스애즈:** 광고머니 "5만원부터" [R, page marked (구)]; tax invoices go to "계정 생성 시 등록하신 사업자등록번호" [E], so registration looks required. Min bid 200–300원 [E-ag].
- **Google Ads:** an "Individual" account type exists; Korea identity check by mobile carrier [E]. Spend "will never exceed 2 times your average daily budget on a given day" [R]. No minimum found.
- **Meta:** $1/day for impression-billed ad sets is repeated by third parties [S]; the official page did not render. Korean CPC: **no figure found**. Superads global median CPC $1.08 (2025-07) to $0.77 (2026-07) across $3B spend [R-ag].
- No Korean Google CPC benchmark found.

### Free channels and their norms

| Channel | Own product allowed? | Read |
|---|---|---|
| GeekNews **Show GN** | Only if people can *try* it: "등록자는 해당 프로젝트를 직접 만들었거나 제작에 참여한 사람"; landing, signup and pre-order pages are **not** allowed [R, 2021-08-17]. So a fake door cannot go here; a working prototype can | [R] |
| 디스콰이엇 | Yes; most posts on the front page are makers' own products asking for feedback [R]. No posted rules found | [R] |
| 클리앙 | Site rule: "바이럴마케팅이나 전문적인 판매, 홍보(블로그, 동영상, 앱 등)를 위한 활동은 금지"; exceptions for 관리자 허가 and the 직접홍보 board (added 2026-05-18) [R]. 개발한당 소모임 hosts many [1인개발] posts [R] | [R] |
| Threads / X | No platform rule found. Toss's own guide (2026-10-26): real screenshots, start from the personal problem, ask for feedback; polished images "광고처럼 보여서" are skipped; no bare links [R] | [R] |
| Reddit | "It's perfectly fine to be a Redditor with a website, it's not okay to be a website with a Reddit account"; 9:1 norm; subreddit rules win [E/S]; official pages refused the fetch | [S] |
| 뽐뿌, 에브리타임, 네이버 카페, 오픈채팅 | Not verified. Commonly said: 뽐뿌 bans commercial posts outside designated boards; 에브리타임 needs a student account; each 카페 sets its own rules | [S] |

## Benchmarks

- **Landing pages** (Unbounce 2024, 41,000 pages, 464M views): all-industry median 6.6%, SaaS 3.8% [R/E]. "Conversion" mixes demo, trial and download forms; a page showing a price should sit below.
- **Waitlist** (Lenny, 2022-03-01, founder survey, paywalled): to free signup 25–85%; **to paid 5–25%, ~20% if moved off the list within a month, <10% after three months**; physical product <5% [R, partial].
- **Free-to-paid** (Lenny, 2023-08-01, 1,000+ products, mostly B2B): freemium self-serve good 3–5%, great 6–8%; trial good 8–12%, great 15–25% [R]. First Page Sage (2025-09-05, 86 SaaS, 71% B2B): opt-in trial 18.2%, opt-out (card) 48.8%, freemium 2.6% [R].
- **Retention, consumer apps** (Adjust): D1 26%, D7 13%, D30 ~7% [E; adjust.com returned 429]. Pushwoosh 2025 has iOS D7 6.9%, D30 3.1% [E], so definitions differ by 2×; compare like with like.
- **Pre-order rate:** no published benchmark found.

### Arithmetic: telling 2% from 5%

Decision rule "go if signups ≥ c" when the truth is 2% (should be no) or 5% (should be go). Exact binomial, computed here:

| Unique visitors | Cut-off c | Wrongly go when truth is 2% | Wrongly no when truth is 5% |
|---|---|---|---|
| 100 | 4 | 14% | 26% |
| 200 | 7 | 11% | 12% |
| **300** | **10** | **8%** | **7%** |
| 500 | 17 | 3% | 3% |

So **300 unique target visitors** gives about one wrong call in 13; 500 gives one in 30. Comparing two page versions needs about **600 per version** (α 0.05, power 0.8). Small counts are wide: 3 of 100 is 1.0–8.5% (95% Wilson); 3 of 5 interviewees is 23–88%. Five people answer *what* and *why*, never *how many*.

## Interview recruiting with no audience (five people in a week)

- **Paid panels and newsletters:** 그로스패널 (a Maily newsletter that relays interview calls to a panel): "오프라인 30분 1만 원" for 3 people (2025-07-30) [R]; 1.5만 원 per online hour to 5만 원 for scarce profiles (2026) [E].
- **Screener by panel:** 오픈서베이 at 5만 원/100 answers; screening and re-contact need a Pro plan [R].
- **Where the people already are:** 당근 동네생활 and local shops in person for small businesses (0원, owner's feet); the segment's 오픈채팅 rooms and 네이버 카페 (read each room's rules); 디스콰이엇 for makers; 숨고/크몽 to buy an hour from a professional [S].
- **Global reference:** Respondent charges $40 B2C / $80 B2B per session plus incentive [E].
- Budget: 5 × 2만 원 + 5만 원 screener ≈ **15만 원** and ~8 owner hours.

## B. What the law says (read on law.go.kr today)

**개인정보 보호법** (법률 제21445호, 시행 2026-09-11) [R]
- A solo maker is covered: "개인정보처리자"란 "업무를 목적으로 개인정보파일을 운용하기 위하여 … 개인정보를 처리하는 공공기관, 법인, 단체 및 **개인** 등" (2조 5호).
- Consent must state (15조 ②): "1. 개인정보의 수집ㆍ이용 목적 2. 수집하려는 개인정보의 항목 3. 개인정보의 보유 및 이용 기간 4. 동의를 거부할 권리가 있다는 사실 및 동의 거부에 따른 불이익이 있는 경우에는 그 불이익의 내용".
- Separate consent for marketing: "재화나 서비스를 홍보하거나 판매를 권유하기 위하여 개인정보의 처리에 대한 동의를 받으려는 경우" (22조 ① 7호); refusing it must not cost the service (22조 ⑤).
- Minimum collection, proof on the processor (16조 ①). Destroy "지체 없이" when no longer needed (21조 ①). Under 14: parent's consent and its check (22조의2 ①).

**정보통신망법** (시행 2026-10-02) [R]
- 50조 ①: "영리목적의 광고성 정보를 전송하려면 그 수신자의 명시적인 사전 동의"; ④: state "전송자의 명칭 및 연락처" and an easy opt-out; ③: 21:00–08:00 needs separate consent (시행령 61조 ②: email is exempt from this).
- 시행령 62조의2: tell the person the result of their opt-in or opt-out "14일 이내"; 62조의3: re-confirm consent "2년마다". The "(광고)" subject tag is in 별표 6, which I did not read [S].

**전자상거래법** (시행 2026-07-21) [R]
- Taking orders makes one a 통신판매업자: "통신판매를 업(業)으로 하는 자" (2조 3호). A waitlist with no 청약 and no payment is not 통신판매 (2조 2호 requires "소비자의 청약을 받아 … 판매").
- Even when exempt from 신고 (money-korea.md), an ad that takes orders must show "상호 및 대표자 성명", "주소ㆍ전화번호ㆍ전자우편주소" (13조 ①), and before the contract: price, "공급방법 및 공급시기", 청약철회 terms (13조 ②).
- Pre-payment: "선지급식 통신판매의 경우에는 … 3영업일 이내에 재화등의 공급을 위하여 필요한 조치", **unless** "공급시기에 관하여 따로 약정한 것이 있는 경우" (15조 ①). If supply becomes difficult: refund "3영업일 이내" (15조 ②). So a pre-order page must state the delivery date as an explicit agreement.
- Escrow or insurance is not required for "정보통신망으로 전송되거나 … 배송을 확인할 수 없는 재화등" or card payments (24조 ③ 2·3호).
- Banned: "거짓 또는 과장된 사실을 알리거나 기만적 방법을 사용하여 소비자를 유인" (21조 ① 1호).

**표시광고법** 3조 ①: no "거짓ㆍ과장의 표시ㆍ광고" or "기만적인 표시ㆍ광고" [R]. Whether a fake door is 기만 is not addressed anywhere I read; the safe reading is: say "출시 전" before the click, reveal at the click, never take card details [position].

**부가가치세법** (시행 2026-01-02) [R]: "사업자"란 "사업 목적이 영리이든 비영리이든 관계없이 사업상 독립적으로 재화 또는 용역을 공급하는 자" (2조 3호); "사업 개시일부터 20일 이내에 … 사업자등록을 신청" (8조 ①). A paid concierge is a 용역; a paid pre-order is a sale. Whether a one-week test is "사업 개시" is for the owner and 국세청 126.

## C. Five honest wordings

1. **Price up front, interest only:** "아직 만드는 중입니다. 출시하면 월 9,900원에 팔 예정이에요. 이 값에 쓰실 생각이 있으면 이메일을 남겨 주세요. 지금은 결제가 없고, 출시 소식 한 번만 보내 드립니다."
2. **Fake door, revealed at the click** (button: "월 9,900원으로 사전 신청"): "솔직히 말씀드리면 아직 결제를 받을 단계가 아닙니다. 몇 분이 이 버튼을 누르는지 보고 만들지 정하려고 해요. 출시되면 알림을 받으시겠어요? (선택)"
3. **Founding pre-order (only after registration):** "창립 회원 30명: 첫 1년 99,000원(정가 월 9,900원 예정). 서비스는 2027년 1월 15일에 엽니다. 그날까지 열지 못하면 3영업일 안에 전액 돌려드립니다. 받으신 날부터 7일 안에는 이유 없이 취소할 수 있어요."
4. **Concierge:** "처음 다섯 분은 제가 직접 손으로 해 드립니다. 아직 자동화는 없고, 결과는 24시간 안에 카카오톡으로 보내 드려요. 무료입니다. 대신 끝나고 15분만 써 보신 이야기를 들려주세요."
5. **The test, said out loud:** "이 페이지는 만들지 말지 정하려는 실험입니다. 12월 31일까지 신청이 100명을 넘으면 만들고, 넘지 않으면 만들지 않고 받은 연락처를 바로 지웁니다. 어느 쪽이든 결과를 메일로 알려 드려요."

Consent block under any of them (15조 ②): "수집 항목: 이메일 · 목적: 출시 알림 1회 · 보유 기간: 알림 발송 즉시 파기, 출시하지 않으면 2027년 1월 31일 파기 · 동의하지 않으셔도 되며, 그 경우 알림을 받을 수 없습니다." Separate, unticked: "(선택) 할인·이벤트 등 광고성 정보 수신 동의".

## D. What should change in the design

1. **Write the reality question before building the test.** Each verdict names the one thing only people can answer (problem, contact, payment, return) and the test that answers *that* one; a waitlist never stands in for "will they pay".
2. **Pre-register go, no and sample in the record before launch**, with an end date. When results arrive the harness returns only go, no or inconclusive; "promising" is not a value.
3. **Below 100 visitors, counts only** ("3 of 74"); from 100, the rate with its 95% interval; no verdict on a 2%-vs-5% question under 300 unique target visitors. Inconclusive means extend to 500 or change the test.
4. **Weigh commitment, not attention:** pageview < email < email after seeing the price < price-button click < money < second use. Likes, upvotes and "좋아요, 쓸게요" count zero.
5. **Tag every visit by channel and read each channel apart.** Warm community traffic and friends inflate; paid cold traffic is the baseline. Exclude the owner's own visits and bots.
6. **Build the honesty gate into the page check:** price visible, "출시 전" before any button, reveal at the click, no card fields without a real charge, 15조 ② four items, marketing consent separate and unticked, the deletion date scheduled as a job, the 14-day opt-in notice sent.
7. **Pick the channel by its rules:** Show GN only for something people can try; fake doors go to 디스콰이엇, Threads/X and ads; the harness drafts each post in that channel's voice (problem first, real screenshots, a request for feedback).
8. **Ask the owner once, as a batch, with cost and minutes:** "account at Naver ads (10 min), 16만 원 budget, two posts under your name (20 min), five calls (5 h)". Everything else the harness does first.
9. **Respect decay:** follow up every waitlist within 30 days (Lenny: ~20% to paid inside a month, <10% after three), and treat a list older than 90 days as cold.
10. **Treat interviews as a filter, not a vote:** count past behaviour (money or hours already spent), never stated intent; three of five with a paid workaround opens the door to a price test, and never stands in for one.

## Not verified

Meta and Google CPC in Korea; Meta's official minimum budget; whether 당근 and 토스애즈 accept an unregistered advertiser; 와디즈's Korean fee table; 텀블벅 rules for software rewards; 뽐뿌, 에브리타임, 네이버 카페 and 오픈채팅 rules; Reddit's official self-promotion page; Adjust's own retention page (rate-limited); 정보통신망법 별표 6; traffic for a new store listing; any Korean benchmark for pre-order or waitlist conversion; whether a fake door can be 기만적 표시ㆍ광고.

## Sources (all fetched 2026-11-16)

law.go.kr (개인정보 보호법 2·15·16·21·22·22의2조; 정보통신망법 50조, 시행령 61·62의2·62의3조; 전자상거래법 2·12·13·15·21·24조; 표시광고법 3조; 부가가치세법 2·8조) · docs.channel.io/tumblbug (41c91590, 9758b07e, c7c737b2, 프리오더 category) · wadiz.io/web/maker/makercenter/board/basic/4, /1603, /1411 · venturesquare.net/1097797 · toss.im/apps-in-toss/blog/apps-in-toss-getting-started, /solo-developer-revenue-apps-in-toss, /mini-app-threads-post-guide · toss.im/newsroom/apps-in-toss-10000 · kakaobusiness.gitbook.io/main/channel/start · business.daangn.com, businessdaangn.gitbook.io (ads-lite/create/search, profile/start/inspection) · shopping-docs.toss.im/ads/support/undefined/credit · navercorp.com business privacy notice PDF (2026-07) · inside.ampm.co.kr/insight/10257 · support.google.com/google-ads/answer/2375454, /adspolicy/answer/9870201 · developer.chrome.com/docs/webstore/review-process · developer.apple.com/distribute/app-review · news.hada.io/blog/show · disquiet.io · clien.net/service/board/rule/10707403, /cm_app · lennysnewsletter.com (/what-is-a-good-free-to-paid-conversion, /what-is-good-waitlist-conversion) · firstpagesage.com SaaS free-trial benchmarks · unbounce.com/conversion-benchmark-report/saas-conversion-rate · superads.ai Facebook CPC · blog.opensurvey.co.kr/news/agentic-survey-quick · maily.so/growthpanel/posts/xyowmjv1z28. Excerpt-only [E]: adjust.com retention guide, pushwoosh.com, Chromium blog (fee), koji.so (Respondent).
