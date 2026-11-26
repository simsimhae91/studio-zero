---
name: verify
user-invocable: false
description: Use when a claim about software has to be shown true on the running product, not argued. How to launch, look at and operate a web page, an iOS app, an Electron desktop app, a web game and other targets with sz-eyes, and what counts as evidence.
---

# Verify: show it on the running product

A claim is unproven until something shows it. "The code looks right" shows nothing. A passing test shows what the test checks. Operating the product shows what a person will meet.

## When the session has a command sandbox

The owner may run their sessions with Claude Code's command sandbox on. Nothing that opens a browser, a desktop app, a simulator or Docker can start inside it, and no setting of the sandbox changes that (it was tried). `sz-eyes` says so when that is what stopped it (and exits 3). From then on, in this session and in every agent you start, run these outside the sandbox **from the first try** (`dangerouslyDisableSandbox: true` on the Bash call): every `sz-eyes web`, `sz-eyes electron`, `sz-eyes ios`, `sz-eyes docker` and `sz-eyes supabase` command, `sz-eyes login relay start`, `sz-eyes worth cite`, `sz-eyes image make` (codex keeps what it makes in `~/.codex`), `sz-eyes image use` with `--size`, and the project's own flows and tests that open a browser. Starting the product itself, unit tests and everything else stay inside; ending or listing a server that an earlier command started (`kill`, `ps`) does not: inside, the sandbox refuses it. Tell an agent you start that this session is sandboxed, so that it does not lose a try finding out.

If the call outside the sandbox is refused, nobody was there to approve it. Stop and tell the owner exactly that, and that looking at the product needs one of three things from them: sessions in auto mode (the unsandboxed call is then reviewed and let through without them), their approval when asked, or the sandbox turned off for this project (`/sandbox`). Do not go on to judge by reading the code instead.

A look the sandbox stopped is not a look. It is never a verdict on the product, and a claim is never left `unchecked` for it without the note saying that the sandbox was the reason and what the owner can do.

## What counts

- **State over pictures.** Decide by what can be read exactly: the words on the screen, the controls and their sizes, a flow's steps, a command's exit, a row that was saved. A vision model misses most subtle visual defects; do not call a layout right because a screenshot looks fine to you.
- **Pictures are for the owner.** Keep a picture of every state a claim is about, and a before/after pair when something changed. They go in the evidence folder and on the evidence page.
- **Try to break it.** The empty case, the long name, the second time, the wrong input, going back. One happy path proves one happy path.
- **The one thing, from a real input.** The claim of the one thing the product is for is shown from what a person would really give it to what the product really gives back. Shown on an example, a fixture or figures the product made up, it is `refuted`, whatever the screen says about itself, unless the owner's own words allowed that example (`sz:work`, section 4).
- **What cannot be checked is said.** No device, no account, needs a human ear or judgement (is it fun, does it feel right): the claim is `unchecked`, with the reason. Never `proven` by assumption.

## The eyes

Everything is kept under the contract's evidence folder: `.sz/evidence/<contract id>/`. Give `--out` an absolute path under it.

**Web** (a dev server or a deployed URL). A server you start yourself gets its port from the machine and is ended by its own id, because other work of the owner's is listening on this machine too:

```
PORT=$(sz-eyes port) <the map's launch command> & pid=$!
...look, operate...
kill $pid
```

If the product cannot be told its port, say so as a finding and use the port the map names only when nothing is listening there (`lsof -nP -iTCP:<port> -sTCP:LISTEN` prints nothing; in a session with a command sandbox run it outside the sandbox, because inside it sees only what that one command started and prints nothing for another project's server). Never end what holds it. Before the first look, make sure it is this product that answers (its own words on the page), not another server on the same number.

```
sz-eyes web look <url> [--size phone|tablet|desktop] [--dark] [--wait "<words>"] --out <folder> --name <state>
sz-eyes web do <url> --step "tap:<words>" --step "type:<field>=<text>" --step "wait:<words>" --step "see:<words>" --step "shot:<name>" --out <folder> --name <flow>
```

A candidate for release or a live address is looked at the same way, and two more looks say what a public service must get right:

```
sz-eyes web live <url> [--commit <sha>]             # is it up, is it the version released (it says its commit at /healthz), what a person arriving trips on
sz-eyes web leaks <url> [--path <path>]... --env <the file with the server's secrets>     # is anything that must stay on the server in what a browser is given
sz-eyes web strangers <url> --as "<step>"... --other "<step>"... [--open <path>]...         # can one person get at what another stored
```

`strangers` is for any product where people have things of their own. `--as` signs a first person in and uses the product as them: open their things, make one, change one, remove one, and leave something in place that only they typed. `--other` signs a second person in. Everything the first person's browser asked of a server is then asked again as nobody and as the second person, and each change is tried by them first. A screen cannot show this fault: a screen only asks for what is its own. That is every page drawn on the server, every answer of an API and every file downloaded; the result lists what was asked again, so that what it covered can be read. Paths that are meant to answer everyone are named with `--open`, each for a reason the spec gives. Never run it without `--reads-only` on an address people are using.

A look waits for the page to load and then, for four seconds at most, for it to stop asking for things. What arrives later than that is named: `--wait "<words>"` on a look, a `wait:<words>` step in a walk.

`look` gives the words on the page, what can be pressed with names and sizes, what the page logged, and what was measured (contrast, touch targets, text cut off, sideways scroll, a label broken over two lines). `do` carries out steps as a person would and pictures what each press led to; it stops at the first step that cannot be done and says why. Add `--house` only for a product built on the studio's own design system.

**iOS** (a simulator build; the map says where the app is and its bundle id):

```
sz-eyes ios spare [--name <n>] [--wait <minutes>]   # the eyes' own simulator; prints its id. Never use one of the owner's. --name: one of its own for work done beside other work
sz-eyes ios room                                    # how many simulators this Mac holds at once, and which are up
sz-eyes room                                        # gigabytes free on the disk the project is on (first line); run it before a build that writes many
sz-eyes ios install <udid> <path.app> --bundle-id <id> [--metro <port>]
sz-eyes ios flow <udid> <flow.yaml> --out <folder> --video      # Maestro; the project's own flow, or one you write for this claim. The film stays out of git (the folder ignores *.mp4); the strip of frames beside it, <name>-film.png, is what a claim's evidence names
                                                                # exit 4 with "not the product's": Maestro asked for the screen before the app it had just started was up, after the flow had pressed or typed. Put the product back where the flow starts and run it again (a flow that had only started, stopped and read is run again by itself)
sz-eyes ios look <udid> --out <folder> --name <state>           # what is on the screen, and what was measured; --json for a flow
sz-eyes ios rest <udid> --erase                     # when done: a booted simulator holds gigabytes
```

Check free disk space first (`df -h /System/Volumes/Data`): a simulator's first boot takes about 3 GB. If there is not room, say so and mark the claim `unchecked`.

A booted simulator takes about 4 GB of memory, and a Mac holds only so many (`sz-eyes ios room`: two on 24 GB). `ios spare` does not boot one more than that: it says which are up. Then do what needs no simulator and ask again, or wait with `--wait 9` (minutes, as long as one command may run), and never boot one another way: with one too many the Mac swaps and every simulator crawls, the ones already up included (four up on a Mac that holds two: a boot took four minutes, and a look took 91 minutes that one verifier alone had done in 37). One simulator a verifier; a flow that needs a clean one wipes it (`sz-eyes ios rest <id> --erase`, then `ios spare` again) and does not take a second. Rest yours when you are done.

**Drive a simulator through `sz-eyes ios look` and `sz-eyes ios flow`, never through `maestro` itself.** The first of them on a simulator starts Maestro's driver there and holds it up; every look after that takes about a second and every flow finds its driver waiting (a driver started for each command took eight seconds a look and eleven a flow, and most stops that were not the product's came at that start: ten looks and three flows on each of two simulators took 41 seconds held and 264 not, with four of them failing). A `maestro` command of your own brings its own driver and takes the held one away, and the next look pays to start again. The holder goes when the simulator is rested (`sz-eyes ios rest`), and by itself when the simulator is down or nothing has asked for twenty minutes.

`ios look` gives the screen's size in points, where the status bar ends, the words and ids in the screen's tree, the words read in a picture of it, each field with how a flow presses it, where the keyboard is and which of the app's parts it is in front of, and what was measured: the app's words under the status bar or in the band the home bar is drawn in. The measure is taken on the picture, since the tree also holds what is behind a fixed bar or scrolled out of sight and nothing in it tells that apart. A claim that every screen fits the phone is this look on each screen (open each by its link, `sz-eyes ios look <udid> --out <folder> --name <screen> --json`), failing on what it measured: do not write a reader of pictures or a measure of your own (one verifier did, for 85 minutes, and the claim stayed unchecked).

**A React Native app** (Expo or not). What follows was learned the long way on the first one built here:

- **Until the hardening pass it is looked at as its web build**, at phone size, where a look takes seconds. It has to be able to run there from the first pass: `react-native-web` installed (`npx expo install react-native-web`; the export says so when it is missing); fonts loaded when the app starts (`useFonts`: the `expo-font` config plugin puts them only into a native build, and a browser then shows a fallback face); anything only a phone has behind `Platform.OS`, with a plain fallback. Then `npx expo export --platform web` (19 seconds for the first export of a small app, 3 when warm), serve the folder it wrote on a port of your own (`npx serve -s dist -l $(sz-eyes port)`: `-s` sends every path to the app), and `sz-eyes web look|do <address> --size phone`. The flows are written with `sz-eyes web do`. What a browser does not show: the status bar and the insets at top and bottom (everything sits higher), the native header (its back button, its centred title), the keyboard, what the app keeps when it is closed and opened again, coming back from another app. Those are shown in the milestone that puts the app on the phone, and what follows here is for that milestone.

- **The first native install.** `pod install` fetches prebuilt archives of a few hundred megabytes (React Native's core, its dependencies, Hermes), and the mirror it asks first can crawl: measured 2026-11-16 from Korea, 2 to 100 KB/s on a line that does 12 MB/s. `RCT_REACT_NATIVE_MAVEN_MIRROR_ENABLED=false` asks Maven Central alone, which was faster in some minutes and stalled in others. Having the archives in the project's `ios/Pods/*-artifacts/` or in `~/Library/Caches/ReactNative` does not stop the download: the pod's source is still the remote address, and CocoaPods fetches it again unless its own cache has it. When the archives are on the machine (those two places, or another project on the same React Native version: read from it, change nothing in it), point the install at the files and nothing is fetched (50 seconds where this was found, React Native 0.88): `RCT_TESTONLY_RNCORE_TARBALL_PATH=<core debug .tar.gz> RCT_USE_LOCAL_RN_DEP=<dependencies debug .tar.gz> HERMES_ENGINE_TARBALL_PATH=<hermes debug .tar.gz> pod install`. The names are React Native's own (`node_modules/react-native/scripts/cocoapods/rncore.rb` and `rndependencies.rb`, `sdks/hermes-engine/hermes-utils.rb`): read them for another version. Write the command that worked into `.sz/map.md`. Installed this way, React Native's own step that swaps the debug archives for the release ones is skipped, and a build whose three parts are not of one kind dies the moment the app opens (SIGSEGV, no crash report). Before a Release build, from inside `ios/Pods` (the scripts use relative paths: run from anywhere else they write stray folders), run `node ../../node_modules/react-native/scripts/replace-rncore-version.js -c Release -r <React Native version> -p "$PWD"`, `node ../../node_modules/react-native/sdks/hermes-engine/utils/replace_hermes_version.js -c Release -r <Hermes version> -p "$PWD"` and `node ../../node_modules/react-native/third-party-podspecs/replace_dependencies_version.js -c Release -r <React Native version> -p "$PWD"`; the same with `-c Debug` to go back.
- **Outside the sandbox, with the tools' own caches.** `pod install` and `xcodebuild` run outside the sandbox. Do not move CocoaPods' home or its caches into `$TMPDIR` to get past a refused write: that cache is empty in every session, and everything is fetched again.
- **A download or a build that shows nothing new for a minute is stopped, not waited on.** Find out what it is waiting for (its log, the size of the file it is writing). If the build cannot be had, the work is not closed on claims nobody looked at: say what is being waited for and ask the owner.
- **The verifier looks at a Release build**, with the bundle inside it (`xcodebuild -configuration Release -sdk iphonesimulator -derivedDataPath build CODE_SIGNING_ALLOWED=NO`): it needs no packager, and it is what people get. A debug build asks a packager for its code. `--metro <port>` tells it which one, but a flow that clears the app's state (Maestro's `clearState`) clears that too, and the app then goes to port 8081, where another project's packager may be answering on this machine: the app shows another product. A debug build with a packager of its own is for the builder's loop: started from a clone or worktree on a port from `sz-eyes port`, never on the owner's, and without `CI=1` (which turns off watching files, so a fix never reaches the app).
- **A flow presses a field by its id** (`tapOn: { id: <testID> }`, then `inputText`). By its words Maestro presses whichever part carries them first, often the label beside the field, and what is typed goes nowhere, with no step failing (five fields of six, 2026-11-19). `sz-eyes ios look` lists each field with its id, or, where the app gave it none, the place to press (`tapOn: { point: "46%,44%" }`); a field with no id is the builder's to mend, and goes in what you noticed.
- **On the phone, look for what a browser cannot show.** Each screen with a field, with the keyboard up: the button a person presses next must still be reachable (a number pad covered one; the flow that typed and then pressed found it; `sz-eyes ios look` says where the keyboard is and what it is in front of). What the app keeps when it is closed and opened again. Coming back from another app after signing in.
- **Maestro's `back` does nothing on iOS.** A flow goes back by tapping the back button that is on the screen.
- **What iOS puts in front of a flow is not the product, and a flow has to know it.** Seen on iOS 26.4 (2026-11-18), where a builder and then eleven rulings each found these again, for two and a half hours:
  - *A simulator wiped just before* runs Safari for the first time, and Safari's tip ("북마크, 공유 메뉴 및 열린 탭 보기", id `TipView`) would sit in front of the "열기" prompt of a link that opens the app, so that the tap does nothing. `sz-eyes ios spare` turns that tip off every time it hands the simulator over, so after a wipe (`sz-eyes ios rest <id> --erase`) take the simulator with `sz-eyes ios spare` again, never with `xcrun simctl boot`. Should the tip show all the same (another iOS keeps it elsewhere), close it where it shows (its own button, id `xmark.circle.fill`), then wait for "열기".
  - *The sign-in window* (`ASWebAuthenticationSession`) first asks "…에서 로그인하기 위해 '<host>'을(를) 사용하려고 합니다": tap "계속" when it is visible. A provider's own page then loads in the window. KakaoTalk is not on a simulator, so only the account-and-password way works there, and that needs a person.
  - *Health's permission sheet* ("건강 접근"): Maestro finds its buttons by text and id about 62pt from where they are drawn, so `tapOn` by text reports done and presses nothing. Wait for the text, then tap by point: "모두 켜기" at `50%,52%`, "허용" at `50%,86%`, "허용 안 함" at `50%,92%`; after a refusal iOS asks once more ("확인", `50%,57%`). Health itself may show a "시작하기" on a Medical ID card (id `UIA.Health.SuggestedAction.*`): that is not a welcome screen, and tapping it leaves the page the flow needs.
  - *A row at the end of a long screen* is behind the tab bar: `scrollUntilVisible` before `assertVisible`.
  - *There is no camera.* A photograph "taken today" is put into the simulator's library with its date (`xcrun simctl addmedia`), and the claim about the camera itself waits for a device.
  - *iOS does not say whether Health access was refused*: a product cannot tell "0 steps" from "no access", and a claim must not ask it to.
- **Keys for tests stay out of the files Expo reads.** A file named `.env*.local` beside the app was taken into the bundle and broke it (Expo 58, seen once). Keep them elsewhere (`tests/local-stack.secret`, ignored by git).

**A desktop app built on Electron** (the map says its folder, what must be built first, and the variables below):

```
sz-eyes electron look <app folder> [--window "<words of its title or address>"] --env <ITS_DATA_VARIABLE>={data} --out <folder> --name <state>
sz-eyes electron do <app folder> --step "tap:<words>" --step "window:<words>" --step "see:<words>" ... --env <ITS_DATA_VARIABLE>={data} --out <folder> --name <flow>
```

The steps are those of `web do`, and `window:<words>` goes on in another window the app opened (a popover, its settings). The app is started on a folder of its own for what it stores (`{data}` stands for it), its windows are invisible on the owner's screen and take none of their clicks or keys, and it is ended by the process that was started, so the owner's own copy of the same app can stay open. An app that decides itself where it keeps its data (`app.setPath('userData', ...)`) is not started until it is pointed at `{data}` by its own variable: started bare it would open the owner's real data. Give it the map's other switches the same way (`--env`): the port it listens on, no update check, which window to open. What reaches outside the app (a browser extension it pairs with, a global shortcut, a login item) is not exercised unless the map says how it is kept off the owner's own.

**A web game, or a page that moves by itself:** hold its time and ask it (`sz:game`). `sz-eyes web do <url> --clock --step "press:Space" --step "run:3000" --step "expect:window.__game.state().score === 3" --step "hold:ArrowRight=500" --step "read:after=window.__game.state()"`: with `--clock` the page's time moves only on `run:` and `hold:`, so the same steps give the same state every time. `read:` and `expect:` work on any page (what is in storage, what a counter says). **What moves on a screen** (a face sliding in, a card turning, a number rolling) is shown the same way: `--step "go:/meet/<id>" --step "wait:상대를 찾았어요!" --step "read:t0=<the value>" --step "run:250" --step "read:t250=<the value>"`. With `--clock` a `wait:` passes the page's time a frame at a time and stops it the moment the words are on screen, so what starts with the screen is read where it started and `run:` moves it by exactly that much; a `wait:` after a press does the same for what the press started. Time does not pass by itself: where a flow needs the server's answer and then the screen, it says `wait:` for the screen, not `run:` with a guess.

**Anything else** (a desktop app, a CLI, a game in an engine): use what the map names: the project's test runner, a headless run that prints state, a screenshot command. Prefer a check that exposes state (a game that can print its state and step its clock) to one that needs a picture judged.

## A claim about every screen

"Nothing is cut off on any screen" is a claim at the product's limits, and it is shown once, whole, not by trying one longer input each time someone looks:

- Fill every field a person can type into, and every figure that grows, with the longest value the spec allows (where the spec is silent, the longest the product accepts): the longest name, the longest sentence, the largest figure, two long things side by side.
- Open every screen in every state at phone size and measure each: `sz-eyes web look <address> --size phone`, or the look a `sz-eyes web do` ends on when a state has to be reached by pressing. "nothing above minor" is the line that says a screen holds.
- Keep exactly that as the claim's flow: it prints every finding with its screen and fails when there is one. Report all of them in the one verdict.

Whoever mends them runs the same flow over the whole product until it reports nothing. At a second look the claim is judged by that flow at those limits: an input the product does not accept shows nothing about it; what else you see goes under what you noticed.

## What is outside the contract

A claim is shown false on the product: running with its own parts, on the machines the spec says it is for. This machine is one of them only if the spec says so: a state a slower phone or a smaller server of those comes to is one the product comes to. A case is the claim's when the product comes to it, by what a person puts in or does or by what happens around it (the clock reaching a day, load, a network that drops, a forced quit, the power going), and a seam or a stand-in is a fair way to bring such a state about sooner (a clock set to that day, a server made slow). Whatever can be sent to the product from outside is what a person puts in, though its own screens never send it: a request made straight to its server, an address typed by hand, a file handed to it.

A case you could make only by giving a part of the product a behaviour it does not have there (a detector made 150 times slower than it runs), or by handing its inner code what its own parts never hand it, shows what the code would do. Try to bring the running product to it. Where you cannot, and no claim of this contract and no promise in `sz-eyes standing` names that state, it is not the product's answer to a claim:

```
sz-eyes contract notice <contract id> "<the case; how you made it; what the code did; what you tried on the running product and the figure that shows it does not get there>"
```

Name in it the claim it is nearest. It stays in the contract's list and goes to `.sz/backlog.md` when the work closes: the owner decides whether it becomes a claim.

What this is not: a way to pass. A case the product comes to, however hard it is to reach and however many tries it takes, is that claim's, and it is `refuted` with your figure. When in doubt it is the claim's.

## What stood before

A product that has been worked on before keeps promises, and a change is not done until they are shown again:

```
sz-eyes standing                      # every claim earlier work proved, how each is shown, when it last held, which check files changed since
sz-eyes standing record <contract>/<claim> --status holds|broken|unchecked --during <the contract being verified> --note "<what was run and what it showed>"
```

Run every standing claim that a flow, test or command shows (the project's whole check command in one go where it has one), and look again at the ones shown by a look where this work touched that screen. Where it says a check file changed since the claim last held, read the change (`git diff`, `git log -p -- <file>`) and decide whether the file still checks what the claim says: a check that was loosened so that it passes is `broken`, whatever it prints. A standing claim shown by `owner` is the owner's own verdict on how something looks or feels, in their words: you do not judge it again for them. If this work did not change what they saw, it `holds` (say what you compared). If it did, take the same pictures as it is now and record it `unchecked`, naming the pictures and what changed: it goes back to the owner, who looks again. Record every one you looked at. A standing claim that the work's own contract replaces is no longer listed.

## What the change did not reach

A look after a fix does not run everything again. Every verdict keeps the commit the product was at when it was looked at: `sz-eyes contract show <id>` gives it on the line `판정한 커밋`. Compare HEAD with it in the project's folder (`git diff --name-only <that commit>..HEAD`; a copy is not a repository). Where the diff names none of the files the claim is about (its own check, its screen, its rule, its figure) and none of the shared ones, the claim is not run again: its verdict stands, and in a workflow it goes under "carried" with the two commits and what the diff named.

A change to one of these reaches every claim, so the claim is run: the app's entry or router, a module more than one screen uses (anything the map calls shared), a package manifest or a lock file, the build and type-check configuration, a schema or migration, the design's tokens or theme, a setting read everywhere (the environment, the words, the error handler), and the line of `.sz/map.md` that says how it is launched.

Never carried: a claim with no commit on its verdict, a claim shown false before (`sz-eyes contract show` says how often), one whose own check is in the diff, and one shown by the command that runs all of the project's checks, where that command changed. Where you cannot tell whether the diff stands near a claim's words, run it.

A verdict is about the commit you looked at. Given on a copy made before the project moved on, it says so: `sz-eyes contract claim <id> <claim> ... --at <the copy's commit>` (the first line `sz-eyes copy` printed names it). Recorded as the project's HEAD, it would hide the commits in between from the next comparison.

## Recording a verdict

```
sz-eyes contract claim <contract id> <claim id> --status proven|refuted|unchecked --evidence <file relative to the evidence folder> --note "<what was done and what it showed, in one or two lines>"
```

`proven` needs evidence or a note that says what was run and what it said. `refuted` says what happened instead, with the picture. Do not edit the contract file by hand, and do not edit product source: a verifier that fixes what it finds has stopped verifying.
