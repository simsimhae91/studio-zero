## split-tail: notTheClaim (fifth case)

**Ruling.** The case was not the claim's. I recorded the case as a notice and recorded the claim from its own check: `sz-eyes contract notice day-true "split-tail 곁: …"`, then `sz-eyes contract claim day-true split-tail --status proven --note "판정(2026-11-26): …"`.

**Changed.** No check, product code or claim wording was touched. Only `/Volumes/DEV-SSD/sz-scratch/worktape-rule-20261126/.sz/contracts/day-true.json` changed, written by those two sz-eyes commands. I have not committed it, because I commit only checks I corrected and there were none.

**What the check says now.** `npm test` passes 63/63 in front of me. That includes all 5 tests in `test/split-tail.test.mjs` (4:31 of speech, a 0.1s pause and 0.5s of speech: the continued chunk is kept and 0 speech frames are dropped; the 2s pre-roll, the 10s silence close, the 600ms speech in a new chunk being dropped, and the 5-minute cap all hold) and `test/chunker.test.mjs`, which runs the speech fixture through the real Silero.

**Why this is not the claim's case**
- **How the case was made.** The 0.5s speech kept as a 512ms chunk, and the 0.3s speech kept as 288ms, both came from `.sz/evidence/day-true/split-tail/look3/engine-700.mjs`. That script builds the product's Engine in node, puts in a fake VAD slowed to 60ms per frame, feeds 5.5s of sound to `frames()` all at once, then calls `setPower(false)`. The finder said they could not bring the app to this state. The product only attaches frames unjudged (`pushRaw`) when the stop's drain runs past `DRAIN_MS` = 600ms (`src/main/engine.mjs`). Unjudged frames are then counted as speech by `_close` in `src/core/chunker.mjs`.
- **Which machine counts.** The spec names one machine: the owner's own Mac ("자기 맥에서만 쓰는"), which is this one.
- **Silero speed on this Mac** (the product's `Vad` class, real 512-sample frames of `speech.wav`):

  | Condition | Mean per frame | p99 | Max |
  |---|---|---|---|
  | Idle | 0.087ms | – | – |
  | 30 busy-loop processes on 10 cores | 0.734ms | 6.4ms | 188ms |

  Under the 30-process load it judged 96s of sound in 2.2s. The capture window only delivers 8 frames every 256ms, in real time.
- **The running app under heavy load.** I ran it with 30 busy-loop processes (load average up to 78), whisper transcribing at the same time, the `seed-limits` data, and both the main window and the popover open. I stopped it after the speech fixture's short "네" (21.37–21.60s) in five ways: on-battery three times (at fixture 24.5, 26.8 and 28.8s), suspend, and Cmd+Q.
  - Every time, the time from the event to `record stop` was 5–10ms, more than 60 times under 600ms.
  - Every time the log said `chunk dropped … speech=288ms < 700ms`.
  - Earlier power-load evidence agrees: 0–24ms under 10 busy processes.
- **Other ways a stop can happen.**
  - **kill -9 or the power going out:** on recovery, `measureSpeech` judges every frame with Silero, so no frame goes unjudged. The existing recovery tests pass.
  - **Sleep:** this Mac's `pmset -g log` shows that after apps are told, sleep waits on other clients and drivers (bluetooth 1542ms and mDNSResponder 2880ms on 2026-11-26 08:09; Port-USB-C driver 56ms). As a stand-in for the Mac sleeping, I froze the app with SIGSTOP 2ms after the `system suspend` line, held it 3s, then let it go. The "네" chunk was still dropped at 288ms.
- **Nothing else names this state.** No claim of day-true and no promise in `sz-eyes standing` names a VAD that is more than 600ms behind at a stop.

**One limit of the freeze test.** In that run the freeze did land before the stop finished. A 288ms word would only be kept if 13 or more frames went unjudged, so that run cannot show whether one batch (8 frames, 256ms) or fewer went unjudged. I judge a real sleep landing inside a 5–10ms drain, while a batch is still being judged, to be out of reach given the sleep delays above. The owner can decide from the notice whether it should become a claim.

**Scratch scripts.** The flows I ran are in `/tmp/claude-501/st-rule/` (`short-pull.sh`, `other-stops.sh`, `freeze-watch.mjs`, `vadbench.mjs`). I deleted their data folders, and no app or load processes are left running.
