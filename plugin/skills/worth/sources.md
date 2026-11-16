# Where the world can be read (Korea), without an account or a key

Each of these was opened from this kind of machine on 2026-11-16; the full test log, with what came back and three worked examples (가계부 apps, 학원 관리, 가계부 templates), is `docs/research/2026-11-16-worth/korea-sources.md` in the harness's repository. Sites change what they let be read: when one refuses, say so and use another; never work round a login or a check that the reader is a person.

`sz-eyes worth cite` reads a page as it is sent and, failing that, as a browser draws it, and finds words that stand in a page's hidden description or its data as well as on its face. Quote a figure exactly as the page writes it (`8.8천`, not 8,776; `476건 판매`).

## Money already moves (for `pays`, `price`)

Strongest first. Prefer a count the platform keeps to one the seller claims.

| Where | What it shows | How to reach it |
|---|---|---|
| 크몽 gig page | sales the platform counted (`25,000원부터 \| 476건 판매`, in the page's description), reviews by buyers, the seller's `총 거래 건수` | `https://kmong.com/gig/<id>`; find gigs with `https://api.kmong.com/gig-app/gig/v2/gigs/search?keyword=...` (no key; price and review count for every gig of a kind) |
| 텀블벅 | money paid and by how many (`amount`, `pledgedCount`) | `https://tumblbug.com/api/v3/project/<slug>/detail` |
| 와디즈 | `11,057,000원 달성`, `96명 참여` | the project page; a browser only |
| App Store, a paid app | its price and its count of ratings: at least that many bought it | `https://itunes.apple.com/lookup?id=<id>&country=kr` |
| App Store charts by kind | what earns most today, and what sells most | `https://itunes.apple.com/kr/rss/topgrossingapplications/limit=50/genre=<n>/json` (also `toppaidapplications`) |
| App Store page of an app | the price list inside the app (`￦2,900` a month), rounded count of ratings | `https://apps.apple.com/kr/app/id<id>`; a few pages a minute, it stops answering when hurried |
| Google Play page | range of prices inside the app, exact installs (in the page's data) | `https://play.google.com/store/apps/details?id=<id>&hl=ko&gl=KR` |
| 원스토어 page | a paid app's price and its band of downloads | `https://m.onestore.co.kr/v2/ko-kr/app/<id>` |
| DART | a company's audited revenue (only audited companies; small vendors are not there) | `https://dart.fss.or.kr/report/viewer.do?...` (open the viewer, not the frame around it) |
| 네이버 search | cards of things sold with their count of reviews; who pays to advertise on the word (파워링크) | `https://search.naver.com/search.naver?where=nexearch&query=...`; it changes by the day, so quote the card, not its place |
| a seller's own price page | the price; its "N곳이 씁니다" is the seller's word | — |
| 비즈폼, Notion's template market | a price for a form or a template; no count of sales | — |

For tools small businesses pay for, the vendors are mostly private and in no chart. The money shows instead in paid ways round the problem (크몽 `N건 판매`), in what the operators' own apps charge inside (Play), and in who advertises on the word.

## People say what is wrong (for `gap`, `who`, `now`, `switch`)

| Where | What it shows | How to reach it |
|---|---|---|
| App Store reviews | 50 dated, starred reviews a page; the low ones first | `https://itunes.apple.com/kr/rss/customerreviews/page=1/id=<id>/sortby=mostrecent/json` (pages 1 to 10) |
| 네이버 카페, the search tab | titles, snippets and replies of posts where people ask each other | `https://search.naver.com/search.naver?ssc=tab.cafe.all&query=...`; an article opens only by the link the search gives (its `art=` part), and not for long: quote from the search page when the article will not open |
| 클리앙 | posts with their replies; good for "I moved from X to Y" | `https://www.clien.net/service/search?q=...` |
| 블라인드 | a post, its views and all replies | `https://www.teamblind.com/kr/search/<words>` |
| 원스토어, Google Play pages | a few reviews each (Play's full list needs presses in a browser) | as above |
| An app the business's customers use (the parents' app of a 학원 tool) | the operator's trouble at second hand, in its low ratings | App Store reviews, as above |
| 크몽 gig page | what the seller says the thing is not for | as above |

A reply that ends by naming another product is that product's seller: it is not a complaint.

## How many, and where they gather (for `reach`)

| Where | What it shows | How to reach it |
|---|---|---|
| 네이버 카페 front page | members and posts of the place they gather (`카페멤버수 268,394`) | the cafe's address, in a browser |
| 네이버 데이터랩 | how a word is searched over time, against its own peak (no absolute count) | make the chart in a browser; its result address opens again |
| 네이버 and Google suggestions | the words people type after the word | `https://ac.search.naver.com/nx/ac?q=...&r_format=json...`, `https://suggestqueries.google.com/complete/search?client=firefox&hl=ko&gl=kr&q=...` |
| Google Play installs, Chrome Web Store users | how many have the nearest thing | as above |
| YouTube search | views of videos about the job | the search page's data |
| 블라인드 search | how many posts mention it, by board | as above |

No source read here gives an absolute count of searches for a word without an account. Say so; do not estimate one.

## Did not open (do not spend time)

네이버 쇼핑 and every 스마트스토어 page (login). 블랙키위, the FTC's lookup of sellers (a check that the reader is a person). Google Trends' explore page (refuses). Reddit, Product Hunt, 잡플래닛, G2, Capterra (refuse). THE VC (no answer). 혁신의숲 (login, and its terms forbid collecting by machine: do not use it). 앱인토스 has no public list of its apps.
