# What each agent of the run returned, in order (from the workflow's journal)

## plan

```json
{
 "mode": "new",
 "design": "approved",
 "sandboxed": true,
 "room": 1763,
 "summary": "퇴사점검: 회사가 이직확인서·상실신고에 11번을 찍었거나 이직확인서를 내주지 않는 퇴사자가, 휴대폰에서 가입 없이 자기 사정을 고용보험법 시행규칙 별표 2의 14개 사유와 자기 날짜·숫자로 대조해 가능성과 근거 조문을 보고, 증빙 목록과 자기 말로 채우는 서식(발급요청서, 정정 요청서, 퇴직 경위 진술서)을 받아 가는 무료 웹. 주인이 '예'라고 한 그림 그대로 첫 판 하나로 전부를 짓는다: 정적 화면을 Cloudflare Worker가 내주고, 사람이 넣은 것은 그 브라우저에만 두며, 서버는 판(/healthz), 점검 시작·끝의 수, 오류만 받는다. 화면에 나오는 기준 숫자는 모두 출처 문장이 붙은 기준표 한 곳에서 나오고, 출처를 다시 읽은 곳(임금체불 셈)은 그림 대신 출처를 따른다.",
 "decided": [
  "이 실행은 주인에게 따로 묻지 않고 시작했다(asked: away). 형태(휴대폰 크기의 웹), 서류(그 사람이 빈칸을 채우는 서식), 결제(짓지 않음)는 주인이 '좋아요 진행합시다'라고 한 그림 그대로 간다. 갈림길과 고른 답은 .sz/progress.md에 이 실행의 답으로 적었다.",
  "무엇 위에 서나: Cloudflare Worker가 정적 화면(HTML·CSS·ES 모듈, 빌드 단계 없음)을 내주고, D1에는 날마다 센 수와 오류만 둔다. 사람의 데이터를 받지 않아서 필요한 것이 이것뿐이고, 아무도 오지 않을 때 돈이 들지 않으며 계정 없이 이 Mac에서 돈다. 배포 계정과 비용은 첫 배포 때 주인의 몫이다.",
  "계정은 없다. 넣은 것은 이 기기의 손님 저장(브라우저 localStorage)에만 있고, PV-01에서 한 번에 지운다.",
  "서버는 점검 시작·끝의 수와 오류(시각, 화면, 종류, 커밋)만 받는다. 넣은 글자·날짜·숫자·고른 사정은 받지 않는다. 그래서 PV-01의 '서버에는 처음부터 아무것도 보내지 않았어요'를 '넣은 내용은 처음부터 서버로 보내지 않았어요'로 바꾼다.",
  "임금체불 셈은 고용노동부 상담 답변(inetDcssMngId=202511260536021110474, 2026-11-22에 다시 읽음)을 따른다. 그 답변은 기간을 더하는 것을 '임금 전액이 체불된 경우'에만 하므로, 그림 S1의 '77일 / 60일'(절반만 못 받은 9월분까지 더한 값)은 출처와 맞지 않는다. 같은 입력은 전액 체불 42일, '18일 모자라요', 답 '더 확인이 필요해요'가 된다. 그래서 주 흐름의 주장은 겹치는 곳 없는 전액 체불 입력(63일 / 60일)으로 썼다.",
  "출처의 글이 두 가지로 읽히고 그 읽기에 따라 답이 갈리면 제품은 고르지 않고 '더 확인이 필요해요'라고 한다. 그런 자리: 딱 60일(별표는 '이상', 답변은 '넘으면'), 겹친 체불 기간, 3할 이상 체불이 달로는 2개월인데 날수로는 60일에 못 미칠 때, 10호 자녀의 학년.",
  "다닌 기간 어림은 이직일을 포함해 거꾸로 18개월(549일)을 세고 6/7을 곱해 내림한다. 그림의 '약 469일'(547일로 셈한 값)은 '약 470일'이 된다.",
  "최저임금 출처는 최저임금위원회 연도별 결정현황표다(2026-11-22에 읽음: 2025년 10,030원, 2026년 10,320원, 2027년 10,700원, 월 209시간). 계획이 든 비즈폼과 기사는 쓰지 않는다.",
  "증빙 목록에는 블로그를 출처로 적지 않는다. 법·서식·고용노동부 답변에 없는 항목은 '흔히 가져가는 자료 · 법이 정한 목록은 아니에요'로 단다.",
  "Pretendard는 jsdelivr에서 받지 않고 제품이 함께 내준다. 그래서 페이지가 보내는 요청은 모두 제품 자신의 주소로만 간다.",
  "결제와 유료 패키지, 노무사 제휴, 문장을 지어 주는 모델은 짓지 않는다. 이 실행을 맡긴 쪽이 사건의 결론(공인노무사법)에 따라 정해 주인에게 알렸고, 주인이 '예'라고 한 그림에도 없다.",
  "흐름은 flows/*.sh(sz-eyes web do를 부르는 셸)로 둔다. SZ_URL이 주어지면 그 주소에서, 없으면 스스로 띄운 서버에서 돈다. 셈과 기준표는 node --test로 확인하는 순수 규칙이고, 그 테스트를 코드보다 먼저 쓴다.",
  "'later'에는 한 줄만 적었다: 내놓기 전 단계(진짜 휴대폰, 처리방침과 문구, 아이콘, 주소). 깊이 단계(검증자가 본 것, 수치 요건 줄을 끝까지)는 spec '순서'에 적어 두었고, 첫 판이 선 뒤에 계획한다.",
  "계약 id는 toesa-first로 하고, 주장의 증거 경로를 .sz/evidence/toesa-first/ 아래로 적었다."
 ],
 "later": [
  {
   "title": "내놓기 전: 사람에게 건네도 되게",
   "what": "진짜 휴대폰(아이폰 사파리, 안드로이드 크롬)에서 PDF 저장, 1350 전화, 몇 주 뒤에도 남아 있는 저장을 확인한다. 개인정보 처리방침을 두고, 공인노무사법 제27조제2항에 비춰 문구를 살피고, 수 세기 요청이 부풀려지지 않게 막는다. 볼펜·형광펜 색의 앱 아이콘 후보 둘셋 가운데 주인이 하나를 고르고, 주인이 청하면 사람이 닿는 주소에 올린다."
  }
 ],
 "milestones": [
  {
   "id": "toesa-first",
   "title": "첫 판: 퇴사점검 전부, 그림대로",
   "claims": [
    "wage-check",
    "wage-rule",
    "other-rules",
    "every-reason",
    "cite",
    "source-table",
    "source-read",
    "next-steps",
    "come-back",
    "erase",
    "request-form",
    "proof-list",
    "statement",
    "correction",
    "ask",
    "health-log",
    "nothing-sent",
    "as-drawn",
    "limits",
    "feel"
   ]
  }
 ]
}
```

## build:toesa-first

```json
{
 "contractId": "toesa-first",
 "summary": "I built the first pass of 퇴사점검 and committed it (commits 673fc60 look:, dd0b3a8, af97390). It has all 18 planned screens plus the drawn states, 27 pictures in all, each a phone-size picture beside its drawing in .sz/evidence/toesa-first/screens/, carried over from prototype.html's markup, CSS and tokens. The check flow (ST-01 → CK-01–04 → RS-01/RS-02) works out real results for all 18 reasons and '여기에 없어요'. The figures come from a criteria table, public/js/criteria.js, with 48 entries. Each entry has an official address, the day it was read (2026-11-22) and a quote that I checked against the text I saved in sources/2026-11-22/. The three frozen rule tests pass (34 checks); the path from the first screen to '63일 / 60일 · 요건에 맞아 보여요 · 12번 자리' ran in a headless browser; and every screen held at phone size when filled to the limits. Where it differs from the drawing: the month sheet's '받았어요' became '늦게 받았어요', because the tap step pressed '제때 받았어요' instead. The 사업장 확인란 on the request preview follows the form PDF's own fields. HP-01 has one added line saying 1350 has no consultation fee but the call costs money, because moel.go.kr lists 1350 as a paid line. A limit still open: a month whose payday fell before the one-year window and that stayed unpaid is not counted. The government site served the 고용보험법 articles in their [시행 2028. 1. 1.] version, and that is the text quoted.",
 "launch": "From /Volumes/DEV-SSD/sz-scratch.noindex/drawing-compare/arm-a, first time: `npm install --cache \"$TMPDIR/npm-cache\" && npm run migrate`. Then: `PORT=$(sz-eyes port); WRANGLER_SEND_METRICS=false WRANGLER_LOG_PATH=.wrangler/logs WRANGLER_REGISTRY_PATH=.wrangler/registry npx wrangler dev --ip 127.0.0.1 --port $PORT --var COMMIT:$(git rev-parse HEAD) & pid=$!` (end with `kill $pid`). It is seen at http://127.0.0.1:$PORT/, where the first screen is ST-01 and /healthz answers the commit. I ran it on port 59992 at commit dd0b3a8, looked at the first screen at phone size (no errors logged, no failed requests), then stopped it.",
 "blocked": "",
 "disputes": [],
 "notReal": []
}
```

## verify:toesa-first:5of5

```json
{
 "proven": [],
 "refuted": [
  {
   "id": "as-drawn",
   "fact": "I compared all 27 drawn screens and states with the product at phone size, by part order, words and controls (pairs in .sz/evidence/toesa-first/v5/pairs/, diffs in v5/cmp/<id>.diff). Tokens and part CSS match (#3B5690, #EEDF78). ST-01, CK-03 and DC-01-empty are the same. The differences spec 3 allows are present: 77 days, 469/547 days, the erase-sheet line and the proof-list sources. Other differences remain. CK-04-commute: the badge reads '요건에 맞아 보여요' instead of '맞아 보여요' and drops below the figure; the field shows '220' with '3시간 40분' beside it, where the drawing shows a bus icon, '3시간 40분' and '220분'; and it has a note the drawing does not. CK-04-advice: code 11 reads '개인사정으로 인한 자진퇴사' instead of '개인사정 자진퇴사', plus an added note. CK-04-care and CK-02: line text changed and a note added. RS-01-multi: 1호 라목 and 3의2호 are in the other order, and the '내 숫자' and '이어서 할 것' sections are added. RS-02: a law.go.kr address line and a '내 가능성 보기' button are added. NX-01: step 5 becomes two buttons; a citation chip, '요청한 날 고치기', a sixth step and a fine note are added; the timeline's '받을 수 있는 끝' point is gone. DC-03: the title reads '발급요청서', '자르는 선' becomes '절취선', and the receipt is now a table. DC-05: the chip text changed and the 부정수급 line now states the penalty. DC-06: recipient and sender are split into two fields each. HP-01, DC-01 and CR-01: sentences added. Several of these additions are what the same contract's cite, wage-check and next-steps claims ask for."
  },
  {
   "id": "limits",
   "fact": "flows/limits.sh typed every limit through the screens, and the product kept each one at its full length: name 20, company 40, address 80, phone 13, the 4 statement text fields at 800 each, correction 600, commute 600 min, care 365 days, pay 99,999,999, all 18 reasons and 80 proofs. It then measured 84 screens and states. In 4 of them the '받는 곳 <40-character company name>' chip does not wrap and runs from 16 to 480 px on a 402 px screen, so its text is cut off at the right edge: the DC-03 preview of the request form and of the correction request, each with and without the export sheet open. A 40-character name with spaces is also cut (16–453 px); the plan's 24-character example fits. The other 80 screens and states had no cut text, no sideways scroll and no control under 44 px. The statement's fifth field ('붙이는 증빙') is chips from the proof list, not a text field, so it cannot hold 800 characters."
  }
 ],
 "unchecked": [
  {
   "id": "feel",
   "why": "This is the owner's own verdict. They should look through .sz/evidence/toesa-first/screens/ (27 pictures of the product as it is now, at phone size) and .sz/evidence/toesa-first/v5/pairs/ (each drawing on the left, the product on the right). They should look especially at the differences listed for as-drawn: the commute field, the badge wording, the added notes, the NX-01 buttons and the receipt table in the preview."
  }
 ],
 "noticed": [
  "sz-eyes' own measure ('universal bar') reported 'nothing above minor' on the DC-03 preview even though the recipient chip runs past the screen edge. It looks only at sideways scroll of the whole document and at text clipped inside its own box. flows/limits.sh therefore measures text past the screen edge, sideways scroll inside the screen's scrolling boxes, and input values longer than their field itself.",
  "The HP-01 state the drawing shows ('평소', within 1350's opening hours) could not be compared today. 2026-11-22 is a Sunday, and the product showed the after-hours state with AI 노동법 상담 first."
 ],
 "held": [],
 "broken": [],
 "sandbox": ""
}
```

## verify:toesa-first:3of5

```json
{
 "proven": [
  "erase",
  "request-form",
  "proof-list",
  "statement"
 ],
 "refuted": [],
 "unchecked": [],
 "noticed": [
  "The erase control is unreachable for anyone who filled in the request form from the 서류 tab without finishing a check, even though their name and company are stored on the phone. The 지우기 link exists only on HM-01, and without a check result #HM-01 sends the person to ST-01. ST-01, DC-01, CR-01 and HP-01 each have 0 지우기 buttons (evidence: .sz/evidence/toesa-first/v3/notice/no-check-erase-03-go.png).",
  "On CK-03 the reason reads '가족을 30일 넘게 간호해야 했어요' (more than 30 days), but 별표 2 제7호 and the criteria table's quote say '30일 이상' (30 days or more). Someone who gave exactly 30 days of care may not pick it.",
  "On DC-04 the payslip row says '늦거나 덜 나온 7·9월분', but the text copied by '목록 글로 복사' puts the generic '늦거나 덜 나온 달의 것' on the same row."
 ],
 "sandbox": "",
 "held": [],
 "broken": []
}
```

## verify:toesa-first:4of5

```json
{
 "proven": [
  "ask",
  "nothing-sent"
 ],
 "refuted": [
  {
   "id": "correction",
   "fact": "I checked a 권고사직 case that also had 임금체불. It went 직제개편 with a 카톡 record, plus 7월분 and 9월분 paid late for 63 days, all done on the screens. CK-04 and RS-01 both said '회사가 23번으로 올려야 하는 사정이에요'. Even so, the 정정 요청서 read '별표 2 제1호 나목에 해당한다고 생각합니다 … 사유를 12(으)로 정정해 주시기를 요청합니다'. So it asks for the 자진퇴사 code 12, not 23, which the code table assigns to 권고사직. The 권고사직-only case in flows/correction.sh walked all 54 steps: 11, 23 and 제5호 다목 were in the letter, the empty field kept 600 of 650 characters, the preview carried 받는 곳, 보내는 사람, 회신 기한 and my text exactly, and the 부정수급 line sat right above the export button. The second case in the same flow stops at step 39 (evidence: .sz/evidence/toesa-first/v4/flows/correction-with-wage-20-dc06-with-wage.png)."
  },
  {
   "id": "health-log",
   "fact": "I did one check, pressed '3분 점검 시작' twice, then reloaded RS-01. The day's start and finish counts each rose by exactly one (33→34, 30→31). However, a single check that reached its result and then had its last working day fixed (CK-02 → CK-01 → back to RS-01) raised both counts by two (34/31→36/33), with no new start pressed. Re-entering CK-01 is counted as a new check. /healthz answered the launched commit af97390b19fb057180b8732809b4b2a8aa4f486b. npm run log listed two screen errors with time, screen, kind and commit: RS-01 TypeError, and HM-01 TypeError at /js/app.js:53:48. Evidence: .sz/evidence/toesa-first/v4/health/after-edit.txt."
  }
 ],
 "unchecked": [],
 "noticed": [
  "The font (Pretendard dynamic subset) asks for subset files according to the characters on screen. Typing '똠얌꿹뷁' into 성명 on DC-02 made the page request subsets 38, 49, 58 and 78, which it had not loaded before. The typed letters are not in any request, but which character ranges a person typed ends up in the server's request log (Cloudflare's, once deployed). Evidence: .sz/evidence/toesa-first/v4/explore/font-side.txt.",
  "The HP-01 '내 점검 요약' carries only the best 호, even when several reasons were picked. With 임금체불, 직장 내 괴롭힘 and 연장근로 all picked, the summary was only '별표 2 제1호 나목(임금체불) · 63일 · 기준 60일'.",
  "RS-01 contradicts itself when 임금체불 and 권고사직 are both picked. The 권고사직 row says '회사가 23번으로 올려야 하는 사정이에요', while the '회사가 올린 코드와 견주면' block on the same screen says '이 사정은 12번 자리예요'. This has the same cause as the correction letter asking for 12."
 ],
 "sandbox": ""
}
```

## verify:toesa-first:2of5

```json
{
 "proven": [
  "source-read"
 ],
 "refuted": [
  {
   "id": "source-table",
   "fact": "tests/sources.test.mjs passes (all 6 tests), but some limits on the screens do not come from the table. The ratio '3할' (wage arrears '3할 이상 / 3할 미만') is typed into public/js/app.js in 8 places (lines 80, 102, 395, 405, 414, 434, 458, 748) instead of read from C.over30Share, and over30Share is used nowhere outside criteria.js. It shows on the CK-04 month sheet and in the arithmetic line. The minimum-wage sheet's '주 40시간이면 주휴를 넣어 209시간이에요' uses 40시간 (근로기준법 제50조), which has neither a value nor a source in the table. The test's pattern list leaves out '3할' and '40시간', which is why it passes. Evidence: source-table/screen-03-ck04-month-3hal.png, source-table/screen-06-mw-40h.png"
  },
  {
   "id": "next-steps",
   "fact": "The claim's own figures all hold on screen. With 2026-11-21 entered as the request date, the top says '9일 남았어요' and '12월 1일까지 회사가 내줘야 해요', and the bottom says '2027년 11월 14일까지'; both survive a reload. With 2026-11-07, the top says '기한 지남 · 11월 17일 / 10일이 지났어요' and step 3 (applying without the form) is marked next. Pressing '회사가 안 고쳐 줬어요' opens the 별지 제20호서식 step with '처리기간은 14일' and the form address. Request dates of today, 10 days ago and 11 days ago are also right. The case that breaks it: someone who left on 2027-02-28 and opens the product on 2027-03-05 is told '실업급여는 이직일 다음 날부터 12개월 안에만 받아요 · 2028년 2월 28일까지'. Twelve months from 2027-03-01 run to 2028-02-29. The product counts 이직일 + 12개월, so the end it shows is one day short (flows/next-steps-leap-15-leap.png)."
  },
  {
   "id": "come-back",
   "fact": "The check and all four documents were filled in through the screens. Reopening the address in the same tab, and in a fresh browser given only the stored data, both show '내 점검' instead of the first screen: '9일 남았어요 · 회사가 12월 1일까지', '요건에 맞아 보여요 · 제1호 나목 · 임금체불 63일 / 60일', and 증빙 4/6, 11월 21일 보냄, 3/5칸. The 서류 tab shows '4/6 챙김 · 11월 22일 저장 · 3/5칸 씀 · 11월 22일 저장'. '다시 점검하기' reopens CK-01 to CK-04 with every earlier answer filled in, and no screen asks for sign-up or login. The case that breaks it: someone who edits the request form and the correction letter at 08:30 Korean time on 11-22 is told '11월 21일 저장' on both cards. The product shows the UTC date (updatedAt 2026-11-21T23:30Z, first 10 characters), so anything written in Korea between 00:00 and 09:00 shows as the day before (flows/come-back-morning-08-expect-stopped.png)."
  }
 ],
 "unchecked": [],
 "noticed": [
  "The erase sheet (PV-01) also shows a UTC date. A check started at 08:30 Korean time on 2026-11-22 (createdAt 2026-11-21T23:30Z) is listed as '점검 답 · 2026년 11월 21일' (.sz/evidence/toesa-first/noticed/pv-03-pv01-utc.png).",
  "The table's 8 source addresses for 고용보험법 articles (제40·41·42·48·58·87·116·118조) open the '[시행 2028. 1. 1.]' version on law.go.kr. The quoted sentences are there in that version, but the table does not say whether the version in force today (2026-11-22) has the same text (.sz/evidence/toesa-first/sources/fetched/ei40.txt)."
 ],
 "sandbox": ""
}
```

## verify:toesa-first:1of5

```json
{
 "proven": [
  "wage-check",
  "other-rules",
  "every-reason"
 ],
 "refuted": [
  {
   "id": "wage-rule",
   "fact": "All 34 tests in npm test pass, including the frozen tests/wages.test.mjs. The product still gives worse answers to people who were owed more. Case entered through the product: leaving date 2026-11-14, payday the 10th, and the pay for April to September 2026 each paid 5 days late. Marked '3할 미만', the result is '요건에 맞아 보여요' (체불이 이어진 달 6개월분). The same six months marked '3할 이상' give '고른 사정으로는 요건에 못 미쳐요' (60일 모자라요). Marked '전액', they give '요건에 못 미쳐요' (30일 모자라요). Point 5 of the ministry answer accepts even under-30% arrears once six months run without a break, so the source does not give '못 미쳐요' for larger arrears over the same six months; under spec section 4 the answer should at least be '더 확인이 필요해요'. The cause: rule (라) counts the run in months, while rule (다) counts it in days. A second, less clear-cut case: a month whose payday falls just before the one-year window (2025-10분, due 2025-11-10) cannot be entered at all, even when it stayed unpaid well into the window. Pictures: .sz/evidence/toesa-first/wage/break-22-under30-rs01.png, break-38-over30-rs01.png, break-54-full-rs01.png."
  },
  {
   "id": "cite",
   "fact": "Most links work. All 14 rows of the 기준 tab, the 18 article links on CK-04 and the 18 rows of a result with several reasons each open the article exactly as in the law PDF (flSeq=169481947): my own 목 is marked, '별표 2 〈개정 2024. 7. 1.〉' is there, and so is the law.go.kr address. One case fails. Under '임신·출산·육아', a child born 2017-03-01 (aged 9 on the leaving date) who is not in grade 2 or below gives '요건에 못 미쳐요 · 자녀가 8세 이하 또는 초등학교 2학년 이하가 아니에요'. That result has no link to 제10호; the only link to the article sheet is '별표 2 제13호'. Below-requirement results attach links only to reasons that have a number. flows/citations.sh stops at that step (part D); parts A, B, C and E pass."
  }
 ],
 "unchecked": [],
 "held": [],
 "broken": [],
 "stood": 0,
 "noticed": [
  "The company deadline is always the request date + 10 days (rules.js companyDeadline). Under 민법 제161조, a deadline that falls on a Saturday or public holiday moves to the next working day. Example: a request on 2026-11-25 (Wed) is shown with a deadline of 2026-12-05 (Sat), so from 12-06 the product can say '10일이 지났어요'. The criteria table does not include 민법 제161조. Recorded with sz-eyes contract notice.",
  "The article sheets that are not 별표 2 (for example '고용보험법 제40조제1항제1호' on CK-02) say they show '고용보험법 [시행 2028. 1. 1.] [법률 제21473호, 2026. 3. 17., 일부개정] 판의 글'. That version is not yet in force on 2026-11-22. Source: law.js ei40 and ei58, and the first line of sources/2026-11-22/ei40.txt.",
  "On a wage result where every month was entered as '전액', the RS-01 '내 숫자' list still shows a row '3할 이상 못 받은 달 · 가장 길게 이어진 기간 38일 · 못 미쳐요'. A person who entered no 3할 이상 month sees an extra '못 미쳐요' badge.",
  "Not the product: sz-eyes 'tap:<words>' can press words behind an open sheet. 'tap:3할 미만' and 'tap:전액' in the month sheet changed nothing or closed the sheet. A click where the button is drawn (elementFromPoint) selects it correctly, so check-reasons.sh and citations.sh tap that way."
 ],
 "sandbox": ""
}
```

