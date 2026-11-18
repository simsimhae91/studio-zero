---
name: game
user-invocable: false
description: Use when building or changing a game (a web game first), or anything whose screen moves by itself and means something by it (a timer, a simulation, an animation that carries a result). How to build it so that it can be asked what it is doing and answers the same every time, how a rule of the game is proven, and what stays the owner's to judge.
---

# Game: make it say what it is doing, and hold its clock

A picture cannot prove a game. A screenshot of a moving thing is one frame of thousands, and a model looking at it cannot tell a rule that works from one that looks as if it does. What can be proven is state: the score after three seconds, where the piece is after the key was held half a second, that the game is over when the last life is gone. So a game made here is built to be asked, and its time is held while it is asked.

## Build it so that it can be asked

- **It says its state.** `window.__game.state()` returns plain data about the rules, not the drawing: the phase (title, playing, paused, over), score, lives, level, time left, where the player is, what is on the board. It is in every build; it costs nothing and it is what every check reads.
- **One clock.** The loop takes time from the frame's own timestamp (`requestAnimationFrame`, `performance.now()`), and moves things by time passed (pixels a second), never by frames counted. Nothing keeps time behind the loop's back (no `setInterval` beside it that the loop does not own). Then the game's time can be held and moved from outside, and a slow phone plays the same game as a fast one. Clamp a long gap between two frames (a tab that was hidden) so that nothing jumps through a wall.
- **Chance has a seed.** The game owns its random numbers (a small generator, not `Math.random`), `window.__game.seed(n)` starts them from a number, and a player's game seeds itself from the time. A check sets the seed and gets the same board.
- **Words are in the page, not in the canvas.** Score, lives, messages and buttons are elements over the canvas: the eyes read them, a screen reader reads them, and a person can make them bigger. What is drawn on a canvas is read by nobody but the player.

## Prove a rule

With `--clock` the page's own time stands still and moves only when told to, so the same steps give the same state every time (measured: a held key for 500 ms moves a 100 px/s piece exactly 50 px, on every run):

```
sz-eyes web do <address> --clock \
  --step "read:start=window.__game.state()" \
  --step "press:Space" --step "run:3000" \
  --step "expect:window.__game.state().score === 3" \
  --step "hold:ArrowRight=500" \
  --step "read:after=window.__game.state()" --step "shot:after" --json
```

`run:<ms>` lets that much of the game's time pass; `hold:<key>=<ms>` holds a key that long; `wait:<words>` passes time a frame at a time until the words are on screen and stops it there; `read:<name>=<expression>` keeps what the page says; `expect:<expression>` stops the walk when it is not so and says what it is instead. Without `--clock`, `run:` waits real time: use that only for what is about real time (below).

A claim of a game is a rule a player would state, with its figures: "세 번 맞으면 끝난다", "벽에 닿으면 멈춘다", "판을 깨면 다음 판은 0.2초 빨라진다", "새로 고쳐도 최고 점수가 남는다". Each is a flow of the project's own that sets the seed, holds the clock, does the steps and reads the state. Also the edges: both keys at once, a key held across a pause, the last life and the level's end in the same frame, starting again ten times.

## What a phone needs

- It is played by touch: every control a key has is also on screen, at least 48 px, where a thumb is. `sz-eyes web look --size phone` measures the controls and says if the page scrolls; a game does not scroll.
- It stops when the tab is hidden and goes on, without a jump, when it is shown again.
- Sound starts only after the first touch (a browser allows nothing else), and the mute a person chose is remembered.
- It keeps its frames: with real time (no `--clock`), `run:5000` and a `read:` of the frames it drew says how many of the 300 it kept. Say the figure; a game that drops a third of them on this machine will be worse on a phone.

## What stays the owner's

Whether it is fun, whether the jump feels right, whether the sound is pleasant: no state says that. Each is a claim shown by `owner`, with what helps them judge: the pictures of a walk, and the address to play it. Do not call a game good because its rules are proven.

## Scores other people see

A list of best scores that others see is stored data with accounts or names behind it (`sz:backend`), and a score sent by a browser is a claim, not a fact: the server takes what was played (the seed and the inputs, or at least the time played) and decides the score, or the list is the cheaters' within a day.
