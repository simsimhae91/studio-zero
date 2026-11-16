# The order of work, measured: one request built six ways, and a second request

2026-11-16, evening and night. The owner's two runs that day (a parcel-price comparer: one page after 3 h 01
min; a diet-battle phone app: nothing to look at after 4 h) led them to write: "프로세스를 리프로세싱 해야하면
그렇게 해야해요", then "사례를 찾아보되 소신을 가지고 진행" and "밤새 돌려도 괜찮습니다. 확실하게만 갑시다".
This is the record of what was run and what it showed. The cases read the same evening are in
`docs/research/2026-11-16-order-of-work.md`; what was decided is `docs/decisions/2026-11-16.md` section 9.

## How it was run

- Headless sessions on the owner's Claude subscription, each in an empty folder of the session scratchpad,
  Opus 5.5, the session at `xhigh` (the plan and the verification think as hard as the session, builders at
  `high`), auto mode, command sandbox on: the owner's own setup.
- The requests were written by me in the owner's place: their own words, with the answers they had chosen
  when asked the same questions (`request-parcel.txt`: what they picked in another builder's planning step;
  `request-diet-battle.txt`: what they picked in their own sz session that afternoon). One line is mine: their
  Kakao and Google keys were not to be used.
- Each variant was a copy of the plugin on a branch of its own. Several runs shared the Mac at a time, with
  the owner's own sessions: minutes are comparable between runs of the same round and rough between rounds.
- Times are minutes from the start of the session. "Built" is the builder's commit; "seen" is the first
  moment the product could be opened; "verified" is the close of the contract.

Baseline, the owner's own run of the parcel request that morning (the process as it was, everything at
`xhigh`): first slice built at 36 min; five milestones closed at 181 min; one page with two tabs; 28 claims
proven, none refuted; 7,504 lines.

## Round 1: the parcel request, four orders

| | A: whole product thin, then depth in a line | B: the same, depth side by side | C: a skeleton, then every area side by side | D: whole product in one stretch |
|---|---|---|---|---|
| Plan | 9.0 | 6.9 | 7.1 | 7.9 |
| Claims of the first milestone | 7 | 7 | 5 | 19 |
| Before any code (the builder writing its checks) | 30 min | 25 min | 9 min | 21 min |
| First milestone built | 62 | 56 | **35** | core path 49, whole **64** |
| Product lines then | 3,900 | 2,700 | 4,900 | 5,700 |
| Verifying it | 13.2 + 16.7 + 17.0 | 12.5 + 9.0 | 12 (and a stop) | 17.5 + 9.6 |
| First milestone verified | never (stopped at 132) | 81 | 80 | **100, 18 of 19 claims** |
| After that | not reached | plan 13 min; one milestone 31 min; a pair side by side 56 min; one more by 222 | plan 13 min; one milestone 51 min; three side by side 68 min, and 21 more to bring the last of them in | plan 16 min; two milestones of depth by 214 |

What it showed:

1. **Thin was not cheap.** A whole product built thin took 49 to 50 minutes; built to be used, 56. The thin
   ones had 7 claims and under 4,000 lines; the other 19 claims and 5,700.
2. **A verification costs 13 to 17 minutes whether it covers 7 claims or 19.** Cut small, that price is paid
   per slice: run A spent 47 minutes verifying one thin milestone.
3. **Independent verification finds real faults.** In B the verifier found that 34.7 + 29.6 + 15.7 cm, which
   is 80 exactly, was refused as over 80 (binary fractions); the builder's own checks passed.
4. **The checks written before the code were what delayed the first look**, 9 to 30 minutes of it.
5. **A claim that repeats a fact from the request stops a run when the fact is wrong.** The request said one
   carrier's limit is 100 cm; its own page says 80. Run C stopped at minute 54 with six milestones unbuilt,
   waiting for the owner; run A tried twice to mend a product that was right (46 minutes) and stopped.
6. **Side by side works.** First real runs: a pair (B) and three at once (C). Both met conflicts when joined
   (a table of routes, the map file), an agent settled them, and every standing claim was shown again on the
   joined product (a gate of 6 to 13 minutes). Against a line: a quarter to two fifths less time.
7. **Planning again after the first milestone took 13 to 16 minutes**: the planner walked the product anew.

My error in this round: the plugin copies for C and D had no dependencies installed, so their sessions could
not run the eyes from them and worked from a copy of their own for about the first 55 minutes. Their times
carry that.

## Round 2: D with two changes, on both requests

The changes: the builder of a first pass writes only tests of pure rules before the code, and the flows are
written by whoever verifies; a first pass of more than 8 claims is verified by three verifiers at once.

| | E1: parcel | E2: diet battle (a phone app, shown in a browser) |
|---|---|---|
| Plan | 8.8 | 11.4 |
| Claims | 17 | 18 |
| Before any code | 6.5 min | 3 min |
| Core path could be seen | 39.5 | **48.6** (guest, a battle against the AI, a weigh-in, the result) |
| Whole product built | **49.5** | **62.9** (invites, records with photo, steps and meals, ranking, tip cards) |
| First verdicts | 78: 12 proven, 4 refuted | 85: 16 proven, 1 refuted |
| Verifying (three at once) | 28 min | 21 min |

The owner's own run of the diet-battle request that afternoon, on a native build: four hours, the first
milestone (accounts) not closed, no screen seen.

What it showed:

1. **The four refutations in E1 were real**, and of a kind a builder's own flow would have passed: the store
   map never loaded (the data server answers in 36 to 39 seconds, the product gave up at 12: 18 failures of
   18); a row of choices ran off the screen with 6 of 9 out of sight; eleven figures had "the owner's word"
   as their source; flows that skipped steps reported a pass.
2. **It did not get faster.** Three verifiers who also write the flows took 28 minutes of wall clock where
   one verifier with ready flows took 17.5. The builder saved about as much. What was bought is strictness.
3. **A phone app shown in a browser** had its battle screen up at 49 minutes.

How round 2 ended: E2's first pass closed at 136 minutes with 17 of 18 claims proven (the last is the owner's
to judge), after two rounds of mending; its next milestone closed at 220. E1 stopped at 152 with its first pass
open on one claim: its builder had kept the request's 100 cm for one carrier and written "the owner's word" as
its source, the verifier refused that as a source, and nothing could mend it without overturning what the
owner had written. That made three stops in five runs of this request on the same wrong figure.

## The assembled process: two more runs

Branch `next` puts together: the first pass whole and in one stretch (D); flows written by whoever verifies and
three verifiers at once (E); a claim whose own words are wrong set aside for the owner instead of stopping the
run, and a plan that does not write the request's figures about the world into claims; side by side by default
after the first pass; the plan after the first pass reading what the verifiers left. Started 23:50.

| | V1: parcel | V2: diet battle |
|---|---|---|
| Plan | 9.8 | 7.8 |
| Claims | 18 | 20 |
| Core path could be seen | 52 | **37** |
| Whole product built | **65** (8,100 lines) | **47** (5,700 lines) |
| First verdicts | 86: 15 proven, 2 refuted | 76: 17 proven, 2 refuted |
| First pass closed | 161: 17 of 18 | 134: 19 of 20 |
| Plan after the first pass | | 9.9 (it had been 13 to 18) |

What it showed:

1. **The stop on the wrong figure did not come back.** V1's spec keeps the request's figures under "as the
   owner's request has them" and the product follows the sources.
2. **The ruling on claims the fixer cannot make true ran for the first time, and found the product wrong both
   times**: in V2 a photo of a weigh-in could be opened by anyone who had ever been in a battle with its
   owner (found by a verifier opening the address as a stranger), and a 12-letter name was cut off. Nothing
   was set aside; both were mended. The way out that the ruling offers was not taken where it did not belong.
3. **A new stop, mended the same night.** V1's workflow stopped at 132 with one claim false: every fault had
   been mended, and two pictures in the evidence folder still showed the product from before. The verifier
   was right to refuse. The session took the pictures again by itself and the pass closed at 161. Whoever
   fixes a claim shown by pictures is now told to take them again.
4. **From built to closed is the long part**: 87 and 96 minutes of verifying, mending and verifying again,
   each look 14 to 21 minutes, for faults that were real and small (labels cut off inside a drawing, an
   address open to the wrong person). The owner can look from the moment the product is built; closing it is
   what takes the time. This is the largest cost left in the process.

Across the five first passes built whole (D, E1, E2, V1, V2): the product stood at 47 to 65 minutes. Four
closed, at 100 to 161 minutes; one (E1) stopped open.

## How the night ended

At 04:14 the three sessions still running (V1, V2 and E2) all ended with the same line: "You've hit your weekly
limit · resets Nov 18 at 9am (Asia/Seoul)". The runs of that night had used up the week's allowance of the
owner's subscription. A one-word request to Opus and to Sonnet at 07:03 was answered, so what the limit still
holds back, and whether anything since has been charged beyond the plan, is for the owner to read on their
usage page: I did not start another run.

Where each stood then:

- V1 (parcel): the first pass closed at 161; then two milestones side by side under the assembled branch
  ("mend": what the verifiers had noticed, and "stores-wide"), staged at 173, closed at 202 and 238, joined
  without a conflict, and every standing claim shown again on the joined product (13.5 minutes). 28 claims
  proven in three contracts, one left for the owner. 10,500 lines.
- V2 (diet battle): the first pass closed at 134 and "mend" at 237 (7 of 7); the next milestone was being
  built. 26 claims proven in two contracts, one left for the owner.
- E2 (diet battle, the round before): four contracts closed by 337 (the first pass, a daily duel, talk between
  rivals, records), a fifth with 5 of 6 proven.

## Not measured

- The milestone that puts a phone app on the phone, under this process.
- A product of another kind (a game, a desktop app).
- What the owner's eye makes of products built whole at once. They are kept in the session scratchpad under
  `cut/`, each with its evidence pages.
