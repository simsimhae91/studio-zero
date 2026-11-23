I settled both claims. I corrected and committed one frozen check, flows/criteria.sh, and it now passes. For as-drawn I amended nothing and disputed nothing: the differences that remain are the product's to mend.

I ran the product from this folder at HEAD ee1bd80 on port 52234; /healthz returned that commit. Your launch line named /Volumes/DEV-SSD/sz-scratch.noindex/drawing-compare/arm-c and commit 4621f06. That is a different copy of the project, and the contract, the flows and the fix are all in this folder. Browser runs went outside the sandbox and nothing was refused. I stopped the server afterwards.

**criteria: corrected**
- **Which case:** the check was wrong about how it pressed. Line 96 of `/Volumes/DEV-SSD/sz-scratch.noindex/after-fix-test/rule-copy/flows/criteria.sh` tapped '가족을 30일 넘게 간호해야 했어요'. The product was mended to follow its source, as the sources claim requires, so the choice now reads '가족을 30일 이상 간호해야 했어요'.
  - I downloaded the PDF myself (law.go.kr flSeq=169481947). Its 제7호 says '30일 이상 본인이 간호해야 하는 기간에'.
  - The drawing still says '30일 넘게'. The sources claim's own refutation named this exact line.
- **What changed:** only the words of that one tap, to `tap:가족을 30일 이상 간호해야 했어요`. No expectation, figure or step changed.
  - Recorded with `sz-eyes contract amend first-pass --file flows/criteria.sh`.
  - Committed alone as 2f91081. The amend text sits in the contract file, which was already modified before I started and stays uncommitted.
  - I grepped the other frozen checks for these old words and found no other match.
- **What it says now:** exit 0, 224 steps all ok.
  - The walk passes step 151 and the three-reason case.
  - In the two-mok case (1호 나목 + 다목), 'from_rs01_na' and 'from_cr01' both read "나다", and the expectation `==="나다"` holds.
  - Pictures are in `/tmp/claude-501/arb-criteria/`.
- **Not corrected:** `.sz/evidence/first-pass/as-drawn/walk-built.sh` taps the same old words ('가족을 30일 넘게'). It is the verifier's own helper, not frozen and not committed, so I left it. I ran a copy with the new words in `/tmp/claude-501/arb-asdrawn/`.

**as-drawn: the product is wrong**
- **Which case:** the product. This claim is shown by a look, so there is no frozen file to amend.
- **What changed:** nothing.
- **What the look says now:** I walked all 27 screens with my copy and compared them with `drawn.json`. Items 2, 3, 4, 7 and 9 now match the drawing. Five differences remain that no claim's words require:
  1. NX-01 and NX-01-sent show six `.cite` parts each; the drawing puts the article in the step's meta text.
  2. RS-01-multi has the extra '이어서 할 것' section.
  3. DC-06 has the separate '답을 받을 날 · 원할 때만' field, and 받는 곳 and 보내는 사람 are underlined inputs.
  4. HP-01 says '유료 전화'.
  5. PV-01 adds the line '요청한 날, 이직일'.
- **Why the fixer's reasons don't hold:** each frozen flow cited presses or reads a form its claim never names. Once the product is mended to the drawing, each can be corrected in how it presses or reads, without a step fewer or a different expectation:
  - `flows/next-steps.sh` lines 53–54 read `.cite .law`. The claim only says each step shows its article, and NX-01 shows no likelihood, so not-a-ruling's link rule doesn't reach it.
  - `flows/evidence.sh` line 133 taps '증빙 목록' on RS-01-multi. The evidence claim names no route, and the flow already reaches DC-04 through the 서류 tab elsewhere.
  - `flows/export.sh`, `flows/limits.sh` and `flows/nothing-leaves.sh` type into '답을 받을 날'. The drawing's caption says the blue-ink values in the letter are entered and can be edited, so the date can be set inside the letter and typed by its name.
  - `flows/erase.sh` line 41 sees '요청한 날, 이직일'. The erase claim says only "날짜", which the drawn PV-01 shows ('날짜, 고른 사정, 내 숫자' and '할 일 날짜'). This is the closest call: whoever corrects erase.sh after the mend must point it at the drawn words without weakening it, or it goes to the owner.
- **Correct the flows only after the mend.** I changed none of these flows, because the product hasn't been mended yet and each passes as it stands. Once the product follows the drawing, the fixer brings them to whoever settles checks.
- **The HP-01 price is a judgement call.** I checked the moel source myself: "대표전화 1350 (유료, 평일 09시~18시)". But no claim covers the price of a call: the sources claim covers criteria and law text, and the ask claim says nothing about price. The contract's "하지 않는 것" says "가격이나 '유료' 표시는 어디에도 없습니다", though that line is about the product's own paid packages. The drawn band itself claims nothing about price, so I left it with the product. If the owner wants the call charge stated, that is a change for them to ask for. If it is the only difference left after the mend, it becomes theirs to rule on.
- **Items 6 and 7 were the look's fault, not the product's.**
  - The walk photographed the commute field while it still had focus. Blurred, it reads '3시간 40분' / '220분' as drawn: `/tmp/claude-501/arb-asdrawn/commute/B2-08-CK-04-commute.png` against `B2-07-…-focused.png`.
  - The care field now matches the drawing.
  - The next look should blur the field before reading (`document.activeElement.blur()`) and tap '가족을 30일 이상'.

Pictures from my as-drawn walk are in `/tmp/claude-501/arb-asdrawn/built/`.
