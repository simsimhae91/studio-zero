I checked my seven claims again on 29d2bb2. Six are proven. criteria is unchecked: its frozen flow still stops on one word. Nothing was refuted. The fix only changed the paper and copy text (app/js/more.js, main.js, styles.css), and none of my claims' screens or rules. So each claim was shown again by its own check, on my own copy (/tmp/claude-501/sz-fp-wrs, port 51977). Evidence is under /Volumes/DEV-SSD/sz-scratch.noindex/after-fix-test/look-copy/.sz/evidence/first-pass/r6-wrs/.

**Verdicts**
- **wage: proven.** flows/check-wage.sh finished both walks and matched 19 of 19, exit 0. It showed "42일 / 60일 · 더 확인이 필요해요 · 18일 모자라요", 1개월분 / 2개월분, "9·10월분, 2개월 이어짐 · 35일", 제1호 나목 and the answer's link.
- **rules: proven.** The frozen tests/rules.test.js passed 17 of 17, exit 0, and npm test passed 33 of 33.
- **other-kinds: proven.** flows/check-other.sh finished its six walks and matched 34 of 34, exit 0.
- **not-a-ruling: proven.** flows/check-none.sh read 94 screens and found 0 mismatches in 163 comparisons, exit 0. Because the fix reached the copied text, I also searched the copied statement, letter and request form for the three forbidden phrases: 0 found (r6-wrs/notices/copies/copies.json).
- **sources: proven.** npm run sources found all 117 lines and missed 0, exit 0.
- **criteria: unchecked.** The frozen flows/criteria.sh still stops at step 151, "tap:가족을 30일 넘게 간호해야 했어요", and exits 1. The drawing says "30일 넘게"; the product says "30일 이상", which is what 별표 2 제7호 says. A copy with only that word changed (r6-wrs/criteria-adapted/diff.txt, line 96) ran to the end and exited 0. Changing the frozen line 96 is the owner's call.
- **next-steps: proven.** flows/next-steps.sh finished all 66 steps, exit 0.

**What stood before:** nothing. `sz-eyes standing` says no closed contract has a proven claim, so held 0, broken 0, unchecked 0. Quick checks: there is still no type check (no tsconfig, no script for one).

**Noticed** (all re-walked on 29d2bb2; evidence in r6-wrs/notices/)
- Code 23 still has two names. CK-04 says "경영상 필요에 의한 퇴사(권고사직 포함)"; RS-01 says "경영상 필요 또는 회사불황으로 인한 인원감축 등에 의한 퇴사(해고ㆍ권고사직 포함)" (advice23.json).
- On RS-01 for care 45 days, refused, with no record, the hero still says "거절된 기록이 있으면 '맞아 보여요'에 가까워요" twice (care-norecord-*-rs01.png).
- With nothing saved, /#HM-01 shows ST-01, but the title is "HM-01 · 퇴사점검" and data-screen is HM-01 (fresh-hm.json).
- NX-01 still accepts a 요청한 날 after today. With 2026-12-25 it shows "42일 남았어요 · 1월 4일까지 회사가 내줘야 해요" (nxdates-17-nx-future.png).
- When the request date falls in another year, the NX-01 header still leaves out the year: "요청한 날 12월 28일 · 회사 기한 1월 7일 · 320일 지남". On the deadline day (request 11-13) it says "0일 남았어요" (nxdates-20, nxdates-23).
- DC-06 still reads "사유를 12으로 정정해 주시기를" (s1docs-25-dc06.png).
- Opening #DC-03 again after a statement preview still does not show the statement. With the request form filled, it shows the 이직확인서 발급요청서 paper (s1docs-28-dc03-again.png).
- RS-01 still has no tab bar (0 nav.tabbar) and no button or link with the word "서류" (s1docs-14-rs01.png).
- HP-01 at Monday 10:00 still puts "무료로 물어볼 곳" and "모두 무료예요" around the 1350 line that says "평일 9~18시 · 유료 전화" (hp-mon1000).
- With all six DC-04 items ticked, the count still shows twice: "6/6" and "6/6 챙겼어요" (s1docs-23-dc04-all.png).
- After "글로 복사" on DC-03, changing to DC-04 inside the app still shows the toast "글을 복사했어요. 메일이나 문자에 붙여 넣어요" (s1docs-22-dc04-toast.png).
- The project still has no type check. npm test passed 33 of 33 and the rules test 17 of 17.
- When only the 3할 미만 line gives the answer (April–September 3할 미만, unpaid at the quit date):
  - CK-04 hero: "0일 / 60일 · 요건에 맞아 보여요 · 전액 체불 기준에 60일 모자라요"
  - RS-01 hero: "전액 못 받거나 늦게 받은 기간 0일 · 기준 60일"
  - HM-01: "요건에 맞아 보여요 · 제1호 나목 · 임금체불 0일 / 60일"
  - The line that gave the answer ("6개월분 / 6개월분 · 맞아 보여요") appears only lower down (under30-33/35/37).
- When the commute 바뀐 날 is the quit date itself (2026-10-31), the field still says "이직일보다 앞" (commute-sameday).
- After entering 요청한 날 2026-11-21 on NX-01, HM-01 shows "발급요청서 11월 21일 보냄", but DC-02 shows 요청일 "2026년 11월 23일 · 오늘" and the paper carries 2026년 11월 23일 (s1docs-19, s1docs-21).
- **New:** for someone who picked only "여기에 없어요", the statement says "내가 본 사유 · 별표 2 제13호(목록에 없는 사정)". The same person's 정정 요청서 (preview and copied text) says "별표 2 ______에 해당한다고 생각합니다 … 사유를 바르게 정정해" (none-letter/none-letter-12-fix-preview.png).
- **New, belongs to export:** in a 정정 요청서 with "실제로 있었던 일" left empty, the preview paper shows nothing in that place, with no underline. The "글로 복사" text puts a "______" line there. The fix says blanks are the same on paper and in the copy; this is one place where they are not (same picture; copies.json reads.fix).
- Dropped as ended earlier: RS-02's 시행 기준 for 1호 나목 now names all four counts.

**Could not check**
- criteria by its frozen flow: line 96's "30일 넘게" does not match the product's legally worded "30일 이상".

Cleanup: the server I started (pid 24498) was ended by its id, and the copy was ended with `sz-eyes copy --end`.
