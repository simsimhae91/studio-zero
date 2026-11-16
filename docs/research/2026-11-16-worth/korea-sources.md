# Korea: public sources that prove demand and payment, tested 2026-11-16

What this is: a hands-on test, from this machine, of which public pages show that people in Korea already pay money or real effort for a job a software service would do. It also covers which of those pages a headless Chrome could later re-open to confirm a quoted figure.

- **Date of every fetch:** 2026-11-16, between about 00:15 and 00:45 UTC (09:15–09:45 KST).
- **Tools:**
  - `curl -sL` with a desktop Chrome User-Agent. The shell sandbox blocked no host I tried.
  - WebFetch.
  - A real Chrome driven through the Playwright MCP. It reported UA `Chrome/157.0.0.0` and `navigator.webdriver=false`. I could not confirm whether it ran headless, so section E gives judgements and not proofs.
- **Legend:**
  - **[F]**: fetched and read today.
  - **[S]**: seen only in a web-search summary, not opened.
  - **[M]**: from memory, not verified today.
  - **[NR]**: not reachable today.
  - Every figure below is [F] unless marked otherwise.
- **Privacy:** queries used generic category words only (가계부, 학원 관리, 엑셀 템플릿, 노션 템플릿, 엑셀 자동화, 스마트스토어). Companies and products are named because they are public businesses. Individual sellers, reviewers and developers are left unnamed.

## Key findings

1. **The best item-level payment proof that needs no login and no key is 크몽 (kmong).**
   - Each gig page's `<meta name="description">` carries a platform-counted sales figure, for example `25,000원부터 | 476건 판매`.
   - The visible page shows the review count and the seller's `총 거래 건수`.
   - kmong's own search API returns price and review count for every gig in a category.
2. **Crowdfunding gives money paid by a known number of people.**
   - 텀블벅's JSON API (`/api/v3/project/{slug}/detail`) returns `amount` and `pledgedCount` to plain curl.
   - 와디즈 shows the same on its pages, but only to a real browser: Akamai blocks curl and WebFetch.
3. **Apple still works fully for Korea.**
   - Search, Lookup and the customer-reviews RSS JSON all work.
   - The legacy RSS charts work: Korean top paid and top grossing by genre (`itunes.apple.com/kr/rss/...`).
   - The rating count of a *paid* app (from Lookup) is a lower bound on buyers.
   - The App Store web page lists in-app purchase prices.
   - apps.apple.com rate-limited curl (HTTP 429) after a few requests. WebFetch still read it.
4. **Google Play app pages give real figures to curl.**
   - Visible text gives the install band, rating and review count.
   - The page data embeds the exact install count and the in-app price range (`항목당 ₩12,000 - ₩120,000`).
   - Full and star-filtered reviews come only from an unauthenticated POST (`batchexecute`) or by clicking in a browser.
5. **원스토어 app pages are server-rendered.** For a paid app they show price plus download band (`8,800원 … 1만+ 다운로드`).
6. **Naver is split.**
   - Integrated search and the cafe-tab search are server-rendered and readable by curl. They show shopping cards (price, rating, review count), 파워링크 advertisers, and cafe post and comment snippets.
   - **Naver Shopping search and every 스마트스토어 page redirected to the Naver login**, in curl and in the browser.
   - Member-only cafe articles open only with the `art=` token that the search page attaches.
7. **Company-level revenue comes from DART audit reports.** For example, 크몽 2025 영업수익 48,572,052,572원. This only works for audited companies. The three small 학원-software vendors I tried had no filings.
8. **These failed outright today:**
   - Reddit, Product Hunt and 잡플래닛 (bot blocks).
   - 블랙키위 and the FTC 통신판매 lookup (CAPTCHA).
   - Google Trends explore (HTTP 429, in curl and in the browser).
   - THE VC (timeout everywhere).
   - 혁신의숲 figures (login, and its terms forbid automated collection and AI use).
   - 앱인토스: there is no public catalog of mini-apps.

---

## A. Sources ranked by strength as PAYMENT evidence

Strength runs from "audited money" through "platform-counted purchases" and "lower bound of buyers" down to "price only" and "self-claims". A pipe inside a quote is written `\|`.

| # | Source | Works today? | Working example URL | What comes back | What it proves |
|---|---|---|---|---|---|
| 1 | DART 감사보고서 (dart.fss.or.kr) | Yes, curl | https://dart.fss.or.kr/report/viewer.do?rcpNo=20260403000961&dcmNo=11246369&eleId=3&offset=11143&length=343208&dtd=dart4.xsd | 크몽 손익계산서: `영업수익 … 48,572,052,572 42,945,539,544` (2025, 2024); `영업이익(손실) 4,459,833,015` | Audited revenue of a company: market size or a competitor's size. Only for companies with audit filings. |
| 2 | 크몽 gig page | Yes, curl (server HTML) | https://kmong.com/gig/480731 | meta: `평점 4.9 (103개 리뷰) \| 25,000원부터 \| 476건 판매`; visible: `리뷰 (103)`, `총 거래 건수 895건` | Platform-counted sales of one product at a stated price. The strongest item-level proof found. |
| 3 | 크몽 search API | Yes, curl, no key; 400 unless every query parameter is sent | https://api.kmong.com/gig-app/gig/v2/gigs/search?keyword=%EA%B0%80%EA%B3%84%EB%B6%80&isPrime=false&isFastReaction=false&isCompany=false&isNowContactable=false&hasPortfolios=false&includeAggregations=false&page=1&perPage=20&sortType=SCORE&service=web&q=%EA%B0%80%EA%B3%84%EB%B6%80&rootCategoryId=null&subCategoryId=null&thirdCategoryId=null | `totalItemCount` 443; per gig `price`, `review.reviewCount`, `review.reviewAverage`, category | Which paid workarounds sell across a category. Ranks candidates for row 2. |
| 4 | 텀블벅 project API | Yes, curl (JSON); the page itself needs JS | https://tumblbug.com/api/v3/project/notioncity/detail | `amount` 27073000, `pledgedCount` 752, `fundingGoal` 500000, `percentage` 5414 | Money actually pledged by a counted number of backers. |
| 5 | 와디즈 campaign page | Browser only (Akamai 403 to curl and WebFetch) | https://www.wadiz.io/web/campaign/detail/417315 | `11,057,000원 달성`, `96명 참여` | Same as row 4, for Wadiz. wadiz.kr now redirects to wadiz.io. |
| 6 | Apple iTunes Lookup (paid app) | Yes, curl | https://itunes.apple.com/lookup?id=441683476&country=kr | `price` 32000, `userRatingCount` 8776, `averageUserRating` 4.79 | Lower bound on buyers: only people who downloaded a paid app can rate it (Family Sharing aside). |
| 7 | Apple legacy RSS charts, Korea, by genre | Yes, curl (JSON) | https://itunes.apple.com/kr/rss/toppaidapplications/limit=10/genre=6015/json (also `topgrossingapplications`, `topfreeapplications`) | Ranked names with `im:price`; feed `updated` 2026-11-15T16:15:21-07:00 | Which paid apps sell, and which apps earn most, in a category today. |
| 8 | App Store web page | Yes, but curl got 429 after a few requests; WebFetch OK | https://apps.apple.com/kr/app/id560481810 | `8.8만개의 평가 4.8`, `차트 #95 금융`, `앱 내 구입 … 1개월 구독 ￦2,900 12개월 구독 ￦24,000` | What is sold and at what price, plus chart position. Counts are rounded. |
| 9 | 원스토어 app page | Yes, curl | https://m.onestore.co.kr/v2/ko-kr/app/0000281872 | `편한가계부 (+음성, PC) Realbyte Inc. 8,800원 3+ 4.7 평점 1만+ 다운로드`; `4.7 862 명` | For a paid app the download band is roughly a purchase band. |
| 10 | Google Play app page | Yes, curl | https://play.google.com/store/apps/details?id=com.bhsoft.inouttalk&hl=ko&gl=KR | Visible: `4.3 star 리뷰 100개 … 5만+ 다운로드`; page data: `["50,000+",50000,95682,"5만+"]`, `항목당 ₩12,000 - ₩120,000` | That in-app purchases exist, with their price range, plus install volume. Installs are not payers. |
| 11 | 모바일인덱스 daily market rank | Browser only (JS app), no login | https://www.mobileindex.com/mi-chart/daily-rank?period=day&type=app&country=kr&chart=grossing&market=google | Grossing rank lists for Google Play, App Store and 원스토어 (2026-11-15) | Relative earnings across all three stores. Rank only, top apps only. |
| 12 | 네이버 통합검색 (shopping cards and 파워링크) | Yes, curl | https://search.naver.com/search.naver?where=nexearch&query=%EA%B0%80%EA%B3%84%EB%B6%80%20%ED%85%9C%ED%94%8C%EB%A6%BF | `2026 개정판 노션 가계부 템플릿 … 29,000 원 30 % 할인 20,300 원 … 4.78 (304) 찜 143`; 5 paying advertisers | Reviews on a sold product, and money spent on ads for the keyword. The result set changes over time. |
| 13 | 숨고 pro list | Browser only (curl 403) | https://soomgo.com/search/pro/review_count | `5.0 (13,691) 5,144회 고용` | Hire counts for service providers. Services, not software. |
| 14 | 탈잉 | Browser only (JS) | https://www.taling.me/search?query=%EC%97%91%EC%85%80 | `5.0 (500) … 19,900 원/월` | Price and review count of paid classes or challenges. |
| 15 | 와이즈앱 insight | Browser only (curl got 202 with an empty body) | https://www.wiseapp.co.kr/insight/ | `쿠팡, 10월 결제추정금액 6.2조 원 ‘역대 최대’...쿠팡이츠는 1.19조 원` | Category-level estimated spending. These are panel estimates. |
| 16 | Vendor pricing pages | Yes, curl | http://www.attalk.co.kr | `프리미엄 Class … 9,900 원 /월`; `16,000+ 학원 사용` | A real price point. Customer counts are self-reported. |
| 17 | 비즈폼 (template and form market) | Yes, curl | https://www.bizforms.co.kr/form/excel/sales/30006869 | `조회수 3,906 이용등급 프리미엄 다운로드 건당 49,000 원` | The price of an Excel workaround, with views. No sales count. |
| 18 | Notion template marketplace (ko) | Yes, curl | https://www.notion.com/ko/templates/search?query=%EA%B0%80%EA%B3%84%EB%B6%80 | `100개 이상의 템플릿`, creators, 무료 or price | Supply and price only. No sales counts. |
| 19 | 클래스101 | Partly: lists need JS; product page server HTML | https://class101.net/ko/products/5d897c192cb1a101fc417d79 | Subscription (`6,383 개의 클래스를 무제한으로 수강`); an unlabeled count `23,213` | Weak: a subscription model with no per-class sales. |
| 20 | Chrome Web Store item | Yes, curl | https://chromewebstore.google.com/detail/%EC%8A%A4%EB%A7%88%ED%88%B4-%EB%84%A4%EC%9D%B4%EB%B2%84-%ED%82%A4%EC%9B%8C%EB%93%9C-%EB%A7%88%EC%8A%A4%ED%84%B0-%ED%88%B4-%EC%9D%B4%EC%BB%A4%EB%A8%B8%EC%8A%A4-%EC%8A%A4%EB%A7%88/ndicoeoflkdgmknbbckpjjlmegppnddl | `4.6 ( 평점 51개 )`, `10,000 사용자` | Usage, not payment. Global users, not Korea-only. |
| 21 | 앱인토스 blog case studies | Yes (WebFetch) | https://toss.im/apps-in-toss/blog/discountspot | `서비스 오픈 첫 달에 약 1,000만 원의 매출을 달성했습니다.` | Self-reported marketing. There is no public catalog of mini-apps with usage figures. |

**How much weight each kind of figure can carry:**
- **Platform-counted:** kmong `N건 판매`, Tumblbug and Wadiz amount and backers, Apple and Play counts, chart ranks.
- **Audited:** DART.
- **Estimates:** Wiseapp, Mobileindex.
- **Self-claims:** vendor pages, sellers' own descriptions, Toss blog.

A proof stage should accept the first two kinds as payment proof. It should treat estimates as supporting evidence and self-claims as hints only.

One example of why: kmong gig 797157's description claims `오픈마켓 N사 출시 2달만에 … 600건 판매 돌파`. kmong's own count for that gig is `3건 판매`.

---

## B. Sources for COMPLAINTS and unmet needs

| Source | Works today? | Example URL | What comes back | Notes for re-checking |
|---|---|---|---|---|
| Apple customer-reviews RSS (JSON) | Yes, curl | https://itunes.apple.com/kr/rss/customerreviews/page=2/id=467936485/sortby=mostrecent/json | 50 reviews per page: `im:rating`, `title`, `content`, `im:version`, `updated`, `im:voteSum` | The best complaint source: dated, starred, a re-openable JSON URL. Reviews move to later pages as new ones arrive, so a proof should store the date and the page number. I fetched pages 1–2. Apple's 10-page (500-review) limit is [M]. |
| Google Play reviews | Partly | Page: https://play.google.com/store/apps/details?id=com.realbyteapps.moneymanagerfree&hl=ko&gl=KR. Data: POST https://play.google.com/_/PlayStoreUi/data/batchexecute?hl=ko&gl=kr (rpc `UsvDTd`) | The page HTML holds about 3 reviews. The POST returns 20 per call, sortable by newest and filterable by star, with no login. | A headless Chrome must click `리뷰 모두 보기`, then sort or filter, to see a given 1-star review. |
| 원스토어 app page | Yes, curl | https://m.onestore.co.kr/v2/ko-kr/app/0000701480 | Rating, rater count (`527 명`), a few review texts | Only a few reviews are in the HTML. |
| 네이버 카페 search tab | Yes, curl | https://search.naver.com/search.naver?ssc=tab.cafe.all&query=%ED%95%99%EC%9B%90%20%EA%B4%80%EB%A6%AC%20%ED%94%84%EB%A1%9C%EA%B7%B8%EB%9E%A8%20%EC%B6%94%EC%B2%9C | Post title, snippet, **comment snippets** (`RE…`), cafe name, date, article URL with an `art=` token | The richest Korean complaint source. Snippets reorder over time, so quote the article and keep the search URL as the route. |
| 네이버 카페 article | Partly | https://cafe.naver.com/goodhakwon/1243048 (member-only: login popup); same URL with the search's `?art=…` token: full post and 17 comments in the browser | Full post and comments, in an iframe | The `art=` token embeds `issuedAt`; how long it lasts is unknown. Without it, member-only boards require login. |
| 블라인드 | Yes, curl | https://www.teamblind.com/kr/post/2%EC%9D%B8-%EC%8B%9D%EA%B5%AC-%EA%B0%80%EA%B3%84%EB%B6%80-%EC%A1%B0%EC%96%B8-%EC%A2%80-%ED%95%B4%EC%A3%BC%EB%9D%BC-gkkvoprh | Post, view count (`조회수 71`), and all 8 comments, without login | Server-rendered. Employer labels are shown, and they are personal context. |
| 클리앙 | Yes, curl | Search: https://www.clien.net/service/search?q=%EA%B0%80%EA%B3%84%EB%B6%80%20%EC%95%B1; article: https://www.clien.net/service/board/cm_iphonien/19270588 | 20 rows per search; the article with its comments | Server-rendered. Good for switching stories, e.g. the comment `저도 지원 안되서 편한가계부로 넘어왔지만 클머니 좋았죠`. |
| 뽐뿌 | Partly | Search: https://www.ppomppu.co.kr/search_bbs.php?keyword=%EA%B0%80%EA%B3%84%EB%B6%80; article: https://www.ppomppu.co.kr/zboard/view.php?id=money&no=549574 | Search results with `조회수: 1230 \| 2026.11.10` | Articles return 403 to curl and come back mis-encoded through WebFetch (EUC-KR). The browser reads them. |
| YouTube | Partly | https://www.youtube.com/results?search_query=%EA%B0%80%EA%B3%84%EB%B6%80+%EC%95%B1+%EC%B6%94%EC%B2%9C | The search page's `ytInitialData` has titles and `조회수 261,567회`-style view counts | Comments are not in the watch-page HTML. They load by continuation after scrolling. |
| 크몽 reviews and seller notes | Yes, curl | https://kmong.com/gig/480731 | Review texts (almost all 5-star), plus the seller's own "not suitable if…" note | Low-star reviews are rare. Sellers' disclaimers show unmet needs (see F-c). |
| 텀블벅 and 와디즈 community and reviews | Browser only | https://tumblbug.com/notioncity (`커뮤니티 41`, `후기 18`); https://www.wadiz.io/web/campaign/detail/417315 (`커뮤니티 87`) | Counts and threads | Mostly backer questions. Useful for "what buyers expected". |
| App Store reviews of B2B2C apps (parent and teacher apps) | Yes, curl | https://itunes.apple.com/kr/rss/customerreviews/page=1/id=1605911146/sortby=mostrecent/json | As above | Small-business tools often ship a parent or student app. Its low ratings (2.0–2.7 for several 학원 apps) carry the operator's pain secondhand. |
| GeekNews Show, 디스콰이엇 | Yes, curl | https://news.hada.io/show ; https://disquiet.io/products | Maker launches with points or upvotes (mostly 0–2) | Maker-side supply. Few user complaints. |
| Reddit | No | — | 403 on `.json`; old.reddit serves a "Welcome to Reddit" block page; WebFetch refuses reddit.com | Low value for Korea anyway. |

---

## C. Sources for REACH (how many look, and where they gather)

| Source | Works today? | Example URL | What comes back | Limits |
|---|---|---|---|---|
| 네이버 데이터랩 검색어트렌드 | Yes: the form needs a browser (no login); the result URL re-opens in curl | https://datalab.naver.com/keyword/trendResult.naver?hashKey=N_595b945c8e6d0d453bf12d1888ae7d85 | `<div id="graph_data">` JSON of daily values. 가계부: peak 100 on 2026-01-01; Nov-2026 average 24.4; Dec-2025 average 49.9 | Relative index only (max = 100), no absolute volume. The hashKey has stayed valid so far; whether it expires is unknown. The open API needs a key [M]. |
| 네이버 autocomplete | Yes, curl | https://ac.search.naver.com/nx/ac?q=%EA%B0%80%EA%B3%84%EB%B6%80&con=1&frm=nv&ans=2&r_format=json&r_enc=UTF-8&r_unicode=0&t_koreng=1&run=2&rev=4&q_enc=UTF-8&st=100 | `가계부 어플 추천`, `가계부 양식`, `가계부 엑셀`, `편한가계부`, `토스 가계부`, `엑셀 가계부` … | Wording only, no counts. |
| Google suggest | Yes, curl | https://suggestqueries.google.com/complete/search?client=firefox&hl=ko&gl=kr&q=%EA%B0%80%EA%B3%84%EB%B6%80 | `가계부 앱 추천`, `가계부 엑셀 양식 2026`, `가계부 어플 추천 디시` … | Wording only. |
| Google Trends daily RSS | Yes, curl | https://trends.google.com/trending/rss?geo=KR | Today's trending searches in Korea | Not per-keyword. Explore is unavailable (see D). |
| 네이버 통합검색 파워링크 | Yes, curl | (row 12 of table A) | Count and names of paying advertisers. For `가계부 템플릿`: 낼나, 공여사들, 투두투, 콩콩가계부, 노마드플래너 | A proxy that someone pays for this traffic. Volatile. |
| 네이버 카페 header | Browser | https://cafe.naver.com/goodhakwon/1243048 | `카페멤버수 268,394`, `전체글보기 532,327`, `2006.02.08. 개설` (학관노, 학원 관리 노하우) | Where operators gather. A good reach figure for B2B niches. |
| 블라인드 search | Yes, curl | https://www.teamblind.com/kr/search/%EA%B0%80%EA%B3%84%EB%B6%80 | `전체 (2239) 블라블라 (1332) 결혼생활 (284) 주식·투자 (217)` | Office-worker audience only. |
| Google Play install bands | Yes, curl | (row 10 of table A) | `1,000만+ 다운로드`, exact count in page data (23,231,415 for 편한가계부) | Cumulative installs, not active users. |
| Chrome Web Store users | Yes, curl | (row 20 of table A) | `10,000 사용자` | Global. |
| YouTube views | Yes, curl | (table B) | Per-video view counts in `ytInitialData` | Mapping views to titles needs JSON parsing. |
| 크몽 supply counts | Yes, curl (API) | (row 3 of table A) | `totalItemCount`: 가계부 443, 노션 템플릿 512; 엑셀 자동화 and 학원 관리 both 1200 | 1200 looks like a cap. Supply, not demand. |
| 텀블벅 search counts | Browser | https://tumblbug.com/search?query=%EA%B0%80%EA%B3%84%EB%B6%80 | `106개 프로젝트` (가계부), `232개 프로젝트` (노션 템플릿) | Supply. |
| 와이즈앱 insight | Browser | https://www.wiseapp.co.kr/insight/ | e.g. `클로드 국내 사용자 500만 명...1년 새 10배 증가` (2026-11-10) | Panel estimates. Only categories they choose to publish. |
| 모바일인덱스 rank | Browser | (row 11 of table A) | Rank lists by store | No figures without login. |
| KOSIS | Browser (nested iframes) | https://kosis.kr/statHtml/statHtml.do?orgId=101&tblId=DT_1K52B01 | Table `시도 · 산업 · 사업체구분별 사업체수, 종사자수(`06~ )` rendered numbers such as `3,950,192` and `21,259,243` | curl gets an SSO shell. The grid sits two iframes deep. I did not confirm row labels. The open API needs a key [M]. |
| 혁신의숲 | Partly | https://www.innoforest.co.kr/company/CP00000167 | `고용인원 242명` visible; `매출액`, `누적투자유치금액` show `로그인하기` | Login wall, and the terms forbid automated collection and AI use (see D). |

---

## D. Sources that do not work, and why

| Source | What happened (2026-11-16) | Use instead |
|---|---|---|
| 네이버 쇼핑 search (`search.shopping.naver.com`) | Redirects to `nid.naver.com/nidlogin.login`, in curl and in the browser | Shopping cards inside 네이버 통합검색 (table A, row 12) |
| 스마트스토어 product and store pages | Same login redirect, in curl and in the browser (`smartstore.naver.com/main/products/…` and a store home) | Same as above. Rating and review count appear on the search card. |
| 네이버 카페 member-only articles without a token | Login popup | Open the article through the `art=` URL from the cafe-tab search |
| 블랙키위 (keyword volume) | Shows a checkbox CAPTCHA (`보안 인증이 필요합니다`) | 네이버 데이터랩 (relative only). No free absolute-volume source was found. |
| 아이템스카우트 keyword page | Shell only. The keyword table headers render with no values to curl. Not pursued further. | — |
| Google Trends explore and its API | HTTP 429 to curl **and** in the browser | Google Trends daily RSS; 네이버 데이터랩 |
| FTC 통신판매업 lookup (`ftc.go.kr/bizCommPop.do?wrkr_no=…`) | Text CAPTCHA (`위에 보이는 문자를 입력해 주세요`) | The 사업자 정보 printed in app-store listings (the App Store page shows `사업자 등록번호`, marked as not verified by Apple) |
| THE VC (thevc.kr) | Timeout in curl, WebFetch and the browser (`ERR_TIMED_OUT`) | DART for audited firms |
| 잡플래닛 | Cloudflare "Sorry, you have been blocked" (curl; not tried in the browser) | 블라인드 |
| 혁신의숲 figures | Revenue and investment are behind `로그인하기`. Footer: `혁신의숲은 사전 승인 없는 데이터의 수집·추출, 인공지능(AI) 학습과 활용 등을 금지합니다.` | Do not use it for automated proof. |
| Reddit | `.json` 403; old.reddit block page; WebFetch refuses | — |
| Product Hunt | Cloudflare "Just a moment..." (403) to curl; not tried in the browser | GeekNews Show, 디스콰이엇 |
| 와디즈 by curl or WebFetch | Akamai `Access Denied` | A real browser (it worked) |
| GeekNews search by curl | The search runs through Google CSE in JavaScript, so the HTML has no results | `news.hada.io/show` and topic pages (server-rendered) |
| Apple marketing-tools RSS v2, top grossing | `https://rss.marketingtools.apple.com/api/v2/kr/apps/top-grossing/10/apps.json` → 404. v2 top-free works; v2 top-paid returned 504 once, then 200. | The legacy `itunes.apple.com/kr/rss/topgrossingapplications/…/json` (works, filters by genre; `limit` capped at 100) |
| 앱인토스 catalog | None public. The console (`apps-in-toss.toss.im`) is a login SPA. Docs list analytics only for partners. | Toss blog case studies (self-reported) |
| Microsoft Store search | Result list is JavaScript-only; low relevance for Korean consumer software | Product pages carry JSON-LD (`"ratingValue":2.7,"ratingCount":3051` for one app); `storeedgefd.dsx.mp.microsoft.com/v9.0/products/{id}?market=KR` returns price without a key |

No failure above was caused by this machine's shell sandbox. The THE VC timeout also happened in WebFetch and the browser, which run outside it.

---

## E. Could a plain headless Chrome read each working source?

These are judgements from what I saw:
- **Server HTML:** curl received the figure in the HTML.
- **JS-rendered:** only a real browser showed the figure.
- **Bot check:** what blocked the non-browser clients.

The browser I used presented a normal UA. A headless Chrome that announces `HeadlessChrome` in its UA is more likely to be blocked on the Akamai and Cloudflare sites, so the checker should set a normal UA.

| Source | Rendering | Bot check seen | Headless Chrome verdict |
|---|---|---|---|
| iTunes Search, Lookup, RSS reviews and charts | JSON | None | **Yes**: open the URL and read the JSON text |
| App Store web page | Server HTML | Rate limit: 429 after about 4 quick requests; returns an empty JS shell | **Yes, if paced** (one page every few seconds); counts are rounded (`8.8천개의 평가`) |
| Google Play app page | Server HTML (top fields) plus embedded data | None | **Yes** for rating, review count, install band and the `인앱 구매` flag. The price range and exact installs are in script data, so read the page source, not innerText. Reviews need clicks. |
| 원스토어 app page | Server HTML | None | **Yes** |
| 원스토어 search | JS | None | Yes in a browser; the parameter is `?keyword=` (`searchKeyword` does not run a search) |
| Chrome Web Store item | Server HTML | None | **Yes** |
| 크몽 gig page | Server HTML | None | **Yes**. `N건 판매` lives in `<meta name="description">`, so read `document.querySelector('meta[name=description]').content`. Visible: `리뷰 (N)`, `총 거래 건수 N건`. Note: the meta rating differs from the visible rating (4.9 vs 4.8). |
| 크몽 search page | JS (API-fed) | None | Yes in a browser; or use the API |
| 텀블벅 page | JS (4.5 KB shell) | None | **Yes** after render (`모인금액 27,073,000원 후원자 752명`); the API is simpler |
| 와디즈 | JS | **Akamai** | **Likely yes with a normal UA**; my browser passed, curl and WebFetch did not |
| 숨고 | JS | 403 to curl | Likely yes with a normal UA (my browser passed) |
| 탈잉, 클래스101 lists, 모바일인덱스, 와이즈앱 | JS | 와이즈앱 202 to curl | Yes in a browser |
| 비즈폼 item | Server HTML | None | **Yes** |
| 예스폼 | Server HTML (EUC-KR) | None seen | Yes in a browser; no per-item sales counts |
| Notion template marketplace | Server HTML | None | **Yes** |
| 네이버 통합검색 and cafe tab | Server HTML | None | **Yes**, but results change over time; a proof must not depend on rank or position |
| 네이버 카페 article (with `art=`) | JS in an iframe (`#cafe_main`) | Login for member boards | Yes while the token is valid; read the iframe document |
| 네이버 데이터랩 result | Server HTML with embedded JSON (`#graph_data`) | None | **Yes** |
| 블라인드 post | Server HTML | None | **Yes** |
| 클리앙 search and article | Server HTML | None | **Yes** |
| 뽐뿌 article | Server HTML (EUC-KR) | 403 to curl | Likely yes in a browser (mine passed) |
| GeekNews Show and topic, 디스콰이엇 | Server HTML | None | **Yes** |
| HN Algolia API | JSON | None | Yes |
| YouTube | JS; data in `ytInitialData` | None | Views yes; comments need scrolling |
| DART viewer | Server HTML (frameset → viewer.do) | None | **Yes**; open `report/viewer.do?...` directly, not `main.do` |
| KOSIS table | JS, nested iframes | SSO redirect shell to curl | Yes in a browser, but fragile to quote |
| 혁신의숲 | JS | Login wall | No for figures; terms forbid it |

---

## F. Three worked examples (all figures fetched 2026-11-16 unless marked)

### F-a. Consumer: 가계부 (recording and reviewing household spending)

**The job:** keep a running record of household spending, see where the money went, and plan next month. It is often shared by a couple.

**Three paid products, each with price and payment evidence:**

1. **위플 가계부 Pro**: a paid app at **￦32,000** (one-off).
   - `userRatingCount` **8776**, `averageUserRating` 4.79, from https://itunes.apple.com/lookup?id=441683476&country=kr [F]
   - The App Store page reads `￦32,000`, `8.8천개의 평가`, chart `#1` in `금융`, from https://apps.apple.com/kr/app/id441683476 [F via WebFetch; curl got 429]
   - It is **#1 Top Paid, Finance, Korea** and **#8 Top Grossing, Finance, Korea**, from https://itunes.apple.com/kr/rss/toppaidapplications/limit=10/genre=6015/json and https://itunes.apple.com/kr/rss/topgrossingapplications/limit=10/genre=6015/json (feed updated 2026-11-15T16:15:21-07:00) [F]
   - Reading: at least 8,776 people paid. Each rater had to download a paid app. Family Sharing is the exception, and past prices may have differed.
2. **편한가계부 (Realbyte)**: free app with a subscription, **`1개월 구독 ￦2,900`, `12개월 구독 ￦24,000`**.
   - Page text: `8.8만개의 평가 4.8`, `차트 #95 금융`, from https://apps.apple.com/kr/app/id560481810 [F]
   - The paid ad-free edition **편한가계부 (광고제거) ￦9,900** has `userRatingCount` **17498**, from https://itunes.apple.com/lookup?id=564730202&country=kr. It is #3 Top Paid Finance KR. The free app is #7 Top Grossing Finance KR. [F]
   - Google Play: `4.8 star 리뷰 47만개`, `1,000만+ 다운로드` (exact `23231415` in page data), in-app `항목당 ₩2,900 - ₩24,500`, from https://play.google.com/store/apps/details?id=com.realbyteapps.moneymanagerfree&hl=ko&gl=KR [F]
   - 원스토어 paid edition: `8,800원 … 4.7 평점 1만+ 다운로드`, `862 명`, from https://m.onestore.co.kr/v2/ko-kr/app/0000281872 [F]
3. **카네 Kane – 간편한 가계부**: a paid app at **￦6,600**.
   - **#2 Top Paid, Finance, Korea** (same feed) [F]
   - `userRatingCount` **82**, released 2026-01-16, from https://itunes.apple.com/lookup?id=6757577312&country=kr [F]
   - Reading: a new paid entrant reached #2 within ten months, but its absolute buyer count is small.

**Three verbatim complaints:**

1. 위플 가계부, App Store, ★2, 2026-09-25, title `개빡쳐요 이유없는 데이터 소실`:
   > "5년간 잘 써왔고 어제새벽까지 썼는데 일어나보니 모든 5년간의 기록이 사라져있습니다 자동백업기록이 남아있는데 다운받아도 아무것도 돌아오지 않았어요"

   https://itunes.apple.com/kr/rss/customerreviews/page=2/id=467936485/sortby=mostrecent/json [F]
2. 위플 가계부, App Store, ★1, 2026-09-12, title `개편되면서 누락이 너무 많아요`:
   > "너무 기본이 안된 기능으로 바꾸면서 과금 구조만 추가된 것 같은데.."

   Same URL, page 2 [F]
3. 편한가계부, Google Play, ★1, 2026-11-04:
   > "최근들어 금융 앱 알림 인식이 안되면서 자동입력이 안되네요...핸드폰을 껏다켜봐도 똑같고 빠른 개선이 필요해보입니다"

   Page: https://play.google.com/store/apps/details?id=com.realbyteapps.moneymanagerfree&hl=ko&gl=KR. I read it through the `batchexecute` reviews POST (newest, ★1) [F]. To re-check, open `리뷰 모두 보기` and filter to ★1.

**Unmet need**, 네이버 카페 다이렉트 결혼준비 (post seen in the cafe-tab search snippet):
> "두사람 카드가 다 자동으로 연동됐으면 좋겠는데 그런 어플은 없네요"

https://cafe.naver.com/directwedding/9492108 [F snippet; article not opened]

**Reach:**
- 네이버 데이터랩 shows 가계부 searches peaking on 1 January (index 100 on 2026-01-01; monthly averages 49.9 in Dec-2025 and 24.4 in Nov-2026) [F].
- Autocomplete shows people asking for apps (`가계부 어플 추천`) and spreadsheets (`가계부 엑셀 양식 2026`) [F].

### F-b. Small business: 학원 관리 (attendance, tuition billing, notices and homework for small academies)

**The job:** a 원장 or teacher of a small academy needs to:
- check students in and out,
- notify parents,
- bill and collect tuition,
- track homework,
- and do it without hiring staff.

**Three paid products, each with price and payment evidence:**

1. **출결톡 (비에이치소프트)**: plans `Free Class … 0원 /월`, `키오스크 Class … 5,500 원 /월`, `간편결제 Class … 5,500원 /월`, `프리미엄 Class … 9,900 원 /월`; claim `16,000+ 학원 사용` (self-reported). From http://www.attalk.co.kr [F]
   - Payment evidence: its operator app on Google Play shows **`인앱 구매`, `항목당 ₩12,000 - ₩120,000`**, `5만+ 다운로드` (exact `95682` in page data) and `4.3 star 리뷰 100개`, from https://play.google.com/store/apps/details?id=com.bhsoft.inouttalk&hl=ko&gl=KR [F]
   - Reading: academies buy items inside the operator app, and tens of thousands of staff devices installed it.
2. **클래스업 (샘랩(주))**: `무료 (0원)`, `Lite (29,000원/월)`, `Pro (89,000원/월)`, free up to `학생 100명`, from https://docs.channel.io/classup_guide/ko/categories/3%EC%9A%94%EA%B8%88%EC%A0%9C-9efc0391 [F]
   - Payment evidence (weak): the operator app has `5천+ 다운로드` (exact `7978`) and `리뷰 5개`, from https://play.google.com/store/apps/details?id=com.samlab.classupadmin&hl=ko&gl=KR [F]
   - No public paid-customer count was found, and 샘랩 had no DART filing.
   - Reading: this is a price point, not proof of volume.
3. **크몽 노션 template, "과외학원 선생님을 위한 학생,점수,교재 관리 / 버전1"** (a paid workaround):
   - meta `문서 자료 | 평점 4.8 (26개 리뷰) | 12,000원부터 | 128건 판매`
   - visible `리뷰 (26)` and the seller's `총 거래 건수 381건`
   - from https://kmong.com/gig/529026 [F]
   - Reading: 128 platform-counted purchases of a do-it-yourself 학원 tool.
   - **Also on sale:** 비즈폼 sells an Excel 학원 원생등록관리 program at `다운로드 건당 49,000 원` (`조회수 3,906`, no sales count), at https://www.bizforms.co.kr/form/excel/sales/30006869 [F].

**Three verbatim complaints:**

1. 출결톡 operator app, Google Play, ★1, 2023-12-30:
   > "출결톡 계속 먹통이고 로딩만 되고 있는데 연말 월말에 프로그램 안되면 어떻게 합니까. 1월 2일까지 그냥 기다려야 되는건가요?"

   Page: https://play.google.com/store/apps/details?id=com.bhsoft.inouttalk&hl=ko&gl=KR, read via the reviews POST (★1, newest) [F]. Older review; check its date on re-open.
2. 네이버 카페 학관노 (268,394 members), post 2022-10-04 `학원관리프로그램 추천이용`:
   > "피드백에 조금 신경을 쓸까해서 관리프로그램을 찾고있는데.왜케 다 어렵나요? ㅋㅋㅋ"

   https://cafe.naver.com/goodhakwon/1243048. This is a member-only board. I read the full post and comments in the browser via the `art=` URL from the cafe search [F]. Many of the 17 replies are vendors pitching products, which is itself a sign of a crowded paid market.
3. 네이버 카페 성공하는 공부방 운영하기, comment in a post from about a week ago:
   > "저희학원은 결제는 결제선생쓰고 출결이랑 과제만 필요한 상황이었는데 결제선생은.. 오류는 둘째치고 저런 학생관리가 솔직히 힘들어요. 그래서 다른 관리프로그램이나 엑셀노션 병행 필수여서"

   https://cafe.naver.com/makegoodstudy/782013 [F snippet via https://search.naver.com/search.naver?ssc=tab.cafe.all&query=%ED%95%99%EC%9B%90%20%EA%B4%80%EB%A6%AC%20%ED%94%84%EB%A1%9C%EA%B7%B8%EB%9E%A8%20%EC%B6%94%EC%B2%9C]

   **Caution:** this same comment goes on to recommend a rival product (아카365), so it may be vendor marketing. A proof stage should flag comments that end in a product pitch.

**More signal:**
- Parent and student apps of 학원 systems rate poorly on the App Store, from iTunes Search `학원 관리` [F]:
  - 학원친구: 2.72 from 368 ratings
  - 통통통(학부모용): 2.0 from 280
  - 랠리즈: 2.53 from 202
- A teacher-side ★1 review of 랠리즈, 2026-06-18:
  > "생일 알림도 안뜨게 설정좀 만들어주게요 학생이 한둘도 아니고 알림 다 꺼둬도 생일알림은 맨번오고 난리"

  https://itunes.apple.com/kr/rss/customerreviews/page=1/id=1605911146/sortby=mostrecent/json [F]
- Price sensitivity, 출결톡 ★1, 2024-02-07:
  > "무료라고 명시해 놓고는 가입후 들어가 보니 유료네요! 유료면 사용하고 싶지 않네요"

  [F, via the reviews POST]

### F-c. Template and workaround market: 가계부 spreadsheet and Notion templates

**The job:** the same household-budget job as F-a, done in Excel, Google Sheets or Notion. These buyers want control and a nicer layout, and they pay for a ready-made sheet instead of an app.

**Three paid products, each with price and payment evidence:**

1. **크몽 "입력만하면 자동결산되는 편하고 힙한 만년형 노션가계부"**:
   - meta `기타 | 평점 4.9 (103개 리뷰) | 25,000원부터 | 476건 판매`
   - visible `리뷰 (103)`, seller `총 거래 건수 895건 만족도 98%`
   - https://kmong.com/gig/480731 [F]
2. **크몽 "26년 엑셀 or 스프레드시트 가계부 드려요."**:
   - packages `STANDARD 19,000 원`, `DELUXE 22,000 원`, `PREMIUM 35,000 원`
   - meta `문서 편집 | 평점 5.0 (82개 리뷰) | 19,000원부터 | 1일 이내 완료 | 168건 판매 | 10분 내 응답`
   - seller `총 거래 건수 473건`
   - https://kmong.com/gig/359161 [F]
3. **텀블벅 "2027년을 시작하는 나의 처음 가계부"** (a Google Sheets 가계부, funding open, `25일 남음`):
   - `amount` **1,256,600**, `pledgedCount` **43**, `fundingGoal` 500,000, `percentage` 251
   - https://tumblbug.com/api/v3/project/mondaykeeper_budgetplanner/detail; page https://tumblbug.com/mondaykeeper_budgetplanner [F]

**Supporting figures:**
- **A 노션 가계부 template on 스마트스토어**, as a card on 네이버 통합검색:
  - `2026 개정판 노션 가계부 템플릿 자동결산 통장쪼개기 예산관리 아이패드 만년형 할인 전 판매가 29,000 원 30 % 할인 20,300 원 … 4.78 (304) 찜 143`
  - https://search.naver.com/search.naver?where=nexearch&query=%EA%B0%80%EA%B3%84%EB%B6%80%20%ED%85%9C%ED%94%8C%EB%A6%BF [F]
  - The store page itself is login-walled.
- **The ceiling for a template category** (self-improvement Notion template): 텀블벅 노션시티 `27,073,000원` from `752명`, at https://tumblbug.com/api/v3/project/notioncity/detail [F].
- **Paid Excel automation on 크몽:** gig 464208, `엑셀 양식작성 / 매크로,VBA 자동화 셋팅해드립니다.`, price 10,000, `reviewCount` **1582**, from the kmong search API [F].

**Three verbatim complaints and unmet needs:**

1. 네이버 카페 10억아빠의 부자공식, comment under a free Excel 가계부 template post (2026-09-26):
   > "매달 시트 새로 만들기 너무 귀찮은데 좋은 방법 없을까요?"

   https://cafe.naver.com/10billiondad/1681 [F snippet via the cafe-tab search for `엑셀 가계부 포기`]
2. Same thread:
   > "구글 스프레드시트랑 엑셀이랑 호환이 되나요? 폰으로 쓰고 싶어서요"

   https://cafe.naver.com/10billiondad/1681 [F snippet]
3. 네이버 카페 다이렉트 결혼준비 (4 days before the fetch):
   > "저는 예랑이랑 공유하려고 스프레스시트 받아서 정리하고 있는데 예상 예산 범위가 적혀있는 구성이라 좀 불편해서 바꿔보려구요!"

   https://cafe.naver.com/directwedding/9565799 [F snippet via the cafe-tab search for `노션 가계부 불편`]

**The best-selling seller states the limit in its own words**, on the kmong page:
> "은행·카드 사용내역을 자동으로 불러오는 가계부를 원하신다면 적합하지 않을 수 있습니다."

https://kmong.com/gig/480731 [F]

Together with the ★1 complaints about auto-entry in F-a, this outlines the gap: people pay for template control, but they also want automatic import and phone use.

---

## Appendix: source-by-source test log (brief items 1–11)

Every entry was fetched 2026-11-16. Each gives: does it work, an example, what came back, the limits, and what it proves.

**1. Apple**
- **iTunes Search API**: works.
  - Example: https://itunes.apple.com/search?term=%EA%B0%80%EA%B3%84%EB%B6%80&country=kr&entity=software&limit=15
  - 13 results. Fields include `trackId`, `trackName`, `formattedPrice`, `price`, `userRatingCount`, `averageUserRating`, `userRatingCountForCurrentVersion`, `sellerName`, `releaseDate`, `currentVersionReleaseDate`, `genres`, `description`.
  - Counts move within minutes: 위플 가계부 read 217,575 and then 217,599.
- **Lookup API**: works, comma-separated ids.
  - Example: https://itunes.apple.com/lookup?id=560481810&country=kr gives 편한가계부 87,576 ratings, 4.806, 무료.
- **Customer-reviews RSS JSON**: works, 50 per page.
  - Example: https://itunes.apple.com/kr/rss/customerreviews/page=1/id=560481810/sortby=mostrecent/json
- **App Store web page**: works, server-rendered. It has the rounded rating count, the chart rank, the in-app purchase list with prices, and the seller's 사업자 등록번호 (labelled `Apple에서 확인한 정보가 아닙니다`).
  - Example: https://apps.apple.com/kr/app/id560481810
  - Limit: curl got 429 plus an empty JS shell on later requests. WebFetch succeeded.
- **Chart feeds that exist today**:
  - Legacy `itunes.apple.com/kr/rss/{topfreeapplications|toppaidapplications|topgrossingapplications}/limit=N/genre=G/json` all work with a genre. `limit=200` returned 100.
  - Marketing-tools v2: top-free works; top-paid works (504 once); top-grossing 404.

**2. Google Play**
- **App page**: works.
  - Visible: rating, `리뷰 N만개`, install band, `광고 포함`, `인앱 구매`.
  - Page data: exact installs and `항목당 ₩a - ₩b`.
  - Two review totals appear (`47만개` in the header, `46.3만개` in the ratings block, which is filtered by device).
- **Reviews**: about 3 are in the HTML. The `batchexecute` POST (`UsvDTd`) returns 20 per call, sortable by newest and filterable by star, with no login or key.
- **Search page**: works, server-rendered, with package ids.
  - Example: https://play.google.com/store/search?q=%EA%B0%80%EA%B3%84%EB%B6%80&c=apps&hl=ko&gl=KR

**3. 원스토어, Chrome Web Store, Microsoft Store**
- **원스토어**:
  - Search is JS and needs `?keyword=`, e.g. https://m.onestore.co.kr/v2/ko-kr/search?keyword=%EA%B0%80%EA%B3%84%EB%B6%80 in a browser. It listed paid apps such as `편한가계부 (+음성, PC) … 8,800원` and `하운 가계부 프로 … 3,500원`.
  - App pages are server-rendered, with price, rating, rater count and download band.
- **Chrome Web Store**: search and item pages are server-rendered, with users and rating count. The figures are global.
- **Microsoft Store**:
  - Product pages show `This page requires JavaScript` to curl but embed JSON-LD with rating and price.
  - The `storeedgefd` API works without a key.
  - Low relevance for Korea.

**4. 크몽, 숨고, 클래스101, 탈잉**
- **크몽**: see tables A and F.
  - Gig pages are server-rendered.
  - The meta description holds `N건 판매`.
  - The visible page holds `리뷰 (N)`, package prices and `총 거래 건수`.
  - The search page is JS; the API works.
  - That reviews come only from buyers is my understanding of kmong's policy [M].
- **숨고**: curl 403; the browser renders the pro list with `N회 고용` and reviews.
  - The `keyword` parameter was dropped (redirected to `/search/pro/review_count`), so search by category path instead.
  - Lists show pros' personal names; leave them out of proofs.
- **클래스101**: search lists are JS; the product page is server HTML without price or reviews; the model is subscription. Weak.
- **탈잉**: search is JS; the browser shows price per month, rating and review count. The query was mostly ignored.

**5. Crowdfunding**
- **와디즈**: see tables A, D and E.
  - Search URL: https://www.wadiz.io/web/wcampaign/search?keyword=%ED%94%8C%EB%9E%98%EB%84%88%20%ED%85%9C%ED%94%8C%EB%A6%BF
  - Cards show `달성 %` and `N만 원+`; for example `<아이패드 드로잉 마스터> … 7,708% 달성 7,708만 원+ 종료`.
- **텀블벅**:
  - Pages are JS.
  - The API is `/api/v3/project/{slug}/detail`, with fields `amount`, `pledgedCount`, `fundingGoal`, `percentage`, `ended`, `succeeded`, `reviewGoodRate`, `likedCountCache`, `expectedPaymentDate`.
  - Search, in a browser, shows the project count and per-card `%` and `원`.

**6. Template and form markets**
- **Notion marketplace (ko)**: server-rendered, no sales counts.
- **예스폼**: renders in the browser at `/z_n/forms/search.php?q=…`. It is a membership site with no per-item counts. My first curl used a wrong path and got 404.
- **비즈폼**: server-rendered. Price per download, views, and the site claims `26만 검증 서식 950만 누적 회원`.
- **Spreadsheet templates on 크몽**: work (table F-c).
- **스마트스토어 review counts**: only via 네이버 통합검색 cards, because store pages are login-walled.

**7. Communities and launches**
- 디스콰이엇 and GeekNews Show work and are server-rendered. GeekNews search is JS via Google CSE.
- Product Hunt: Cloudflare 403 to curl.
- HN Algolia works, e.g. https://hn.algolia.com/api/v1/search?query=korea%20app&tags=story&hitsPerPage=5 gives `nbHits` 408. Little Korean signal.
- Reddit fails.
- 클리앙 works.
- 뽐뿌: search works; articles open in the browser only.
- 네이버 카페: see table B.
- 블라인드 works.
- YouTube: partly.

**8. Search demand**
- 네이버 데이터랩: the web form needs no login; results are relative.
- Google Trends: explore fails with 429; the RSS works.
- 블랙키위: CAPTCHA.
- 아이템스카우트: values not in the HTML.
- 네이버 and Google autocomplete: work.
- 네이버 related searches appear inside the integrated search page (server HTML) [F, not parsed in detail].

**9. Company-level**
- 혁신의숲: partly (login and terms).
- THE VC: [NR] timeout.
- 잡플래닛: Cloudflare block.
- DART: works.
  - Search: POST `https://dart.fss.or.kr/dsab007/detailSearch.ax` with `textCrpNm`.
  - The document tree is on `dsaf001/main.do?rcpNo=…`; the content is on `report/viewer.do?...`.
  - 크몽's audit reports appear for FY2023–2025.
  - 페이민트, 비에이치소프트 and 샘랩 returned no filings for 2023–2026.
- FTC 통신판매업 lookup: CAPTCHA.
- 모바일인덱스: browser, rank lists without login.
- 와이즈앱: browser, press items with MAU and 결제추정금액.

**10. Statistics**
- KOSIS: table pages render in a browser inside nested iframes; the search page is server-rendered; the open API needs a key [M].

**11. 앱인토스**
- No public catalog of mini-apps with usage figures.
- The console needs login.
- Partner case studies on `toss.im/apps-in-toss/blog/…` give self-reported revenue.
- A Toss press figure (`출시 100일 만에 제휴 미니앱 200개`, about 2.6 million cumulative users) appeared only in a search summary [S], not fetched.

---

## Notes for building the proof check

- **Record proofs by where the figure lives:**
  - visible text,
  - a `<meta>` tag (kmong `N건 판매`),
  - embedded script data (Play exact installs and price range, the DataLab `#graph_data`),
  - or a JSON endpoint (iTunes, Tumblbug, kmong API).

  A headless Chrome check that only reads `innerText` will miss the second and third kinds.
- **Counts drift daily, and pages round them** (`8.8천` against an API value of 8776). The check should accept either the exact figure or the page's rounded form, and should allow forward drift for counters such as sales, reviews and backers.
- **Pace requests to apps.apple.com** (429 came quickly). The Lookup API and RSS did not rate-limit in this session.
- **Naver cafe proofs:** keep both the article URL and the cafe-tab search URL that produced its `art=` token. The token's lifetime is unknown.
- **Prefer platform-counted figures.** Flag self-claims (vendor "N개 학원 사용", a seller's "600건 판매") and forum comments that end in a product pitch.
- **Where the strongest payment proof is:** for small-business software in Korea, the paid SaaS vendors are mostly private, unaudited and absent from public stores' paid charts. Stronger proof usually comes from paid workarounds (크몽 `N건 판매`, 비즈폼 prices), in-app purchases in operator apps (Play `인앱 구매` ranges), and paid advertising on the keyword (파워링크), rather than from the vendors themselves.
