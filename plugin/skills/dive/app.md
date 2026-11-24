# Dive: an app

The idea is about an app: one that exists ("기존 앱에 이런 기능을 더하면") or one that does not yet. The owner is its first user, and that is the strongest thing a dive about an app has: their own days are the ground. Keep coming back to them.

## Whose app

The first fork is whose app the idea starts from, and it is settled in the first round if the seed does not say it:

- **Someone else's app** (they name it, or it is plain who makes it). The question under `home` is whether this is a feature inside that app or an app of its own, and why that app has not built it: they serve someone else, it would cost them what they earn from, it became possible only lately, or nobody asked.
- **The owner's own app** (they have shipped apps, and an Electron app). Read its folder: `.sz/map.md` and `.sz/spec.md` when there are, the README, `git log --oneline -20`. The first fork under `home` is whether this lives inside that app or stands on its own.

## The world, read in the background

For someone else's app, start one agent in the background as the first round goes out (the Agent tool, `subagent_type: "general-purpose"`, `model: "sonnet"`, `run_in_background: true`), and tell it:

> Read, for the app "<name>", where anyone can read it without an account: its store page (App Store `https://apps.apple.com/kr/app/id<id>`, which `https://itunes.apple.com/search?term=<name>&country=kr&entity=software` finds; Google Play `https://play.google.com/store/apps/details?id=<id>&hl=ko&gl=KR`): what it says it does, its price, its rating and count. Then its low-rated reviews, the newest first (`https://itunes.apple.com/kr/rss/customerreviews/page=1/id=<id>/sortby=mostrecent/json`): read fifty, and count how many speak of <the owner's trouble, in a phrase>. Then two or three other apps people use for the same job. File each thing as it stands on its page, in its own words, with `sz-eyes dive saw <dive id> --url "<page>" --quote "<the words exactly as they stand>" --shows "<what they show, in a line>" --line now|home|pain` (run it outside the command sandbox: `dangerouslyDisableSandbox: true`). A quotation it reports NOT SEEN counts for nothing: copy the words again or let them go. File what speaks against the idea as readily as what speaks for it: a free app that already does this well is the most useful thing you can find. No figure of your own. Your searches carry only words about the subject, never the owner's name or anything from their files. Report back in ten lines: what you filed, the strongest thing for and against, and anything that points at a narrower moment.

`../worth/sources.md` lists what could be read without an account and how; read it if a source refuses. Bring what comes back into the next round as facts with their links ("낮은 별점 50개 중 9개가 같은 말을 합니다: '…' (링크)"), to sharpen `now` and `home`: ask the owner whether that is their trouble too, never tell them it is.

## The lines of an app, and how each is asked

- `pain` is the owner's own memory, asked as one: "마지막으로 그게 불편했던 게 언제예요? 그때 뭘 하고 계셨어요? 그래서 어떻게 하셨어요?" Ask what they did about it then (a workaround, money, giving up) and whether they looked for something else: what a person did is worth more than anything they say they would do. A first answer that is general ("그냥 자주요") gets one more question for the last time, not a proposal.
- `moment` and `now` come out of `pain`: where they were, what they used, where it fell short. Propose them from what they said and let them settle them.
- `home`: a choice, with what each way costs them ("카카오톡 안에 붙이면 사람들이 이미 거기 있지만, 카카오가 열어 둔 만큼만 할 수 있습니다").
- `core`, `first`, `back`, `not`, `feel`, `done`: choices with a recommendation, after `pain` and `home` are settled, each option concrete enough to picture (a screen, a moment of the day).

In the brief, `## 첫 1분과 핵심 여정` follows `home` → `first` → `back` in the order of the screens the person uses.
