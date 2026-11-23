None of the contract's claims is proven yet, including the one I worked on. I was handed only **as-drawn**, and I did not record any verdicts, as the task asked. Whoever looks again runs all the flows and rules on each claim.

**as-drawn:** I fixed 10 of the 11 differences (commit `0303139`). On my own re-walk, everything left is either required by another claim or listed under notFixed. The fix still has to be re-checked before as-drawn counts as proven.

**Not touched, still shown false:** wage, rules, other-kinds, not-a-ruling, sources, criteria, next-steps, come-back, export, evidence, statement and erase. Each still has the fault named in its verdict, because none of them was handed to me. Re-running the flows confirmed this for other-kinds (no change date), statement (the '11' code in the letter), export (the copied text) and next-steps (the 2028-02-29 date). It also confirmed two existing faults the rules claim names: a month paid on time still counts as unpaid, and the end of the 12 months is computed one day early.

**Flows my fix will break at the next look:**
- **next-steps:** `flows/next-steps.sh:53` reads each step's article from the old separate part. The drawing puts it at the end of the step text, so the flow now stops at that line. Every later step passed on a copy with only that check changed, except the known 2028-02-29 date fault.
- **erase:** `flows/erase.sh:41` waits for '요청한 날, 이직일'. The drawing doesn't have that line, so the flow now stops there.

notFixed:
- as-drawn: `app/js/more.js` HP-01 still shows '유료 전화' next to 1350. The drawing omits it, but under the heading '무료로 물어볼 곳' that would read as a free call. The source says "대표전화 1350 (유료, 평일 09시~18시)", https://www.moel.go.kr/minwon/fastcounsel/fastcounselView.do?inetDcssMngId=202511260536021110474
- next-steps: `flows/next-steps.sh:53-54` reads `.cite .law` in each step. The old form was a separate part "시행규칙 제82조의2제2항"; the new form is "회사는 받은 날부터 10일 안에 내줘야 해요 · 시행규칙 제82조의2제2항".
- erase: `flows/erase.sh:41` checks for "요청한 날, 이직일". That line is gone, and the row now reads only "증빙 체크 n개와 할 일 날짜".
