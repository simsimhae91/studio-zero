Contract `first-pass`, three items. I looked at everything on the running product (commit e53d5d1, port from `sz-eyes port`, stopped by its own pid afterwards), and I opened the source and the drawing myself. The sandbox did not block any look.

**as-drawn: the claim's own words are wrong, so I disputed it and changed nothing.**
- **What I did first:** I ran the verifier's own walk again (`.sz/evidence/first-pass/as-drawn/walk-built.sh` plus `compare.py`) on all 27 screens of e53d5d1. The output is in `/tmp/claude-501/asdrawn/`.
  - Ten of the eleven differences the verifier listed are gone: NX-01's articles are now in the step text with no `.cite`, the step 4 counts, the '정정 요청서 쓰기' button, the NX-01-sent wording and the 과태료 note, RS-01-multi's '이어서 할 것', the commute and care fields, DC-06's date field, CR-01's 원문 line, and PV-01's '요청한 날, 이직일'.
  - The compare still reads '220' and '45', but those are the hidden input values under the drawn '3시간 40분' and '45일'. The screenshots show the fields as drawn.
- **The one difference left is HP-01's '유료 전화'.**
  - The drawing (`.sz/design/shots/HP-01-phone.png`, `prototype.html` l.1492-1502) puts the 1350 hero under the title '무료로 물어볼 곳' with no charge mentioned. That presents 1350 as a free call.
  - The source the product takes 1350 from (`app/rules/criteria.js` row `ask.1350`, moelWage) says "대표전화 1350 (유료, 평일 09시~18시)": https://www.moel.go.kr/minwon/fastcounsel/fastcounselView.do?inetDcssMngId=202511260536021110474. I read it 2026-11-23.
  - The product follows the source, so no HP-01 can match the drawing and also be true to the source.
- **Recorded:** `sz-eyes contract dispute first-pass as-drawn --ruling ...`. The claim's words are unchanged and it now waits for the owner.
- **Context for the owner:** the contract's "하지 않는 것" says "'유료' 표시는 어디에도 없습니다". That line is about the product's own pricing. The ask verifier also noted that the title and '유료 전화' contradict each other on that one screen.

**next-steps: the flow checked the old form, so I corrected it.**
- **Changed:** `/Volumes/DEV-SSD/sz-scratch.noindex/after-fix-test/fix-copy/flows/next-steps.sh` l.44-45 (new helper `LAW`) and l.55-56 (the expect and the read that used `.cite .law`).
  - The as-drawn mend moved each step's article to where the drawing has it: the end of the step's `.meta` text, after ' · ' (`prototype.html` NX-01).
  - The flow now reads the text after the last ' · ' of `.meta` and requires it to name an article (`/제\d/`). Before, it required a non-empty `.cite .law`.
  - Nothing it expects changed: step names, order, numbers, dates, colour, address, and the 2028-02-29 case.
  - Recorded with `sz-eyes contract amend` and committed alone as cc8be52.
- **What it says now:** it passes the six-steps-with-articles check, which read: 1 시행규칙 제82조의2제2항 · 2 고용보험법 제42조제3항 · 3 같은 조 제3항~제5항 · 4 같은 조 제6항 · 5 별지 제20호서식 · 6 법 제87조제2항. It also passes 11-21 ('8일 남았어요', '12월 1일까지'), 11-07 ('기한 11월 17일 · 6일 지남') and the 별지 제20호서식 address.
  - It then stops at its last step: with 이직일 2027-02-28 the product still says '2028년 2월 28일까지', not 2028년 2월 29일. That is the product's defect, the one in the original refutation. The picture is `.sz/evidence/first-pass/next-steps/next-steps-36-nx-quit-20270228.png`, which my run overwrote with the same state.

**erase: the flow checked the old form, so I corrected it.**
- **Changed:** `/Volumes/DEV-SSD/sz-scratch.noindex/after-fix-test/fix-copy/flows/erase.sh` l.41. `see:요청한 날, 이직일` is now `see:날짜, 고른 사정, 내 숫자`.
  - The old line is gone from the product and the drawing doesn't have it. The claim only says "날짜".
  - The new words are what the drawing shows under 점검 답 to name the dates. `see:증빙 체크 2개와 할 일 날짜` and every other step are unchanged.
  - Recorded with `sz-eyes contract amend` and committed alone as 81992f2.
- **What it says now:** it walks all 72 steps and fails with one finding, the product's own: '모두 지웠어요' shows at 31ms and is blank at 47ms. That is the original refutation, still not fixed.
  - Everything else holds: 취소 keeps all 743 stored characters, nothing is left in the browser, reopening gives ST-01, and the documents are empty.

**Same fault in other checks:** I searched every frozen flow and the test for the forms the as-drawn mend removed or changed:
- the `.cite` part, '요청한 날, 이직일', '처리 14일', '정정 요청서 쓰기', '이어서 할 것', the '원문:' line, '분으로', the NX-01-sent footer and 과태료 note.
- the labels used by `type:답을 받을 날`, `type:바뀐 뒤 왕복 시간(분)` and `type:간호가 필요한 기간(일)`.

No other check reads by a removed form. The three field labels are still on the inputs, and the re-walk typed into all three successfully. I corrected nothing else.

The working-tree change to `.sz/contracts/first-pass.json` (from earlier work plus my amend and dispute records) is not committed by me.
