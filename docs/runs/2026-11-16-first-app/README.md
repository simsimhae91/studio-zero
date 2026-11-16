# The owner's first phone app with sz: what the session showed, and the rule each fault became

2026-11-16. The owner started a diet-battle app (Expo 58, React Native 0.88.1, a local Supabase stack) in
`/Volumes/DEV-SSD/Projects/battle-diet` and wrote, some hours in: "여기서 진행중인 세션 보면 규칙으로 정해야할게
좀 보입니다." This is what the session's log, the workflow's journal and its four agents' logs show. Nothing in
that folder was run or changed to write it.

## What happened (KST)

| When | What |
|---|---|
| 15:17 | "다이어트 배틀앱을 만들어보려고 합니다." Eight tappable questions in two rounds; every one answered, about 80 seconds a round. |
| 15:22 | Spec written. The session began the first milestone itself. It did not show the plan, say how long, or say that `/sz:build` exists. |
| 15:31 | Every screen of M1 written, type check passing. First native build tried only now: `pod install` in the foreground. |
| 15:36 | The owner stopped it after 283 seconds. Nothing had said what it was or how long it would take. |
| 15:39 | `/sz:build 이어서진행합시다.` The plan called M1 "built": its code was not committed and had never run. |
| 15:43 to 16:28 | The verifier spent 45 minutes getting a build: four waits of ten minutes on a download at 2 KB/s. |
| 15:48 to 15:50 | The owner added a step bonus, an AI opponent and tip cards. The spec changed under a run planned from the old one; the session set up a watcher of its own to stop the run at M2. |
| 16:28 | M1 closed with 1 claim proven and 7 not looked at. Its progress line told the owner to build the app somewhere with a network and run the flows. M2 started. The session stopped the run. |
| 16:39 | Archives copied from another project (my advice). `pod install` hung another 11 minutes: CocoaPods fetched them again. |
| 16:52 | The session found React Native's switches for local archives: 50 seconds, nothing fetched. |
| 17:03 to 17:20 | The app would not open: a stale packager cache, a test key file pulled into the bundle, `CI=1` turning off file watching, a route that looped, the wrong first screen. |
| 17:23 | A Release build started, because a debug build was reaching another project's packager on port 8081. 2 h 06 min after the request: one claim of eight proven, nothing of the app seen. |

Between 15:40 and 17:23 six answers ended with the same block ("M1은 아직 완료가 아니에요…").

## What it became

| Fault | Rule | Where it is kept |
|---|---|---|
| A milestone closed with 1 claim of 8 looked at, and the next was started on it | A contract does not close when more than half of what could be looked at was not; only the owner can say to close it as it is | `sz-eyes contract close` refuses (`--accepted "<their words>"`); the workflow stops when it does |
| A milestone that had never run was handed to its verifier | A builder starts what it built and sees it run before returning; a milestone built by an earlier run is started, and mended if it will not start, before anyone looks | `plugin/workflows/build.js` (builder step 5, the `start:` agent), `sz:work` |
| The verifier waited 36 minutes | A product that will not start is a finding, not a wait: ten minutes at the latest, then unchecked with the one cause | `plugin/agents/verifier.md` |
| Two hours with nothing to look at | An app on a phone starts as an empty app that runs; the first build goes in the background while the first screens are written | the plan in `build.js`, `sz:work` |
| A native install ran in front of the owner with no word | A command of more than a minute or two runs in the background with one line: what it is, about how long | `sz:work` |
| The same status after every answer | What is owed is said once in a session and again only when it changes | `plugin/hooks/stop-owed.mjs`, `sz:work` |
| The spec changed under a running workflow | Amend, say the run was planned from the old one, let the milestone finish, stop, start again from the amended spec | `sz:work` |
| Archives on the machine were fetched again; a cache moved into `$TMPDIR` is empty every session | Point the install at the local files with React Native's own switches; native installs and builds run outside the sandbox with the tools' own caches | `sz:verify` |
| A debug build showed another project's code | The verifier looks at a Release build with the bundle inside; a debug build with its own packager is for the builder | `sz:verify` |
| `CI=1` on the packager, a test key file in the bundle | Both said | `sz:verify` |

Kept from this session as it was: the questions as choices. They are what the owner answered, eight of eight,
and the limit in `sz:work` was changed from three to four at a time with a second round only for a fork the
first answers opened.

## What I got wrong

I told the owner that with the archives in `~/Library/Caches/ReactNative` the install "skips the download". I
had read the part of React Native's script that fills `ios/Pods/*-artifacts/` and not the line that hands
CocoaPods the remote address as the pod's source. Their session lost 11 minutes on it and found the way
through by itself. I had also answered "no change needed" to whether the harness should say anything about
this; it now does.

## Not settled

- Package installs inside the command sandbox fail on the tools' caches in the home folder (npm reported
  "root-owned files"; the session moved the caches into `$TMPDIR`, where they are empty every session). Letting
  those cache folders be written from inside the sandbox is a setting of the owner's, not a rule of the
  plugin. Not changed.
- Whether the first milestone of a phone app, cut as an empty app that runs, brings the first look inside half
  an hour has not been measured.
- A plain rule in a skill was skipped three times in two days (the questions, the line about `/sz:build`, the
  plan before building). The two that mattered most are now held by a tool (`asked`, `contract close`); the
  third is still words.
