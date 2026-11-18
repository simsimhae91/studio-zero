#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { ArmError, armCommand, heldLines } from './arms.ts';
import { BACKLOG_FILE, addToBacklog, doneInBacklog, leftBy, openBacklog } from './backlog.ts';
import { CONTRACTS_DIR, EVIDENCE_DIR, ClaimStatus, Contract, Lane, ShownBy, localDay, notLookedAt, openContracts, owed, readContract, renderContract, updateContract, writeContract, type Claim } from './contract.ts';
import { ElectronError, renderAppLook, renderAppWalk, walkElectron } from './electron.ts';
import { CiteError, seeQuote } from './cite.ts';
import { Basis, LineId, LineStatus, Objection, Other, addAsk as addWorthAsk, addCite, addObjection, allCases, answerObjection, caseFolder, hearAsk, newCase, readCase, renderCase, renderCases, setCall, setLine, setOther, setOwner, setRow, standingOf, unanswered, weighCite, writeCasePage, writeCasesPage } from './worth.ts';
import { engineEnv, findTool, hostedSupabaseCall } from './engine.ts';
import { writeEvidencePage } from './evidence.ts';
import { changedSinceFrozen, fingerprint, fingerprints } from './fingerprint.ts';
import { Status, addSaid, latestRound, newRound, noteSaid, readRound, renderRound, writeRoundPage } from './feedback.ts';
import { IMAGE_ASSETS_DIR, ImageError, imageCommand } from './image.ts';
import { EyesError, installApp, restSimulator, runFlow, screenText, screenshot, spareSimulator } from './ios.ts';
import { downloadsOf, filesOf, leakReport, renderLeaks } from './leaks.ts';
import { lookAtLive, renderLive } from './live.ts';
import { RelayError, loginCommand } from './login-relay.ts';
import { DANGEROUS, changesInCode, classify, renderMigrations } from './migrations.ts';
import { findProducts, overviewPage, renderOverview, viewOf } from './overview.ts';
import { freePort } from './port.ts';
import { copyText, endCopy, makeCopy } from './copy.ts';
import { RefsError, refsCommand } from './refs.ts';
import { heldSecrets, ownersVault, parseRun, runWithSecrets, setSecret } from './secrets.ts';
import { GATE_LINES, lastRelease, releaseContract, releases, renderReleases, type Gate } from './release.ts';
import { reviewWeb } from './review.ts';
import { renderStrangers, strangers } from './strangers.ts';
import { supabaseCommand } from './supabase.ts';
import { Shown, brokenDuring, keptFor, ledgerProblem, recordShown, renderStanding, stampClosed, standing, standingSummary, mendLedger, STANDING_FILE } from './standing.ts';
import { Felt, TrialFinding, TrialKind, Verdict, addAsk, addFinding, addNote, addPersona, latestTrial, newTrial, readTrial, renderTrial, setVerdict, unfinished, writeTrialPage, setCanary } from './trial.ts';
import { planScreens, renderSweep, screensFromArgs, sweepWeb, type Screen } from './sweep.ts';
import { SIZES, lookAtWeb, renderLook, renderWalk, walkWeb, type Size, SandboxError, closeBrowser, openBrowser } from './web.ts';

const USAGE = `sz-eyes: launch what was built, look at it, operate it, and put what was seen on one page

  sz-eyes web look <url> [--size phone|tablet|desktop] [--dark] [--wait <text or selector>] [--out <folder>] [--name <n>] [--house] [--json]
        open a page in a headless Chrome of its own and say what is on it: the words, what can be pressed, what it
        logged, and what was measured (text that can be read, controls that can be pressed, nothing cut off)

  sz-eyes web sweep <address> (--hash <id>... | --path <path>... | --from <file>) [--size phone|tablet|desktop] [--dark] [--wait <ms>] [--out <folder>] [--house] [--json]
        measure many screens in one browser, each as web look measures it, and say all that was found at once: for
        each screen in the order given, "nothing above minor" or its findings above minor, and its picture kept as
        <out>/<name>-<size>.png (a new folder under the system's temporary folder unless --out is given); then how
        many hold and which do not. --hash <id> is <address>#<id>, changed on the page that is open, not reloaded;
        --path <path> is that path on the address's origin; --from reads one screen a line (#<id>, /<path> or a
        full address). --wait <ms> waits that much more on each screen. A screen that cannot be opened does not
        hold, and the sweep goes on. Exits 1 when a screen does not hold. For every screen of a prototype or a
        product in one go, each at its limits, before saying that no screen is cut off

  sz-eyes web do <url> --step "<step>"... [--size ...] [--out <folder>] [--name <n>] [--clock] [--json]
        do things on a page as a person would and keep a picture of what each led to. Steps: tap:<words>,
        type:<field>=<text>, press:<key>, wait:<words>, gone:<words>, see:<words>, shot:<name>, go:<path>,
        read:<name>=<expression> (keep what the page says), expect:<expression> (it must be true in the page),
        hold:<key>=<ms>, run:<ms>. Stops at the first step that cannot be done and says why; ends with a look
        at where it arrived. --clock holds the page's own time still, so that a game, or anything that
        moves by itself, does the same thing every time it is asked. Time then passes only with run: and
        hold: (by exactly that much) and while a wait: or gone: waits (a frame at a time, stopping the moment
        the wait ends: what starts with a screen is read where it started, and run: moves it from there).
        Every page, the first and one reached by go: or a press, is started the same way and then held.

  sz-eyes web review <url> [--size phone|tablet|desktop] [--dark] [--round <folder>] [--dir <project>]
        open the running product in a window for the owner: they use it as usual, press 말하기, point at what
        they mean and say it. Ends when they press 끝내기 or close the window, and prints what they said, with
        what each was about and a picture of that moment. Run it in the background and wait for it to end

  sz-eyes web leaks <url> [--path <path>]... [--env <file>]... [--json]      (or: sz-eyes web leaks --dir <built folder> [--env <file>]...)
        read everything a browser is given at those addresses (pages, scripts, styles, API answers, source maps),
        or every file of a built folder, and look for what must stay on the server: the exact values of the
        secrets in the given dotenv files, and the shapes of keys that open something. A value found is never
        printed. Exits 1 when anything leaks

  sz-eyes web strangers <url> --as "<step>"... [--other "<step>"...] [--mark "<words only the first person's data holds>"]...
        [--open <path>]... [--as-header "name: value"]... [--other-header "name: value"]... [--reads-only] [--json]
        can one person get at what another stored? Uses the product as a first person (--as: sign in, then open,
        make and change something of their own), keeps everything their browser asked of a server, and asks for
        the same again as nobody (no session) and as a second person (--other: the steps that sign them in).
        What the first person typed and the second did not marks their data. --open names paths meant to answer
        everyone. On an address people are using, --reads-only. Exits 1 on a finding, or when nothing could be asked

  sz-eyes web live <url> [--commit <sha>] [--at /healthz] [--json]
        ask a service where people reach it: is it up, is it the version that was released (it says its commit
        at --at), is it served as a public service has to be, and what would a person arriving trip on.
        Exits 1 when it is not the service as released

  sz-eyes electron look <app folder> [--window <words of its title or address>] [--out <folder>] [--name <n>] [--arg <arg>]... [--env K=V]... [--data <folder>] [--onscreen] [--json]
  sz-eyes electron do <app folder> --step "<step>"... [the same options]
        start a desktop app built on Electron from its folder (it must be built), look at a window of it and
        operate it with the steps of web do, then close it. window:<words> goes on in another window the app
        opened. The app gets a folder of its own for what it stores, so the owner's real profile is never
        opened and their own copy can stay open; its windows are invisible on their screen and take no click
        or key of theirs (--onscreen shows them, for an app whose layout follows the screen). --data <folder>
        keeps what it stores in a folder of yours instead of one thrown away: run twice on the same folder to
        see what is there after the app is closed and opened again, or put a file there first to start from it.
        --days-later <n> starts it believing it is n days from now (its main process and every window): with
        the same --data, that is a person coming back the next morning or a week on

  sz-eyes ios spare [--type "iPhone 17"] [--name <n>]    the eyes' own simulator, made and booted with no window; prints its id.
        --name gives one of its own to work that is done beside other work (two products on one simulator overwrite each other)
  sz-eyes ios install <udid> <path.app> --bundle-id <id> [--metro <port>]
        put a built app on it, fresh (a React Native debug build is told which packager to load from)
  sz-eyes ios flow <udid> <flow.yaml> --out <folder> [--video] [-e KEY=VALUE]...
        run a Maestro flow from a copy that cannot write outside <folder>; says each step, keeps screenshots and a film
  sz-eyes ios look <udid> [--out <folder>] [--name <n>]  a screenshot, and the words and ids on the screen
  sz-eyes ios rest <udid> [--erase]                      shut it down (and wipe it); take it again with ios spare, which
        hands it over with Safari's first-run tip off (on a wiped simulator the tip covers the "열기" of a link that opens the app)

  sz-eyes contract new <id> --lane S|M|L --request <text> [--target web]... --claim "<id>|<what will be true>|<kind>:<ref>"... [--not "<text>"]... [--risk "<text>"]... [--supersedes "<contract>/<claim>|<why>"]... [--dir <project>]
        --supersedes names a standing claim of earlier work that this work deliberately replaces, and why
  sz-eyes contract freeze <id> [--frozen <path>]... [--dir <project>]
  sz-eyes contract built <id> --launch "<the command that starts it, and where it is seen>" [--dir <project>]
        said by whoever built it, once the product has run in front of them: from then until the close the owner
        can be shown it while it is verified. With no id: the contracts that are built and not closed, each
        with its launch line (exits 1 when there is none): what a session waits on
  sz-eyes contract claim <id> <claim-id> --status proven|refuted|unchecked [--evidence <file under the evidence folder>]... [--note <text>] [--dir <project>]
  sz-eyes contract judged <id> <claim-id> --verdict yes|no --said "<the owner's words>" [--dir <project>]
        the owner's own verdict on a claim that was left for them to judge (shown by owner), in their words; the
        contract may be closed. Yes: from here it stands, and later work that changes what they saw has to show
        it to them again. No: it is refuted and written down as left to do.
  sz-eyes contract amend <id> --file <a frozen file> --why "<text>" [--dir <project>]
        record that a frozen check was corrected after the freeze (the arbiter's, never the builder's)
  sz-eyes contract supersede <id> <contract>/<claim> --why "<text>" [--dir <project>]
        after the fact: an earlier claim turned out to be replaced by what this contract was asked (the arbiter's)
  sz-eyes contract notice <id> "<what was noticed that no claim covers>" [--evidence <file>]... [--dir <project>]
  sz-eyes contract frozen <id> [--dir <project>]         the files it froze and whether each is still as it was frozen; exits 1 when one changed
  sz-eyes contract show <id> [--dir <project>]           the contract as the owner reads it
  sz-eyes contract status [--dir <project>]              what open contracts still owe; exits 1 when anything is owed
  sz-eyes contract dispute <id> <claim-id> --ruling "<what the claim says, what is so, where that is read>" [--evidence <file>]...   a claim found false whose own words are wrong: set aside for the owner, words unchanged
  sz-eyes contract add-check <id> --frozen <file>...     a check written after the freeze by whoever verified the claim: held from now on like the rest
  sz-eyes contract close <id> [--accepted "<the owner's words>"] [--dir <project>]   # refuses when most claims were not looked at
  sz-eyes evidence <id> [--summary <text>] [--took <text>] [--dir <project>]   writes ${EVIDENCE_DIR}/<id>/report.html

  sz-eyes standing [--summary|--json] [--dir <project>]
        every claim earlier work proved and the product still has to keep true, with how each is shown, when it
        was last shown to hold, and which of its check files changed since; exits 1 when one is recorded broken
  sz-eyes standing mend [--dir <project>]                during a git merge that conflicts in the record of standing claims: keeps the looks of both sides (the later where both looked at one claim)
  sz-eyes standing record <contract>/<claim> --status holds|broken|unchecked --note "<what was run and what it showed>" [--during <contract being worked on>] [--dir <project>]

  sz-eyes feedback new "<the owner's words>" [--round <folder>] [--dir <project>]
        write down something the owner said in the session (not by pointing); starts a round unless one is given
  sz-eyes feedback show [<round folder>] [--dir <project>]            what was said in a round (the latest by default)
  sz-eyes feedback note <round folder> <n> [--understood "<text>"] [--opinion "<text>"] [--status asked|doing|done|later|declined] [--did "<text>"] [--dir <project>]
        what was understood by it, what you think of it, and what came of it; "later" also writes it to the backlog
  sz-eyes feedback page [<round folder>] [--dir <project>]
        the page the owner reads after a round: each thing said, with the pictures in <round>/<n>/ (before-*, after-*)

  sz-eyes trial new [--dir <project>]                    start a trial: the product used the whole way by stand-ins for the people it is for; prints its folder
  sz-eyes trial person <folder> <id> --who "<who they are and the moment they arrive in>" [--instead "<what they use for this now, and what it costs them>"] [--pays-if "<what would have to be true for them to pay>"] [--voice "<words of a real person in that moment, as they wrote them>"]... [--model opus|sonnet]
  sz-eyes trial note <folder> <person> --when "<첫날|다음 날|3일 뒤|결제 앞|...>" --wanted "<what they wanted>" [--saw "<what the screen gave them>"] [--did "<what they did>"] --felt stuck|lost|fine|glad [--picture <file under the folder>]
  sz-eyes trial verdict <folder> <person> --reached yes|no --returned yes|no|no-pull|untried --pay yes|no|not-yet|never-asked --why "<in their words: what they have now that they did not, and what paying adds>" [--choice pay|free|back|stop] [--tell "<what they would tell a friend it is>"] [--needs "<what would make it a yes>"]
  sz-eyes trial canary <folder> --planted "<a fault put into one person's copy on purpose>" --found yes|no
  sz-eyes trial finding <folder> "<what stands between a person and paying>" --kind block|return|worth|pay --basis seen|guessed --size S|M|L [--evidence <file under the folder>]...
  sz-eyes trial ask <folder> "<a question only real people can answer>"
  sz-eyes trial show [<folder>] [--dir <project>]        the trial as it stands (the latest by default), and what it still lacks
  sz-eyes trial page [<folder>] [--dir <project>]        the page the owner reads; exits 1 while the trial is unfinished

  sz-eyes worth new <id> --service "<for whom, in what moment, it does what>" [--seed "<where the idea came from>"] [--dir <project>]
        start the case for a service: the same lines for every service, each shown or not. Kept in .sz/worth/<id>/
  sz-eyes worth cite <id> <line|others> --url <a public page> --quote "<the words as they stand there>" --shows "<what they show>" [--against] [--by scout|skeptic|lead]
        file words from a page under a line. The page is fetched again here and the words looked for on it:
        a quotation that is not found counts for nothing, and is kept as such. Lines: who, now, pays, gap, reach, edge, price, runs, does, returns, paid
  sz-eyes worth other <id> <other-id> --name "<name>" --kind product|workaround [--url <u>] [--price "<what it costs>"] [--sign "<the sign people buy or use it>"] [--cite <cN>]...
        what a person would use for the job instead: the service is judged against these, never against nothing
  sz-eyes worth line <id> <line> [--says "<the claim>"] [--status shown|refuted|waived|open] [--basis world|owner|product|stand-in|real] [--note "<text>"]
        what a line claims and where it stands. A line about the world is shown only when enough quotations
        were found on their pages; the owner's own ground is their words in --note; paid is shown by real money only
  sz-eyes worth row <id> <row-id> [--where "<where along the job>"] [--need "<what a person needs there>"] [--kind stake|edge|more] [--has <other-id>=yes|no|?]... [--cite <cN>]... [--ours have|lack|not-doing|planned|unknown] [--by "<the standing claim or picture / why not / which milestone>"]
        one row of the whole job: who gives it already and whether this product does. A stake is what two or
        more of the others have; "have" is shown by a standing claim or a picture, never said
  sz-eyes worth object <id> "<why the case is wrong>" --about <line|whole> --weight fatal|serious|minor [--cite <cN>]...
  sz-eyes worth answer <id> <n> "<what is wrong with the objection, or what was changed>"   |   sz-eyes worth answer <id> <n> --concede
        the skeptic's objections and what became of each. A fatal one that is granted refutes its line
  sz-eyes worth weigh <id> <cN> --supports yes|no --why "<text>"
        what someone who did not file a quotation makes of it, read where it stands: one judged not to
        support its line counts for nothing, and a line is not "go" on quotations nobody else read
  sz-eyes worth ask <id> "<what only real people can answer>" [--test "<the cheapest way to ask>"] [--sample <how many> --go-at <percent> --no-at <percent>]
        said before anyone is asked: how many, and the share that means go and that means no
  sz-eyes worth heard <id> <n> --of <how many were asked> --did <how many did it> [--note "<where the figures were read>"]
        what came back, read by what was said beforehand: go, no, or cannot tell (too few, or in between)
  sz-eyes worth call <id> go|narrow|no --why "<text>"      the call of whoever led the case; "go" is refused while anything stands in its way
  sz-eyes worth owner <id> --call build|not|later --said "<the owner's words>"   their decision, which is theirs alone
  sz-eyes worth show [<id>] [--dir <project>]            one case as it stands, or a line for each case
  sz-eyes worth page [<id>] [--dir <project>]            the page the owner reads: one case, or every case side by side (.sz/worth/index.html)

  sz-eyes sandbox                                        says "sandboxed" when run inside a session's command sandbox (where no browser starts), "open" when not
  sz-eyes backlog [--dir <project>]                      what is written down as known and not done (${BACKLOG_FILE})
  sz-eyes backlog add "<one line, in the owner's language>" [--from "<where it came from>"] [--dir <project>]
  sz-eyes backlog done "<some words of the line>" --by "<the contract or commit that ended it>" [--dir <project>]

  sz-eyes release new --place <name> --url <where people reach it> --commit <sha> --candidate <where the version about to go out answers>
        --check "<how what stands is shown again on the candidate>" --strangers "<how it is shown that others' data cannot be seen>"
        --backup "<...>" --way-back "<the command that puts the previous version back>" --walk "<the one thing, done on what is live>"
        --errors "<what prints the errors recorded since>" [--data "<...>"] [--kept "<...>"] [--previous <sha>] [--env <file>]...
        [--version-at <the path where the service says its commit, when it is not /healthz>]
        [--without "<line>|<why it does not apply>"]... [--claim "<id>|<what will be true>|<kind>:<ref>"]... [--frozen <path>]... [--dir <project>]
        the release gate as a frozen contract: the same lines for every release, each shown ("<kind>:<ref>" or a
        bare command) or waived with a reason the owner reads. Lines: ${GATE_LINES.join(', ')}.
        The rc- lines are shown before the switch, the live- lines after it; verdicts with sz-eyes contract claim
  sz-eyes release check --place <name> [--dir <project>]  a look at what is live now: the live- lines of the last release there, as a new contract
  sz-eyes release back <id> --note "<what was put back and what answers now>" [--dir <project>]   the release was taken back
  sz-eyes release list [--dir <project>]                 what was released where, and what should be answering now

  sz-eyes migrations look [<file.sql>...] [--since <commit>] [--until <commit>] [--json] [--dir <project>]
        read migration files (the ones given, or the .sql files that changed between two commits) and say which
        statements can lose or break what people stored: a drop, a rename, a type change, a required column
        with no default, a rule added to a table that has rows, row security turned off. Exits 1 when there is one

  sz-eyes secret run <NAME>=<vault id>... -- <command>...
        run a command with the owner's keys in its environment, by their names in the vault (the macOS Keychain).
        A key is in no argument, no file and no line of the session: if the command prints it, it is taken out
  sz-eyes secret has <vault id>...                       which of these the vault holds (names only), and for a missing one the line the owner stores it with; exits 1 when one is missing
  sz-eyes secret set <vault id>                          the owner's: puts what comes on stdin in the vault (pbpaste | sz-eyes secret set host/cloudflare/api-token)

  sz-eyes arm list [--json]
        the arms a product's server can take: services it calls with a key of the owner's (public data, a model
        that reads a picture into fields, sign-in with Kakao and Google), one file each in plugin/skills/backend/arms/.
        Each in a line, with whether the vault holds each of its keys (names only, never a value)
  sz-eyes arm need <name>... [--json]
        the step before building on arms: for each key of theirs the vault does not hold, the owner's steps from the
        arm's file, the line that stores it (! pbpaste | sz-eyes secret set <id>) and what to run next. Exits 1 while
        a key is missing, so that a workflow stops on it, and 0, in one line, when none is. What it prints goes to
        the owner as it stands; a missing key is never worked around with an example. An arm not in the catalogue
        is named, with the arms there are
  sz-eyes arm check <name> [--json]
        prove the arm's key works: the smallest real call the service allows, made here with the key read from the
        vault. Says "works", or the service's own reason for refusing, and what the call cost where the service
        bills; never the key, never a header. It reaches the service and can cost the owner: run it on their word.
        Exits 1 when it does not work. $SZ_ARMS_DIR is another catalogue, $SZ_ARM_<NAME>_URL another address for
        an arm's calls (both for tests)

  sz-eyes docker <args>...                               the container engine on this machine, reached without touching the owner's settings
  sz-eyes supabase <args>...                             the Supabase stack that runs on this machine for this project (never a hosted one)
        start also wires the stack to the login relay when the owner's Kakao or Google keys are in the vault (read
        there by their names; nobody spells them): each provider switched on with the relay's address as where it
        sends people back, the product's own local addresses allowed as where they land, the secrets handed over by
        environment only, the backend registered with the relay, the relay started. Prints one line: which
        providers are on and the one address the owner registers once with each. With no keys, nothing changes and
        it says which are missing

  sz-eyes login relay start|stop|status
        the one address registered with Kakao and Google for every product built here (http://localhost:49210/oauth/callback,
        or the port in SZ_LOGIN_RELAY_PORT): it passes each person who comes back from a provider on to the
        product's backend that started their sign-in, asking each registered backend's database. start runs it
        detached and starts nothing when it is already up (exits 1, saying what holds the port, when something
        else does); stop ends only the relay; status says whether it is up and which backends are registered.
        Its registry, pid file and log are in ~/.studio-zero/logins ($SZ_LOGINS_DIR). Run it outside the session's
        command sandbox: it reaches the databases through the container engine

  sz-eyes overview [<folder>...] [--out <file.html>]
        several products at once, most urgent first: promises that broke, what waits for the owner's judgement
        (with the evidence page that shows it), and for each product what is live where, when it was last looked
        at there, and what is left. A folder is a project, or holds projects. --out also writes the page

  sz-eyes port                                           a port nothing listens on, from the machine: start what you
        launch on it (PORT=$(sz-eyes port)), keep its process id ($!), and end it by that id. Never choose a
        number, and never end whatever holds a port: other work of the owner's runs on this machine
  sz-eyes copy <folder> [--at <commit>] [--with <path>]... [--dir <project>]
        a copy of the product to run beside it, in a folder outside the project: the files as committed (HEAD, or
        --at), the dependencies as installed (node_modules, cloned), --with what the map says is built and not in
        git (a built folder, a native app's Pods), and a stack name of its own (supabase/config.toml project_id
        with the folder's name), so that it shares no database with the project or another copy. Nothing the
        product stored is copied, and it is not a repository. The folder is the last line printed. Launch it
        there the way the map says, on a port from sz-eyes port
  sz-eyes copy <folder> --end
        ends a copy when you are done with it: stops its stack from its folder, then removes the folder (a stack
        is known by the folder it was started in: with the folder gone, nothing stops it by name). It refuses a
        folder sz-eyes copy did not make, and keeps the folder when the stack did not stop. A server you
        started there is yours to end first, by its process id

  sz-eyes refs add --kind "<kind of screen or journey>" --product "<name>" --what "<which screen, one line>" --link <the page it came from>
        (--file <picture on disk> | --image <https address of the picture>) --notes <file.md> [--platform ios|android|web] [--lang ko|en|...] [--for <project>] [--json]
        keep a reference: a picture of how a shipped product does a screen, and what is seen in it (--notes, 80
        characters at least: a picture with nothing said about it is not a reference). A picture is downloaded over
        https only, an image of 10 MB at most. The same link or the same picture is kept once, with the newer notes.
        A kind that is new lists the kinds there are: give one of their names when it is the same kind of screen
  sz-eyes refs find [<words>...] [--kind <kind>] [--product <name>] [--json]
        the kept references that have every word (in kind, product, what or notes), with where each picture is and
        the first lines of its notes; with nothing asked, how many are kept of each kind
  sz-eyes refs kinds [--json]                            each kind, how many references it holds, and whether it has a page
  sz-eyes refs kind "<kind>" [--write <file.md>] [--json]
        the page of what a kind's references teach, and its references. After keeping some, read them all and
        rewrite the page from them: --write replaces it, and the page before is kept as <kind>.prev.md
  sz-eyes refs show <id> [--json]                        one reference in full, notes and all
  sz-eyes refs edit <id> [--kind "<kind>"] [--product "<name>"] [--what "<one line>"] [--notes <file.md>] [--platform ios|android|web] [--lang <code>] [--link <address>] [--json]
        put right what is said about a reference: the fields given change, the rest and the id stay. A change of
        kind moves the picture into the new kind's folder (its file name, and so its hash, kept); a kind nobody has
        kept lists the kinds there are, as add does. --notes holds 80 characters at least, as for add; a link
        another reference has is refused (an address is kept once); "" takes out a platform or a language. Prints
        each change as it was and as it is (the notes by how many characters they now hold), and names the kind's
        page, which was written before the change (both kinds' pages when the kind changed). Another picture is
        another reference: remove, then add
  sz-eyes refs remove <id> [--json]
        take a reference out: its line and its picture. Prints all it held, notes and all, and the add that keeps it
        again. Its kind's page still speaks of it; a kind left with no reference keeps its page (the owner's
        writing), and refs kinds lists it with 0
        The library is the owner's own, on this machine ($SZ_REFS_DIR, or ~/.studio-zero/references): pictures of other
        products' screens kept to look at, never put into a product, never committed to a repository, never passed on.
        Its index.jsonl is changed only by these commands, under the lock every other agent writes it under: an edit
        by hand, while others write it, loses their lines

  sz-eyes image find [<words>...] [--kind <kind>] [--json]
        the first thing to run when a screen needs a picture: the pictures of the stock that have every word (in
        kind, what or prompt), each with its id, size, where it is and when it was kept; with nothing asked, how
        many are kept of each kind. When one fits, take it with image use rather than make another
  sz-eyes image use <id> --name <name> [--size <WxH>] [--out <folder>] [--dir <project>] [--json]
        put a picture of the stock in the project as <out>/<name>.<its type> (${IMAGE_ASSETS_DIR} by default), in
        seconds and with nothing spent. --size makes the copy exactly that size with macOS sips (scaled to cover it
        and cut from the middle, never stretched; a WebP comes out a PNG); sips keeps its working copy in the
        system's temporary folder, so a resize runs outside the session's command sandbox. A picture already there
        under that name stays as it was until the new one is whole
  sz-eyes image keep --file <picture> --kind "<kind>" --what "<one line: what is in the picture>" [--prompt "<the words it was made from>"] [--for <project>] [--json]
        bring a picture that already exists into the stock: one made earlier, or the owner's own photograph. PNG,
        JPEG or WebP, read from its bytes. The same picture is kept once ("already kept: <id>")
  sz-eyes image show <id> [--json]                       one picture of the stock in full, prompt and all
  sz-eyes image edit <id> [--kind "<kind>"] [--what "<one line>"] [--prompt "<words>"] [--json]
        put right what is said about a picture of the stock: the fields given change, the rest and the id stay. A
        change of kind moves the picture into the new kind's folder (its file name, and so its hash, kept); a kind
        nobody has kept lists the kinds there are, as keep does. --prompt "" takes out the words it was made from.
        Prints each change as it was and as it is. Another picture is another entry: remove, then keep
  sz-eyes image remove <id> [--json]
        take a picture out of the stock: its line and its file there. A copy put in a project with image use is the
        project's own and stays where it is. Prints all it held and the image keep that brings it back from such a copy
        The stock is the owner's own, on this machine ($SZ_STOCK_DIR, or ~/.studio-zero/stock), outside any
        repository: every picture made for a product, with the words it was made from, so that the next product
        takes it instead of making it again. index.jsonl holds a line a picture; pictures/<kind>/ the pictures. The
        index is changed only by these commands, under the lock every other agent writes it under: an edit by hand,
        while others write it, loses their lines
  sz-eyes image make --prompt "<what it shows and what it is for>" --name <name> --kind "<kind>" --what "<one line: what is in the picture>"
        [--size <WxH>] [--out <folder>] [--dir <project>] [--no-stock] [--json]
        make one original picture for the product's screens, on the subscription the owner already pays for: the
        Codex CLI makes it with its own image generation, signed in with ChatGPT, with every API key kept from it.
        Never through an API that bills for each image, and never any other way: when codex is not installed, not
        signed in, or signed in with an API key, nothing is made, and it says which and what the owner does about it.
        It is written to <out>/<name>.png (${IMAGE_ASSETS_DIR} by default) only when a PNG of exactly the asked size
        came back; a picture already there under that name stays as it was until then. --name: lower-case letters,
        digits and dashes. --size: hero 1600x900, square 1024x1024 (the default), OG 1200x630, share card
        1080x1350, story 1080x1920, favicon or app icon 512x512. No words inside the picture (they are set in HTML,
        and Korean letters come out wrong) and nothing that is someone else's (characters, logos, mascots, a living
        artist's style). One picture takes one to three minutes and is stopped at five: start it in the background
        and go on working; several may run at once under different names. codex keeps what it makes in ~/.codex,
        so run it outside the session's command sandbox. Prints the path, the size and how long it took. Exits 1,
        with nothing made, when codex refuses (its words, such as its own limit reached, are passed on as they are)
        or brings back no picture of exactly that size.
        A copy goes into the stock with its prompt, and its id is printed. --kind says what kind of picture it is
        (face, food, object, place and so on: a new kind lists the kinds there are, give one of their names when it
        is the same kind) and --what says in one line what is in it; both are asked every time. --no-stock leaves
        out a picture that is only right for this one product. When the stock already holds pictures of the kind,
        it says so before codex starts (how many, and the image find that lists them) and goes on
`;

/** `--flag value` pairs and bare words, in order. A flag given twice is a list. */
function parse(argv: string[], booleans: string[]): { words: string[]; flags: Map<string, string[]>; has: (name: string) => boolean; one: (name: string) => string | undefined; all: (name: string) => string[] } {
  const words: string[] = [];
  const flags = new Map<string, string[]>();
  for (let i = 0; i < argv.length; i++) {
    const word = argv[i]!;
    if (!word.startsWith('-') || word === '-') {
      words.push(word);
      continue;
    }
    if (booleans.includes(word)) flags.set(word, ['true']);
    else flags.set(word, [...(flags.get(word) ?? []), argv[++i] ?? '']);
  }
  return { words, flags, has: (name) => flags.has(name), one: (name) => flags.get(name)?.at(-1), all: (name) => flags.get(name) ?? [] };
}

const out = (text: string): void => void process.stdout.write(`${text}\n`);
const baseName = (path: string): string => path.split('/').at(-1)!;
const contractFile = (project: string, id: string): string => join(project, CONTRACTS_DIR, `${id}.json`);
const evidenceFolder = (project: string, id: string): string => join(project, EVIDENCE_DIR, id);
/**
 * A file of a contract's evidence as it is kept: relative to that contract's evidence folder. Given with the
 * folder in front, or from the project's root, it is the same file (two verifiers in a row gave it that way
 * and were told "no such file").
 */
const evidencePath = (project: string, id: string, given: string): string => {
  const folder = evidenceFolder(project, id);
  const whole = resolve(project, given);
  if (whole.startsWith(`${folder}/`) && existsSync(whole)) return whole.slice(folder.length + 1);
  return given.replace(/^\.\//, '');
};

/** `<contract>/<claim>|<why>`: a standing claim that a piece of work replaces, and the reason the owner reads. */
function supersedeOf(project: string, key: string, why: string): { contract: string; claim: string; why: string; at: string } {
  const stands = standing(project).stands;
  const found = stands.find((s) => s.key === key.trim());
  if (!found) throw new EyesError(`"${key.trim()}" is not a standing claim, so there is nothing to replace. Standing: ${stands.map((s) => s.key).join(', ') || '(none)'}`);
  if (why.trim().length < 8) throw new EyesError(`say why ${found.key} should no longer be true: what the owner asked that changes it`);
  return { contract: found.contract, claim: found.claim.id, why: why.trim(), at: new Date().toISOString() };
}

/** What an open contract owes beyond its own claims: what stood before it and it broke, and a frozen check changed behind the guard's back. */
function alsoOwed(project: string, contract: Contract): string[] {
  return [
    ...brokenDuring(project, contract.id).map((s) => `${s.key}: stood before this work and is broken now: ${s.claim.says}${s.last?.note ? ` (${s.last.note})` : ''}`),
    ...(contract.closedAt === null ? changedSinceFrozen(project, contract).map((path) => `${path}: changed since the contract was frozen, and no correction by the arbiter is recorded (\`git diff\` shows what; restore it, or have the sz:arbiter agent look at it)`) : []),
  ];
}

/** A contract with one of its claims changed, as a new object: the one that was read is left as it was. */
const withClaim = (contract: Contract, claimId: string, change: (claim: Claim) => Claim): Contract => ({ ...contract, claims: contract.claims.map((claim) => (claim.id === claimId ? change(claim) : claim)) });

/** Nothing is recorded or closed over a record of promises that cannot be read. */
function needLedger(project: string): void {
  const problem = ledgerProblem(project);
  if (problem) throw new EyesError(problem);
}

async function main(argv: string[]): Promise<number> {
  const [area, command, ...rest] = argv;
  if (!area || area === 'help' || area === '--help') {
    out(USAGE);
    return 0;
  }
  if (area === 'web' && command === 'look') {
    const a = parse(rest, ['--dark', '--house', '--json']);
    const url = a.words[0];
    if (!url) throw new EyesError('which page: sz-eyes web look <url>');
    const size = (a.one('--size') ?? 'phone') as Size;
    if (!(size in SIZES)) throw new EyesError(`--size is one of ${Object.keys(SIZES).join(', ')}`);
    const look = await lookAtWeb(url, { size, dark: a.has('--dark'), house: a.has('--house'), ...(a.one('--wait') ? { waitFor: a.one('--wait')! } : {}), ...(a.one('--out') ? { out: resolve(a.one('--out')!) } : {}), ...(a.one('--name') ? { name: a.one('--name')! } : {}) });
    out(a.has('--json') ? JSON.stringify(look, null, 2) : renderLook(look));
    return 0;
  }
  if (area === 'web' && command === 'sweep') {
    const a = parse(rest, ['--dark', '--house', '--json']);
    const address = a.words[0];
    const usage = 'sz-eyes web sweep <address> (--hash <id>... | --path <path>... | --from <file>) [--size phone|tablet|desktop] [--dark] [--wait <ms>] [--out <folder>]';
    if (!address || !/^(https?|file):\/\//i.test(address)) throw new EyesError(`which page: ${usage}. The address is http… or file://…`);
    const size = (a.one('--size') ?? 'phone') as Size;
    if (!(size in SIZES)) throw new EyesError(`--size is one of ${Object.keys(SIZES).join(', ')}`);
    const waitMs = Number(a.one('--wait') ?? 0);
    if (!Number.isFinite(waitMs) || waitMs < 0) throw new EyesError('--wait <ms>: milliseconds more to wait on each screen (500, 2000)');
    let screens: Screen[];
    try {
      // Read from the words as given, not from the flags: the order across --hash, --path and --from is the order measured.
      screens = planScreens(address, screensFromArgs(rest));
    } catch (err) {
      throw new EyesError(err instanceof Error ? err.message : String(err));
    }
    if (screens.length === 0) throw new EyesError(`which screens: ${usage}`);
    const swept = await sweepWeb(address, screens, { size, dark: a.has('--dark'), house: a.has('--house'), waitMs, ...(a.one('--out') ? { out: resolve(a.one('--out')!) } : {}) });
    out(a.has('--json') ? JSON.stringify(swept, null, 2) : renderSweep(swept));
    return swept.notHolding.length > 0 ? 1 : 0;
  }
  if (area === 'web' && command === 'do') {
    const a = parse(rest, ['--dark', '--house', '--json', '--clock']);
    const url = a.words[0];
    const steps = a.all('--step');
    if (!url || steps.length === 0) throw new EyesError('sz-eyes web do <url> --step "tap:<words>" --step "type:<field>=<text>" ... [--out <folder>]');
    const size = (a.one('--size') ?? 'phone') as Size;
    if (!(size in SIZES)) throw new EyesError(`--size is one of ${Object.keys(SIZES).join(', ')}`);
    const walk = await walkWeb(url, steps, { size, dark: a.has('--dark'), house: a.has('--house'), clock: a.has('--clock'), ...(a.one('--wait') ? { waitFor: a.one('--wait')! } : {}), ...(a.one('--out') ? { out: resolve(a.one('--out')!) } : {}), ...(a.one('--name') ? { name: a.one('--name')! } : {}) });
    out(a.has('--json') ? JSON.stringify(walk, null, 2) : renderWalk(walk, steps.length));
    return walk.passed ? 0 : 1;
  }
  if (area === 'web' && command === 'leaks') {
    const a = parse(rest, ['--json']);
    const dir = a.one('--dir');
    const url = a.words[0];
    if (!dir && !url) throw new EyesError('sz-eyes web leaks <url> [--path <path>]... [--env <file>]...   or   sz-eyes web leaks --dir <built folder> [--env <file>]...');
    let report;
    try {
      if (dir) report = leakReport(filesOf(resolve(dir)), a.all('--env').map((file) => resolve(file)));
      else {
        const served = await downloadsOf(url!, a.all('--path'));
        if (served.files.length === 0) throw new Error(`nothing was downloaded from ${url}: is it up?`);
        report = leakReport(served.files, a.all('--env').map((file) => resolve(file)), { strays: served.strays, maps: served.maps });
      }
    } catch (err) {
      throw new EyesError(err instanceof Error ? err.message.split('\n')[0]! : String(err));
    }
    out(a.has('--json') ? JSON.stringify(report, null, 2) : renderLeaks(report, dir ? resolve(dir) : url!));
    return report.leaks.length > 0 ? 1 : 0;
  }
  if (area === 'web' && command === 'strangers') {
    const a = parse(rest, ['--json', '--reads-only']);
    const url = a.words[0];
    if (!url || a.all('--as').length === 0) throw new EyesError('sz-eyes web strangers <url> --as "<step>"... [--other "<step>"...]: the steps sign a first person in and use the product as them');
    const headers = (flag: string): Record<string, string> => Object.fromEntries(a.all(flag).map((text) => [text.slice(0, text.indexOf(':')).trim().toLowerCase(), text.slice(text.indexOf(':') + 1).trim()]));
    const report = await strangers(url, { as: a.all('--as'), other: a.all('--other'), asHeaders: headers('--as-header'), otherHeaders: headers('--other-header'), marks: a.all('--mark'), open: a.all('--open'), readsOnly: a.has('--reads-only') }).catch((err: unknown) => {
      throw new EyesError(`the product could not be used at ${url}: ${err instanceof Error ? err.message.split('\n')[0] : String(err)}`);
    });
    out(a.has('--json') ? JSON.stringify(report, null, 2) : renderStrangers(report, url));
    return report.findings.length > 0 || report.stopped !== null || report.reads + report.changes === 0 ? 1 : 0;
  }
  if (area === 'web' && command === 'live') {
    const a = parse(rest, ['--json']);
    const url = a.words[0];
    if (!url) throw new EyesError('sz-eyes web live <url> [--commit <sha>] [--at /healthz]');
    const look = await lookAtLive(url, { ...(a.one('--commit') ? { commit: a.one('--commit')! } : {}), ...(a.one('--at') ? { at: a.one('--at')! } : {}) });
    out(a.has('--json') ? JSON.stringify(look, null, 2) : renderLive(look));
    return look.problems.length > 0 ? 1 : 0;
  }
  if (area === 'migrations' && command === 'look') {
    const a = parse(rest, ['--json']);
    const project = resolve(a.one('--dir') ?? '.');
    const until = a.one('--until') ?? null;
    let files: { file: string; sql: string }[];
    if (a.words.length > 0) files = a.words.map((file) => ({ file, sql: readFileSync(resolve(project, file), 'utf8') }));
    else {
      const since = a.one('--since');
      if (!since) throw new EyesError('sz-eyes migrations look <file.sql>...   or   sz-eyes migrations look --since <commit> [--until <commit>]');
      const names = spawnSync('git', ['-C', project, 'diff', '--name-only', '--diff-filter=AMR', since, until ?? 'HEAD', '--', '*.sql'], { encoding: 'utf8' });
      if (names.status !== 0) throw new EyesError(`the migration files that changed since ${since} could not be listed: ${(names.stderr ?? '').trim().split('\n')[0]}`);
      files = names.stdout.split('\n').filter(Boolean).map((file) => ({ file, sql: until ? spawnSync('git', ['-C', project, 'show', `${until}:${file}`], { encoding: 'utf8' }).stdout : readFileSync(join(project, file), 'utf8') }));
    }
    // Between two commits, what the code itself was given to say to the database is read as well.
    const since = a.words.length === 0 ? a.one('--since') : undefined;
    const written = since ? changesInCode(spawnSync('git', ['-C', project, 'diff', '-U0', since, until ?? 'HEAD'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).stdout ?? '') : [];
    const steps = [...classify(files), ...written];
    out(a.has('--json') ? JSON.stringify(steps, null, 2) : renderMigrations(steps, files.map((f) => f.file)));
    return steps.some((step) => DANGEROUS.includes(step.kind)) ? 1 : 0;
  }
  if (area === 'secret') {
    const words = argv.slice(2);
    try {
      if (command === 'run') {
        const { bindings, command: toRun } = parseRun(words);
        return await runWithSecrets(ownersVault(), bindings, toRun);
      }
      if (command === 'has') {
        if (words.length === 0) throw new Error('sz-eyes secret has <vault id>...');
        const held = await heldSecrets(ownersVault(), words);
        out(heldLines(held));
        return held.every((entry) => entry.held) ? 0 : 1;
      }
      if (command === 'set') {
        if (words.length !== 1) throw new Error('sz-eyes secret set <vault id>   (the value comes on stdin: pbpaste | sz-eyes secret set <id>)');
        if (process.stdin.isTTY) throw new Error('the value comes on stdin, so that it is never typed where it is kept: pbpaste | sz-eyes secret set <id>');
        let value = '';
        for await (const chunk of process.stdin) value += chunk;
        await setSecret(ownersVault(), words[0]!, value);
        out(`in the vault: ${words[0]}`);
        return 0;
      }
    } catch (err) {
      throw new EyesError(err instanceof Error ? err.message : String(err));
    }
  }
  if (area === 'arm') {
    const done = await armCommand(command, rest, { store: ownersVault(), env: process.env }).catch((err: unknown) => {
      throw err instanceof ArmError ? new EyesError(err.message) : err;
    });
    out(done.text);
    return done.code;
  }
  if (area === 'docker' || area === 'supabase') {
    const args = argv.slice(1);
    const tool = findTool(area);
    if (!tool) throw new EyesError(area === 'docker' ? 'no container engine was found on this machine (OrbStack or Docker)' : 'the Supabase command line was not found: brew install supabase/tap/supabase');
    if (area === 'supabase') {
      const hosted = hostedSupabaseCall(args);
      if (hosted) throw new EyesError(`not passed on: ${hosted}. This door opens only on the stack that runs on this machine. A hosted project is the owner's and is reached with their own \`supabase\`, by the steps of a release (sz:ship).`);
      return supabaseCommand(args, { tool, env: process.env, cwd: process.cwd(), store: ownersVault(), out: (text) => void process.stdout.write(text), err: (text) => void process.stderr.write(text) });
    }
    const ran = spawnSync(tool, args, { stdio: 'inherit', env: engineEnv() });
    return ran.status ?? 1;
  }
  if (area === 'login') {
    const done = await loginCommand(command, rest).catch((err: unknown) => {
      throw err instanceof RelayError ? (err.sandboxed ? new SandboxError(err.message) : new EyesError(err.message)) : err;
    });
    out(done.text);
    return done.code;
  }
  if (area === 'release') {
    const a = parse(rest, []);
    const project = resolve(a.one('--dir') ?? '.');
    const now = new Date().toISOString();
    const git = (...args: string[]): { ok: boolean; text: string } => {
      const ran = spawnSync('git', ['-C', project, ...args], { encoding: 'utf8' });
      return { ok: ran.status === 0, text: `${ran.stdout ?? ''}`.trimEnd() };
    };
    if (command === 'list') {
      out(renderReleases(project));
      return 0;
    }
    if (command === 'back') {
      const id = a.words[0];
      const note = (a.one('--note') ?? '').trim();
      if (!id || note.length < 12) throw new EyesError('sz-eyes release back <id> --note "<what was put back and what answers now>"');
      const file = contractFile(project, id);
      if (!existsSync(file)) throw new EyesError(`no such release: ${id}`);
      const back = updateContract(file, (contract) => {
        if (!contract.release || contract.release.candidate === null) throw new EyesError(`${id} is not a release`);
        if (contract.release.takenBack) throw new EyesError(`${id} was already taken back at ${contract.release.takenBack.at}`);
        return { ...contract, release: { ...contract.release, takenBack: { at: now, note } }, closedAt: contract.closedAt ?? now };
      });
      const release = back.release!;
      addToBacklog(project, [{ text: `출하 ${id}(${release.commit.slice(0, 7)})를 되돌렸다: ${note}`, from: id }]);
      out(`taken back: ${id}. ${lastRelease(project, release.place) ? `What should answer at ${release.place} now: ${lastRelease(project, release.place)!.release!.commit.slice(0, 7)}` : `Nothing released to ${release.place} stands now`}. Written to ${BACKLOG_FILE}.`);
      return 0;
    }
    const place = a.one('--place');
    if (!place) throw new EyesError('which place: --place <the name the map gives where the product runs for people>');
    const open = openContracts(project).map((entry) => entry.contract);
    const openRelease = open.find((c) => c.release?.place === place);
    if (openRelease) throw new EyesError(`${openRelease.id} is still open for ${place}: finish it (sz-eyes contract close ${openRelease.id}) or take it back (sz-eyes release back ${openRelease.id} --note ...) first`);
    const extraClaims = a.all('--claim').map((text) => {
      const [claimId = '', says = '', how = ''] = text.split('|').map((part) => part.trim());
      const at = how.indexOf(':');
      return { id: claimId, says, shownBy: ShownBy.parse({ kind: how.slice(0, at), ref: how.slice(at + 1).trim() }) };
    });
    const frozen = a.all('--frozen');
    const missing = frozen.filter((path) => !existsSync(join(project, path)));
    if (missing.length > 0) throw new EyesError(`not there to freeze: ${missing.join(', ')}`);
    const idFree = (wanted: string): string => {
      for (let n = 1; ; n++) {
        const id = n === 1 ? wanted : `${wanted}-${n}`;
        if (!existsSync(contractFile(project, id))) return id;
      }
    };
    let contract: Contract;
    if (command === 'check') {
      const last = lastRelease(project, place);
      if (!last) throw new EyesError(`nothing released to ${place} stands, so there is nothing to look at again. Releases: ${renderReleases(project)}`);
      const kept = (id: string): boolean => id.startsWith('live-') && id !== 'live-kept';
      contract = { ...last, id: idFree(`live-${localDay(now)}`), request: `${place}에 살아 있는 것 점검 (${last.release!.commit.slice(0, 7)}, ${last.id}로 내보낸 것)`, claims: last.claims.filter((claim) => kept(claim.id)).map((claim) => ({ ...claim, status: 'unproven', evidence: [], note: '', at: null })), notDoing: last.notDoing.filter((line) => kept(line)), noticed: [], amendments: [], frozenAt: now, createdAt: now, closedAt: null, release: { ...last.release!, candidate: null, previous: null } };
    } else if (command === 'new') {
      const url = a.one('--url');
      const given = a.one('--commit');
      const candidate = a.one('--candidate');
      if (!url || !given || !candidate) throw new EyesError('sz-eyes release new --place <name> --url <where people reach it> --commit <sha> --candidate <where the version about to go out answers> ... (sz-eyes help)');
      const notProven = open.filter((c) => c.release === null);
      if (notProven.length > 0) throw new EyesError(`work is still open: ${notProven.map((c) => c.id).join(', ')}. A release goes out from work that is closed: what it holds has been proven, or it is not in the release.`);
      const commit = git('rev-parse', '--verify', `${given}^{commit}`);
      if (!commit.ok) throw new EyesError(`${given} is not a commit of ${project}: a release names the commit that goes out`);
      // Each line is two status letters, a space, and the path.
      const dirty = git('status', '--porcelain', '--', '.', ':(exclude).sz').text.split('\n').filter((line) => line.trim() !== '');
      if (dirty.length > 0) throw new EyesError(`there are changes that are in no commit (${dirty.slice(0, 5).map((line) => line.slice(3)).join(', ')}${dirty.length > 5 ? ', ...' : ''}). What goes out is a commit: commit them or put them aside, or what answers will not be ${commit.text.slice(0, 7)}.`);
      const without = new Map(a.all('--without').map((text) => [text.slice(0, Math.max(0, text.indexOf('|'))).trim() || text.trim(), text.includes('|') ? text.slice(text.indexOf('|') + 1) : ''] as const));
      const previous = a.one('--previous') ?? lastRelease(project, place)?.release!.commit ?? null;
      const migrations = previous === null ? [] : git('diff', '--name-only', '--diff-filter=AMR', previous, commit.text, '--', '*.sql').text.split('\n').filter((line) => line.trim() !== '');
      // A product that changes the shape of its data from its own code has no .sql file to show for it.
      const inCode = previous === null ? [] : changesInCode(spawnSync('git', ['-C', project, 'diff', '-U0', previous, commit.text], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).stdout ?? '');
      for (const file of new Set(inCode.map((change) => change.file))) if (!migrations.includes(file)) migrations.push(file);
      const g: Gate = { place, url, commit: commit.text, previous, migrations, versionAt: a.one('--version-at') ?? null, candidate, check: a.one('--check') ?? null, strangers: a.one('--strangers') ?? null, data: a.one('--data') ?? null, backup: a.one('--backup') ?? null, wayBack: a.one('--way-back') ?? null, walk: a.one('--walk') ?? null, errors: a.one('--errors') ?? null, kept: a.one('--kept') ?? null, env: a.all('--env') };
      try {
        contract = releaseContract(project, idFree(`release-${releases(project).filter((c) => c.release!.candidate !== null).length + 1}`), g, { without, claims: extraClaims, frozen, now });
      } catch (err) {
        throw new EyesError(err instanceof Error ? err.message : String(err));
      }
    } else throw new EyesError('sz-eyes release new|check|back|list (sz-eyes help)');
    const file = contractFile(project, contract.id);
    writeContract(file, Contract.parse(contract));
    out(`${file}\n\n${renderContract(Contract.parse(contract))}\nIt is frozen. ${contract.release!.candidate === null ? 'Have each line shown on what is live' : 'Have the rc- lines shown on the candidate before the switch, and the live- lines on what people reach after it'}: sz-eyes contract claim ${contract.id} <line> --status ...`);
    return 0;
  }
  if (area === 'electron' && (command === 'look' || command === 'do')) {
    const a = parse(rest, ['--json', '--onscreen', '--house']);
    const folder = a.words[0];
    const steps = a.all('--step');
    if (!folder || (command === 'do' && steps.length === 0)) throw new EyesError('sz-eyes electron look <app folder> [--window <words>]   or   sz-eyes electron do <app folder> --step "<step>"...');
    const env = Object.fromEntries(a.all('--env').map((pair) => [pair.slice(0, pair.indexOf('=')), pair.slice(pair.indexOf('=') + 1)]));
    const days = Number(a.one('--days-later') ?? 0);
    if (!Number.isFinite(days)) throw new EyesError('--days-later <n>: a number of days (1, 7, 0.5)');
    const walk = await walkElectron(resolve(folder), command === 'do' ? steps : [], { args: a.all('--arg'), env, onscreen: a.has('--onscreen'), house: a.has('--house'), ...(a.one('--window') ? { window: a.one('--window')! } : {}), ...(a.one('--out') ? { out: resolve(a.one('--out')!) } : {}), ...(a.one('--name') ? { name: a.one('--name')! } : {}), ...(a.one('--electron') ? { executablePath: resolve(a.one('--electron')!) } : {}), ...(a.one('--data') ? { data: resolve(a.one('--data')!) } : {}), ...(days !== 0 ? { daysLater: days } : {}) }).catch((err: unknown) => {
      throw err instanceof ElectronError ? new EyesError(err.message) : err;
    });
    if (command === 'look') out(a.has('--json') ? JSON.stringify(walk.end, null, 2) : renderAppLook(walk.end));
    else out(a.has('--json') ? JSON.stringify(walk, null, 2) : renderAppWalk(walk, steps.length));
    return walk.passed ? 0 : 1;
  }
  if (area === 'web' && command === 'review') {
    const a = parse(rest, ['--dark']);
    const url = a.words[0];
    if (!url) throw new EyesError('which page: sz-eyes web review <url>');
    const size = (a.one('--size') ?? 'phone') as Size;
    if (!(size in SIZES)) throw new EyesError(`--size is one of ${Object.keys(SIZES).join(', ')}`);
    const project = resolve(a.one('--dir') ?? '.');
    const folder = a.one('--round') ? resolve(a.one('--round')!) : newRound(project, new Date().toISOString());
    if (!existsSync(join(folder, 'items.json'))) throw new EyesError(`${folder} is not a round of feedback (it has no items.json). Leave --round out to start one.`);
    out(`a window is open on ${url} for the owner: they press 말하기, point at what they mean and say it; this ends when they press 끝내기 or close the window. Round: ${folder}`);
    const round = await reviewWeb(url, folder, { size, dark: a.has('--dark') }).catch((err: unknown) => {
      throw new EyesError(`the window could not be opened on ${url}: ${err instanceof Error ? err.message.split('\n')[0] : String(err)}`);
    });
    out(`\n${renderRound(round, folder)}`);
    return 0;
  }
  if (area === 'feedback') {
    const a = parse(rest, []);
    const project = resolve(a.one('--dir') ?? '.');
    const now = new Date().toISOString();
    if (command === 'new') {
      const said = a.words.join(' ').trim();
      if (said === '') throw new EyesError('sz-eyes feedback new "<the owner\'s words>" [--round <folder>]');
      const folder = a.one('--round') ? resolve(a.one('--round')!) : newRound(project, now);
      if (!existsSync(join(folder, 'items.json'))) throw new EyesError(`${folder} is not a round of feedback (it has no items.json). Leave --round out to start one.`);
      const item = addSaid(folder, { said, at: now });
      out(`${folder}\nitem ${item.n}. Pictures of it go in ${join(folder, String(item.n))}/ (before-<size>.png, after-<size>.png)`);
      return 0;
    }
    const given = command === 'note' ? a.words[0] : a.words[0];
    const folder = given ? resolve(given) : latestRound(project);
    if (!folder || !existsSync(join(folder, 'items.json'))) throw new EyesError(given ? `${given} is not a round of feedback (it has no items.json)` : 'no round of feedback has been started in this project');
    if (command === 'show') {
      out(renderRound(readRound(folder), folder));
      return 0;
    }
    if (command === 'page') {
      out(writeRoundPage(folder));
      return 0;
    }
    if (command === 'note') {
      const n = Number(a.words[1]);
      if (!given || !Number.isInteger(n)) throw new EyesError('sz-eyes feedback note <round folder> <n> [--understood ..] [--opinion ..] [--status ..] [--did ..]');
      const patch = {
        ...(a.one('--understood') ? { understood: a.one('--understood')! } : {}),
        ...(a.one('--opinion') ? { opinion: a.one('--opinion')! } : {}),
        ...(a.one('--did') ? { did: a.one('--did')! } : {}),
        ...(a.one('--status') ? { status: Status.parse(a.one('--status')) } : {}),
      };
      try {
        const item = noteSaid(project, folder, n, patch);
        out(`${n}: ${item.status}`);
      } catch (err) {
        throw new EyesError(err instanceof Error ? err.message : String(err));
      }
      return 0;
    }
  }
  if (area === 'ios') {
    const a = parse(rest, ['--video', '--erase']);
    if (command === 'spare') {
      out(await spareSimulator({ ...(a.one('--type') ? { type: a.one('--type')! } : {}), ...(a.one('--name') ? { name: a.one('--name')! } : {}) }));
      return 0;
    }
    const udid = a.words[0];
    if (!udid) throw new EyesError('which simulator: give the id sz-eyes ios spare printed');
    if (command === 'install') {
      const bundleId = a.one('--bundle-id');
      if (!a.words[1] || !bundleId) throw new EyesError('sz-eyes ios install <udid> <path.app> --bundle-id <id> [--metro <port>]');
      await installApp(udid, resolve(a.words[1]), { bundleId, ...(a.one('--metro') ? { metroPort: Number(a.one('--metro')) } : {}) });
      out(`installed ${basename(a.words[1])} on ${udid}`);
      return 0;
    }
    if (command === 'flow') {
      if (!a.words[1] || !a.one('--out')) throw new EyesError('sz-eyes ios flow <udid> <flow.yaml> --out <folder> [--video] [-e KEY=VALUE]');
      const env = Object.fromEntries(a.all('-e').map((pair) => [pair.slice(0, pair.indexOf('=')), pair.slice(pair.indexOf('=') + 1)]));
      const result = await runFlow(udid, resolve(a.words[1]), { out: resolve(a.one('--out')!), env, video: a.has('--video') });
      out(`${result.passed ? 'PASSED' : 'FAILED'} ${basename(result.flow)} in ${result.seconds}s, ${result.steps.filter((s) => s.state === 'completed').length} of ${result.steps.length} steps completed`);
      if (result.failed) out(`stopped at: ${result.failed}`);
      if (result.screenshots.length > 0) out(`screenshots:\n${result.screenshots.map((file) => `  ${file}`).join('\n')}`);
      if (result.filmstrip) out(`film: ${result.filmstrip}`);
      if (result.video) out(`video: ${result.video}`);
      if (!result.passed) out(`\nthe end of Maestro's own words:\n${result.log.split('\n').slice(-25).join('\n')}`);
      return result.passed ? 0 : 1;
    }
    if (command === 'look') {
      const folder = a.one('--out') ? resolve(a.one('--out')!) : null;
      const shot = folder ? await screenshot(udid, join(folder, `${a.one('--name') ?? 'look'}.png`)) : null;
      const seen = await screenText(udid);
      if (shot) out(`screenshot: ${shot}`);
      out(`words on it (${seen.texts.length}): ${seen.texts.slice(0, 80).map((text) => JSON.stringify(text)).join(' ')}`);
      out(`ids on it (${seen.ids.length}): ${seen.ids.slice(0, 80).join(', ')}`);
      return 0;
    }
    if (command === 'rest') {
      await restSimulator(udid, { erase: a.has('--erase') });
      out(`${udid} is shut down${a.has('--erase') ? ' and wiped' : ''}`);
      return 0;
    }
  }
  if (area === 'standing') {
    const a = parse(command === 'record' || command === 'mend' ? rest : argv.slice(1), ['--summary', '--json']);
    const project = resolve(a.one('--dir') ?? '.');
    if (command === 'mend') {
      try {
        out(`${STANDING_FILE}: the looks of both sides kept, ${mendLedger(project)} claim(s). Add it and conclude the merge; then show the claims again on the merged product`);
      } catch (err) {
        throw new EyesError(err instanceof Error ? err.message : String(err));
      }
      return 0;
    }
    if (command === 'record') {
      const key = a.words[0];
      const note = (a.one('--note') ?? '').trim();
      const during = a.one('--during') ?? null;
      if (!key) throw new EyesError('sz-eyes standing record <contract>/<claim> --status holds|broken|unchecked --note "<what was run and what it showed>" [--during <contract>]');
      if (note.length < 8) throw new EyesError('say what was run or looked at and what it showed: --note "<...>"');
      if (during !== null && !existsSync(contractFile(project, during))) throw new EyesError(`--during ${during}: no such contract`);
      needLedger(project);
      const status = Shown.shape.status.parse(a.one('--status'));
      try {
        recordShown(project, key, { status, note, during, at: new Date().toISOString() });
      } catch (err) {
        throw new EyesError(err instanceof Error ? err.message : String(err));
      }
      out(`${key}: ${status}`);
      return 0;
    }
    const problem = ledgerProblem(project);
    if (a.has('--summary')) {
      const line = problem ?? standingSummary(project);
      if (line) out(line);
      return 0;
    }
    if (problem) {
      out(problem);
      return 1;
    }
    if (a.has('--json')) {
      out(JSON.stringify(standing(project), null, 2));
      return 0;
    }
    out(renderStanding(project));
    return standing(project).stands.some((s) => s.last?.status === 'broken') ? 1 : 0;
  }
  if (area === 'overview') {
    const a = parse(argv.slice(1), []);
    const products = findProducts(a.words.length > 0 ? a.words : ['.']).flatMap((dir) => viewOf(dir) ?? []);
    out(renderOverview(products));
    if (a.one('--out')) {
      const file = resolve(a.one('--out')!);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, overviewPage(products, new Date().toISOString()));
      out(`\n${file}`);
    }
    return 0;
  }
  if (area === 'trial') {
    const a = parse(rest, []);
    const project = resolve(a.one('--dir') ?? '.');
    const now = new Date().toISOString();
    try {
      if (command === 'new') {
        out(newTrial(project, now));
        return 0;
      }
      if (command === 'show' || command === 'page') {
        const folder = a.words[0] ? resolve(a.words[0]) : latestTrial(project);
        if (!folder || !existsSync(join(folder, 'trial.json'))) throw new Error(a.words[0] ? `${a.words[0]} is not a trial (it has no trial.json)` : 'no trial has been started in this project: sz-eyes trial new');
        if (command === 'show') {
          out(renderTrial(readTrial(folder), folder));
          return 0;
        }
        const left = unfinished(readTrial(folder));
        out(writeTrialPage(folder));
        if (left.length > 0) out(`not finished, and the page says so:\n${left.map((line) => `  - ${line}`).join('\n')}`);
        return left.length > 0 ? 1 : 0;
      }
      const folder = a.words[0] ? resolve(a.words[0]) : '';
      if (!folder || !existsSync(join(folder, 'trial.json'))) throw new Error(`which trial: give the folder sz-eyes trial new printed${a.words[0] ? ` (${a.words[0]} has no trial.json)` : ''}`);
      if (command === 'person') {
        addPersona(folder, { id: a.words[1] ?? '', who: a.one('--who') ?? '', instead: a.one('--instead') ?? '', paysIf: a.one('--pays-if') ?? '', voices: a.all('--voice'), model: a.one('--model') ?? '' });
        out(`person: ${a.words[1]}`);
        return 0;
      }
      if (command === 'note') {
        addNote(folder, { persona: a.words[1] ?? '', when: a.one('--when') ?? '', wanted: a.one('--wanted') ?? '', saw: a.one('--saw') ?? '', did: a.one('--did') ?? '', felt: Felt.parse(a.one('--felt')), picture: a.one('--picture') ?? null, at: now });
        out(`noted for ${a.words[1]}`);
        return 0;
      }
      if (command === 'verdict') {
        setVerdict(folder, Verdict.parse({ persona: a.words[1] ?? '', reached: a.one('--reached'), returned: a.one('--returned'), pay: a.one('--pay'), why: a.one('--why') ?? '', needs: a.one('--needs') ?? '', choice: a.one('--choice') ?? null, tell: a.one('--tell') ?? '' }));
        out(`verdict for ${a.words[1]}`);
        return 0;
      }
      if (command === 'finding') {
        addFinding(folder, TrialFinding.parse({ text: a.words.slice(1).join(' '), kind: TrialKind.parse(a.one('--kind')), size: a.one('--size'), basis: a.one('--basis'), evidence: a.all('--evidence') }));
        out('found');
        return 0;
      }
      if (command === 'canary') {
        const found = a.one('--found');
        if ((a.one('--planted') ?? '').trim().length < 8 || (found !== 'yes' && found !== 'no')) throw new Error('sz-eyes trial canary <folder> --planted "<the fault put into one person\'s copy on purpose>" --found yes|no');
        setCanary(folder, a.one('--planted')!.trim(), found === 'yes');
        out(`planted fault: ${found === 'yes' ? 'reported' : 'not reported'}`);
        return 0;
      }
      if (command === 'ask') {
        if (a.words.slice(1).join(' ').trim().length < 8) throw new Error('sz-eyes trial ask <folder> "<a question only real people can answer>"');
        addAsk(folder, a.words.slice(1).join(' '));
        out('asked');
        return 0;
      }
    } catch (err) {
      // What a schema refuses is said in a line: which flag, and what it takes.
      const issues = (err as { issues?: { path: (string | number)[]; message: string }[] }).issues;
      throw new EyesError(Array.isArray(issues) ? `${issues.map((issue) => `${issue.path.join('.') || 'a value'}: ${issue.message}`).join('; ')} (sz-eyes help shows each flag and the words it takes)` : err instanceof Error ? err.message : String(err));
    }
  }
  if (area === 'worth') {
    const a = parse(rest, ['--against', '--concede']);
    const project = resolve(a.one('--dir') ?? '.');
    const now = new Date().toISOString();
    const id = a.words[0] ?? '';
    try {
      if (command === 'show' || command === 'page') {
        if (!id) {
          out(command === 'show' ? renderCases(allCases(project)) : writeCasesPage(project));
          return 0;
        }
        const folder = caseFolder(project, id);
        const value = readCase(folder);
        out(command === 'show' ? renderCase(value, folder) : writeCasePage(folder));
        return command === 'page' && standingOf(value) === 'thin' ? 1 : 0;
      }
      if (!id) throw new Error('which case: give its id (sz-eyes worth show lists them)');
      if (command === 'new') {
        out(newCase(project, id, a.one('--service') ?? '', a.one('--seed') ?? '', now));
        return 0;
      }
      const folder = caseFolder(project, id);
      if (command === 'cite') {
        const line = a.words[1] === 'others' ? 'others' : LineId.parse(a.words[1]);
        const url = a.one('--url') ?? '';
        const quote = a.one('--quote') ?? '';
        const shows = a.one('--shows') ?? '';
        if (!url || !quote || shows.trim().length < 2) throw new Error('sz-eyes worth cite <id> <line> --url <a public page> --quote "<the words as they stand there>" --shows "<what they show>"');
        const count = readCase(folder).cites.length + 1;
        const found = await seeQuote(url, quote, { shot: join(folder, 'cites', `c${count}.png`) }).catch((err: unknown) => {
          if (err instanceof CiteError) throw new Error(err.message);
          throw err;
        });
        const made = addCite(folder, { line, url, quote, shows, against: a.has('--against'), by: (a.one('--by') as 'scout' | 'skeptic' | 'lead' | undefined) ?? 'scout' }, { seen: found.seen ? { ...found.seen, shot: found.seen.shot ? `cites/${baseName(found.seen.shot)}` : null } : null, why: found.why });
        out(made.seen ? `${made.id}: seen on ${made.host} (${made.seen.by}): ${made.seen.excerpt.slice(0, 200)}` : `${made.id}: NOT SEEN, so it counts for nothing: ${made.failed}`);
        return made.seen ? 0 : 1;
      }
      if (command === 'other') {
        setOther(folder, Other.parse({ id: a.words[1] ?? '', name: a.one('--name') ?? '', url: a.one('--url') ?? '', kind: a.one('--kind'), price: a.one('--price') ?? '', sign: a.one('--sign') ?? '', cites: a.all('--cite') }));
        out(`instead: ${a.words[1]}`);
        return 0;
      }
      if (command === 'line') {
        const line = LineId.parse(a.words[1]);
        const set = setLine(folder, line, { ...(a.one('--says') !== undefined ? { says: a.one('--says')! } : {}), ...(a.one('--status') ? { status: LineStatus.parse(a.one('--status')) } : {}), ...(a.one('--basis') ? { basis: Basis.parse(a.one('--basis')) } : {}), ...(a.one('--note') !== undefined ? { note: a.one('--note')! } : {}) }, now);
        out(`${line}: ${set.status}${set.basis ? ` (${set.basis})` : ''}`);
        return 0;
      }
      if (command === 'row') {
        const has = Object.fromEntries(a.all('--has').map((pair) => [pair.slice(0, pair.lastIndexOf('=')), pair.slice(pair.lastIndexOf('=') + 1)])) as Record<string, 'yes' | 'no' | '?'>;
        const stands = new Set(standing(project).stands.map((s) => s.key));
        const row = setRow(folder, { id: a.words[1] ?? '', ...(a.one('--where') ? { where: a.one('--where')! } : {}), ...(a.one('--need') ? { need: a.one('--need')! } : {}), ...(a.one('--kind') ? { kind: a.one('--kind') as 'stake' | 'edge' | 'more' } : {}), ...(a.all('--has').length > 0 ? { has } : {}), ...(a.all('--cite').length > 0 ? { cites: a.all('--cite') } : {}), ...(a.one('--ours') ? { ours: a.one('--ours') as 'have' } : {}), ...(a.one('--by') !== undefined ? { by: a.one('--by')! } : {}) }, (key) => stands.has(key));
        out(`row ${row.id}: ${row.kind}, ours ${row.ours}`);
        return 0;
      }
      if (command === 'object') {
        const n = addObjection(folder, Objection.parse({ about: a.one('--about'), text: a.words.slice(1).join(' '), weight: a.one('--weight'), cites: a.all('--cite') }));
        out(`objection ${n}`);
        return 0;
      }
      if (command === 'answer') {
        const n = Number(a.words[1]);
        const done = answerObjection(folder, n, a.has('--concede') ? null : a.words.slice(2).join(' '), now);
        out(done.conceded ? `objection ${n}: granted${done.weight === 'fatal' ? ' (fatal: what it is about is refuted)' : ''}` : `objection ${n}: answered`);
        return 0;
      }
      if (command === 'weigh') {
        const says = a.one('--supports');
        if (says !== 'yes' && says !== 'no') throw new Error('sz-eyes worth weigh <id> <cN> --supports yes|no --why "<what the words do or do not show about the line>"');
        const cite = weighCite(folder, a.words[1] ?? '', says === 'yes', a.one('--why') ?? '', now);
        out(`${cite.id}: ${says === 'yes' ? 'supports' : 'does not support'} ${cite.line}`);
        return 0;
      }
      if (command === 'ask') {
        if (a.words.slice(1).join(' ').trim().length < 8) throw new Error('sz-eyes worth ask <id> "<what only real people can answer>" [--test "<the cheapest way to ask>"] [--sample <how many> --go-at <percent> --no-at <percent>]');
        const number = (flag: string): number | undefined => {
          const value = a.one(flag);
          if (value === undefined) return undefined;
          if (!Number.isFinite(Number(value))) throw new Error(`${flag} takes a number`);
          return Number(value);
        };
        const n = addWorthAsk(folder, a.words.slice(1).join(' '), a.one('--test') ?? '', { ...(number('--sample') !== undefined ? { sample: number('--sample')! } : {}), ...(number('--go-at') !== undefined ? { goAt: number('--go-at')! } : {}), ...(number('--no-at') !== undefined ? { noAt: number('--no-at')! } : {}) });
        out(`question ${n}`);
        return 0;
      }
      if (command === 'heard') {
        const heard = hearAsk(folder, Number(a.words[1]), Number(a.one('--of')), Number(a.one('--did')), a.one('--note') ?? '', now);
        out(`${heard.did} of ${heard.of}: ${heard.reading}`);
        return 0;
      }
      if (command === 'call') {
        setCall(folder, { call: a.words[1] as 'go', why: a.one('--why') ?? '', at: now });
        out(`call: ${a.words[1]}`);
        return 0;
      }
      if (command === 'owner') {
        setOwner(folder, { call: a.one('--call') as 'build', said: a.one('--said') ?? '', at: now });
        out(`the owner: ${a.one('--call')}`);
        return 0;
      }
    } catch (err) {
      if (err instanceof SandboxError) throw err;
      const issues = (err as { issues?: { path: (string | number)[]; message: string }[] }).issues;
      throw new EyesError(Array.isArray(issues) ? `${issues.map((issue) => `${issue.path.join('.') || 'a value'}: ${issue.message}`).join('; ')} (sz-eyes help shows each flag and the words it takes)` : err instanceof Error ? err.message : String(err));
    }
  }
  if (area === 'refs') {
    const done = await refsCommand(command, parse(rest, ['--json'])).catch((err: unknown) => {
      throw err instanceof RefsError ? new EyesError(err.message) : err;
    });
    out(done.text);
    return done.code;
  }
  if (area === 'image') {
    const done = await imageCommand(command, parse(rest, ['--json', '--no-stock'])).catch((err: unknown) => {
      if (err instanceof ImageError) throw err.sandboxed ? new SandboxError(err.message) : new EyesError(err.message);
      throw err;
    });
    out(done.text);
    return done.code;
  }
  if (area === 'sandbox') {
    // Asked once, by whoever plans the work, as an ordinary command: is this session's command sandbox in the way.
    try {
      await closeBrowser(await openBrowser());
      out('open: a browser starts from here. This command did not run inside a command sandbox.');
    } catch (err) {
      if (!(err instanceof SandboxError)) throw err;
      out("sandboxed: this command ran inside the session's command sandbox, where no browser starts. Whoever works in this session runs what opens a browser, a desktop app, a simulator or Docker outside it from the first try (dangerouslyDisableSandbox: true on the Bash call).");
    }
    return 0;
  }
  if (area === 'port') {
    out(String(await freePort()));
    return 0;
  }
  if (area === 'copy') {
    const a = parse(argv.slice(1), ['--end']);
    const folder = a.words[0];
    if (!folder || a.words.length > 1) throw new EyesError('sz-eyes copy <folder> [--at <commit>] [--with <path>]... [--dir <project>], or sz-eyes copy <folder> --end: one folder, outside the project');
    if (a.has('--end')) {
      const tool = findTool('supabase');
      // Without the command line there is no stack to stop.
      const ended = await endCopy(folder, async (cwd) => (tool ? supabaseCommand(['stop'], { tool, env: process.env, cwd, store: ownersVault(), out: (text) => void process.stdout.write(text), err: (text) => void process.stderr.write(text) }) : 0));
      out(`ended: ${ended.folder} (${ended.stack ? 'its stack stopped, ' : ''}the folder removed). What you started there yourself (a server, a packager) is ended by its process id`);
      return 0;
    }
    const project = resolve(a.one('--dir') ?? '.');
    out(copyText(makeCopy(project, folder, { at: a.one('--at'), with: a.all('--with') }), project));
    return 0;
  }
  if (area === 'backlog') {
    const a = parse(command === 'add' || command === 'done' ? rest : argv.slice(1), []);
    const project = resolve(a.one('--dir') ?? '.');
    if (command === 'done') {
      try {
        out(`ticked: ${doneInBacklog(project, a.words.join(' '), a.one('--by') ?? '')}`);
      } catch (err) {
        throw new EyesError(`${(err as Error).message}\nsz-eyes backlog done "<some words of the line>" --by "<the contract or commit that ended it>"`);
      }
      return 0;
    }
    if (command === 'add') {
      const text = a.words.join(' ').trim();
      if (text === '') throw new EyesError('sz-eyes backlog add "<one line>" [--from "<where it came from>"]');
      out(addToBacklog(project, [{ text, from: a.one('--from') ?? '' }]) > 0 ? `added to ${BACKLOG_FILE}` : 'already there');
      return 0;
    }
    const open = openBacklog(project);
    out(open.length === 0 ? 'nothing is written down as left to do' : `${open.length} open in ${BACKLOG_FILE}:\n${open.map((line, i) => `  ${i + 1}. ${line}`).join('\n')}`);
    return 0;
  }
  if (area === 'contract' || area === 'evidence') {
    const a = parse(area === 'evidence' ? [command ?? '', ...rest] : rest, []);
    const project = resolve(a.one('--dir') ?? '.');
    if (area === 'contract' && command === 'status') {
      const open = openContracts(project).map(({ contract }) => ({ contract, owes: [...owed(contract), ...alsoOwed(project, contract)] })).filter((c) => c.owes.length > 0);
      const problem = ledgerProblem(project);
      if (problem) out(problem);
      if (open.length === 0) {
        if (!problem) out('nothing is owed: every open contract is frozen and has no claim left unshown or shown false');
        return problem ? 1 : 0;
      }
      for (const { contract, owes } of open) out(`contract ${contract.id} (lane ${contract.lane}) still owes:\n${owes.map((line) => `  - ${line}`).join('\n')}`);
      return 1;
    }
    if (area === 'contract' && command === 'built' && a.words.length === 0) {
      // What stands and is not closed yet: a session waits on this to show the owner the product while it is verified.
      const waiting = openContracts(project).filter(({ contract }) => contract.built !== null);
      if (waiting.length === 0) {
        out('nothing is built and waiting to be closed (a builder says so with: sz-eyes contract built <id> --launch "<the command that starts it, and where it is seen>")');
        return 1;
      }
      for (const { contract } of waiting) out(`${contract.id}\t${contract.built!.launch}`);
      return 0;
    }
    const id = a.words[0];
    if (!id) throw new EyesError('which contract: give its id');
    const file = contractFile(project, id);
    if (area === 'contract' && command === 'new') {
      if (existsSync(file)) throw new EyesError(`${file} is already there`);
      const claims = a.all('--claim').map((text) => {
        const [claimId = '', says = '', how = ''] = text.split('|').map((part) => part.trim());
        const at = how.indexOf(':');
        return { id: claimId, says, shownBy: ShownBy.parse({ kind: how.slice(0, at), ref: how.slice(at + 1).trim() }) };
      });
      const supersedes = a.all('--supersedes').map((text) => {
        const bar = text.indexOf('|');
        return supersedeOf(project, bar < 0 ? text : text.slice(0, bar), bar < 0 ? '' : text.slice(bar + 1));
      });
      const contract = Contract.parse({ id, request: a.one('--request') ?? '', lane: Lane.parse(a.one('--lane') ?? 'M'), targets: a.all('--target'), claims, notDoing: a.all('--not'), risks: a.all('--risk'), supersedes, createdAt: new Date().toISOString() });
      writeContract(file, contract);
      out(`${file}\n\n${renderContract(contract)}`);
      return 0;
    }
    const contract = readContract(file);
    if (area === 'evidence') {
      const folder = evidenceFolder(project, id);
      mkdirSync(folder, { recursive: true });
      out(writeEvidencePage(contract, folder, join(folder, 'report.html'), { kept: keptFor(project, contract), ...(a.one('--summary') ? { summary: a.one('--summary')! } : {}), ...(a.one('--took') ? { took: a.one('--took')! } : {}) }));
      return 0;
    }
    if (command === 'show') {
      const changed = contract.closedAt === null ? changedSinceFrozen(project, contract) : [];
      out(`${renderContract(contract)}${changed.length > 0 ? `\n얼린 뒤 바뀐 파일 (중재자의 수정 기록 없음): ${changed.join(', ')}\n` : ''}`);
      return 0;
    }
    if (command === 'frozen') {
      // Whether the checks a contract froze are still as they were: asked by whoever verifies, in one command.
      if (contract.frozenAt === null) throw new EyesError(`${id} is not frozen yet`);
      const now = fingerprints(project, contract.frozen);
      const changed = contract.frozen.filter((path) => contract.frozenPrints[path] !== undefined && contract.frozenPrints[path] !== now[path]);
      out(contract.frozen.length === 0 ? `${id} froze no file` : `${id} froze ${contract.frozen.length} file(s) at ${contract.frozenAt}:\n${contract.frozen.map((path) => `  ${changed.includes(path) ? 'CHANGED  ' : contract.frozenPrints[path] === undefined ? 'unstamped' : 'as frozen'} ${path}${contract.amendments.some((amend) => amend.file === path) ? ' (corrected by the arbiter since, and stamped again)' : ''}`).join('\n')}`);
      return changed.length > 0 ? 1 : 0;
    }
    // The commands below change the contract. Each does its checks inside `updateContract`, on the contract as it
    // is read there under its lock, and prints from what was written: what `contract` above holds may be older.
    if (command === 'built') {
      const launch = (a.one('--launch') ?? '').trim();
      if (launch === '') throw new EyesError('sz-eyes contract built <id> --launch "<the command that starts it, and where it is seen>": said by whoever built it, once the product has run in front of them');
      const head = spawnSync('git', ['-C', project, 'rev-parse', 'HEAD'], { encoding: 'utf8' });
      updateContract(file, (contract) => {
        if (contract.frozenAt === null) throw new EyesError(`${id} is not frozen yet: what is built is built against a contract that no longer moves`);
        if (contract.closedAt !== null) throw new EyesError(`${id} is closed`);
        return { ...contract, built: { at: new Date().toISOString(), launch, commit: head.status === 0 ? head.stdout.trim() : null } };
      });
      out(`built: ${id}. It can be shown to the owner from now on, while it is verified: ${launch}`);
      return 0;
    }
    if (command === 'freeze') {
      // A word it does not know is not passed over: the files would be left out and the contract frozen without them.
      const stray = [...a.words.slice(1), ...[...a.flags.keys()].filter((flag) => flag !== '--frozen' && flag !== '--dir')];
      if (stray.length > 0) throw new EyesError(`not understood: ${stray.map((word) => `"${word}"`).join(', ')}. sz-eyes contract freeze <id> [--frozen <path>]...: each file is its own \`--frozen <path>\` (a list in one variable is split by bash and not by zsh)`);
      const frozen = updateContract(file, (contract) => {
        if (contract.frozenAt !== null) throw new EyesError(`${id} was frozen at ${contract.frozenAt}`);
        const frozen = [...new Set([...contract.frozen, ...a.all('--frozen')])];
        const missing = frozen.filter((path) => !existsSync(join(project, path)));
        if (missing.length > 0) throw new EyesError(`not there to freeze: ${missing.join(', ')}. Paths are relative to the project; write the flow or test first.`);
        return { ...contract, frozen, frozenPrints: fingerprints(project, frozen), frozenAt: new Date().toISOString() };
      });
      out(`frozen: ${id}. Whoever builds it does not edit ${file}${frozen.frozen.length > 0 ? ' or the files it names' : ''}.`);
      return 0;
    }
    if (command === 'dispute') {
      // A claim found false whose own words are what is wrong. Its words stay as they were agreed; it is set
      // aside for the owner with the ruling, and it no longer stops the work from being closed.
      const claimId = a.words[1];
      const saved = updateContract(file, (contract) => {
        if (contract.frozenAt === null || contract.closedAt !== null) throw new EyesError(`a dispute is recorded on a contract that is frozen and open; ${id} is ${contract.closedAt !== null ? 'closed' : 'not frozen yet'}`);
        const claim = contract.claims.find((c) => c.id === claimId);
        if (!claim) throw new EyesError(`contract ${id} has no claim "${claimId ?? ''}". Its claims: ${contract.claims.map((c) => c.id).join(', ')}`);
        if (claim.status !== 'refuted') throw new EyesError(`${id}/${claim.id} is ${claim.status}: a dispute is about a claim that was looked at and found false. Have it verified first.`);
        const ruling = (a.one('--ruling') ?? '').replace(/\s+/g, ' ').trim();
        if (ruling.length < 30) throw new EyesError('sz-eyes contract dispute <id> <claim-id> --ruling "<what the claim says, what is so, and where that is read (the address, the sentence)>" [--evidence <file>]...');
        const folder = evidenceFolder(project, id);
        const shown = a.all('--evidence').map((path) => evidencePath(project, id, path));
        for (const path of shown) if (!existsSync(join(folder, path))) throw new EyesError(`${join(folder, path)}: no such file. Evidence is a file under ${folder}, named from there`);
        return withClaim(contract, claim.id, (c) => ({ ...c, status: 'disputed', note: `약속의 문구가 사실과 다름: ${ruling}`, evidence: [...new Set([...c.evidence, ...shown])], at: new Date().toISOString() }));
      });
      const claim = saved.claims.find((c) => c.id === claimId)!;
      out(`${id}/${claim.id}: disputed. Its words are unchanged and it does not stand; it waits for the owner (sz-eyes contract judged ${id} ${claim.id} --verdict yes|no --said "<their words>": yes = the claim was wrong, no = the product must do what it says).`);
      return 0;
    }
    if (command === 'add-check') {
      // A contract frozen with its claims and without their checks: the check for a claim is written by whoever
      // verifies it, on the product as it stands, and from then on it is held like any other frozen file. Files
      // are only ever added here; what is frozen is not taken off or replaced.
      let added: string[] = [];
      const saved = updateContract(file, (contract) => {
        if (contract.frozenAt === null) throw new EyesError(`${id} is not frozen yet: freeze it first (its claims are what is agreed), then add the checks as they are written`);
        added = a.all('--frozen').filter((path) => !contract.frozen.includes(path));
        if (added.length === 0) throw new EyesError('sz-eyes contract add-check <id> --frozen <flow or test file>... (a file the contract does not hold yet)');
        const missing = added.filter((path) => !existsSync(join(project, path)));
        if (missing.length > 0) throw new EyesError(`not there to hold: ${missing.join(', ')}. Paths are relative to the project; write the flow or test first.`);
        return { ...contract, frozen: [...contract.frozen, ...added], frozenPrints: { ...contract.frozenPrints, ...fingerprints(project, added) } };
      });
      out(`held: ${added.join(', ')} (contract ${id} now holds ${saved.frozen.length} file(s))`);
      return 0;
    }
    if (command === 'claim') {
      // A closed contract is the record of what was shown then. What is found of it later is a look at a
      // standing claim, written where it cannot quietly take a promise off the list.
      const claimId = a.words[1];
      const saved = updateContract(file, (contract) => {
        if (contract.closedAt !== null) throw new EyesError(`contract ${id} is closed: its verdicts are the record of what was shown then. What is found now is recorded with \`sz-eyes standing record ${id}/<claim> --status holds|broken|unchecked\`; the owner's own verdict on a claim left for them, with \`sz-eyes contract judged ${id} <claim> --verdict yes|no --said "<their words>"\`.`);
        const claim = contract.claims.find((c) => c.id === claimId);
        if (!claim) throw new EyesError(`contract ${id} has no claim "${claimId ?? ''}". Its claims: ${contract.claims.map((c) => c.id).join(', ')}`);
        const status = ClaimStatus.parse(a.one('--status'));
        const folder = evidenceFolder(project, id);
        const shown = a.all('--evidence').map((path) => evidencePath(project, id, path));
        for (const path of shown) if (!existsSync(join(folder, path))) throw new EyesError(`${join(folder, path)}: no such file. Evidence is a file under ${folder}, named from there (look/home.png)`);
        // A claim is not called proven on someone's word: there is something to look at, or a command that said so.
        if (status === 'proven' && shown.length === 0 && !a.one('--note')) throw new EyesError('a claim is proven by something that shows it: give --evidence (a picture, a film, a log under the evidence folder) or a --note that says what was run and what it said');
        return withClaim(contract, claim.id, (c) => ({ ...c, status, evidence: [...new Set([...c.evidence, ...shown])], note: a.one('--note') ?? c.note, at: new Date().toISOString() }));
      });
      out(`${claimId}: ${saved.claims.find((c) => c.id === claimId)!.status}`);
      return 0;
    }
    if (command === 'judged') {
      // What only the owner can say is said by the owner, usually after the work is closed and in a few words.
      // Their words are the evidence. Nobody else's verdict is taken this way: a claim a machine can show is shown.
      const claimId = a.words[1];
      const verdict = a.one('--verdict');
      const said = (a.one('--said') ?? '').replace(/\s+/g, ' ').trim();
      const at = new Date();
      const day = localDay(at.toISOString());
      // Whether the claim was disputed when it was judged, as the contract was read under its lock.
      const was = { disputed: false };
      const saved = updateContract(file, (contract) => {
        const claim = contract.claims.find((c) => c.id === claimId);
        if (!claim) throw new EyesError(`contract ${id} has no claim "${claimId ?? ''}". Its claims: ${contract.claims.map((c) => c.id).join(', ')}`);
        const disputed = claim.status === 'disputed';
        if (claim.shownBy.kind !== 'owner' && !disputed) throw new EyesError(`${id}/${claim.id} is shown by ${claim.shownBy.kind}, not left for the owner to judge: it is shown by running it (${claim.shownBy.ref})`);
        if (contract.frozenAt === null) throw new EyesError(`contract ${id} is not agreed yet (not frozen): there is nothing built to judge`);
        if ((verdict !== 'yes' && verdict !== 'no') || said === '') throw new EyesError('sz-eyes contract judged <id> <claim-id> --verdict yes|no --said "<the owner\'s words, as they said them>"');
        if (contract.closedAt !== null) needLedger(project);
        was.disputed = disputed;
        // Disputed, yes: the claim's words were wrong; it is retired as it stands, with their word on it. No: the
        // product is to do what the claim says, so it is false again and goes to the list of what is left.
        return withClaim(contract, claim.id, (c) =>
          disputed
            ? { ...c, status: verdict === 'yes' ? 'disputed' : 'refuted', note: `${c.note} / 주인이 정함 (${day}): "${said}"`, at: at.toISOString() }
            : { ...c, status: verdict === 'yes' ? 'proven' : 'refuted', note: `주인이 봄 (${day}): "${said}"`, at: at.toISOString() },
        );
      });
      const claim = saved.claims.find((c) => c.id === claimId)!;
      const key = `${id}/${claim.id}`;
      if (was.disputed) {
        const done: string[] = [];
        try {
          doneInBacklog(project, `주인이 정할 것: ${claim.says.replace(/\s+/g, ' ').trim()}`, `주인의 판단 ${day}: "${said}"`);
          done.push(`its line in ${BACKLOG_FILE} is ticked`);
        } catch {
          // No line yet (the contract is still open), or the owner edited it by hand.
        }
        if (verdict === 'no' && addToBacklog(project, [{ text: `주인이 약속대로 하라고 함: ${claim.says}: "${said}"`, from: `계약 ${id}` }]) > 0) done.push(`what they said is written to ${BACKLOG_FILE}`);
        out(`${key}: ${verdict === 'yes' ? 'the owner agrees the claim was wrong; it is retired' : 'the owner wants it as written; it is false again and the product has to change'}${done.length > 0 ? ` (${done.join('; ')})` : ''}`);
        return 0;
      }
      const did: string[] = [];
      if (saved.closedAt !== null) {
        // Closing wrote a line for it in the list of what is left; their verdict ends that line.
        try {
          doneInBacklog(project, `주인이 볼 것: ${claim.says.replace(/\s+/g, ' ').trim()}`, `주인의 판단 ${day}: "${said}"`);
          did.push(`its line in ${BACKLOG_FILE} is ticked`);
        } catch {
          // The owner may have edited or removed the line by hand: the contract is the record.
        }
        if (verdict === 'yes') {
          recordShown(project, key, { status: 'holds', note: `주인이 봄: "${said}"`, during: null, at: at.toISOString() });
          did.push('it stands from here');
        } else if (addToBacklog(project, [{ text: `주인이 보고 아니라고 함: ${claim.says}: "${said}"`, from: `계약 ${id}` }]) > 0) did.push(`what they said is written to ${BACKLOG_FILE}`);
      }
      out(`${key}: ${verdict === 'yes' ? 'proven' : 'refuted'} by the owner${did.length > 0 ? ` (${did.join('; ')})` : ''}`);
      return 0;
    }
    if (command === 'amend') {
      const target = a.one('--file');
      const why = a.one('--why') ?? '';
      if (!target || why.trim().length < 12) throw new EyesError('sz-eyes contract amend <id> --file <a frozen file> --why "<what was wrong about how it checked, and what was changed>"');
      updateContract(file, (contract) => {
        if (!contract.frozen.includes(target)) throw new EyesError(`${target} is not a file contract ${id} froze. Frozen: ${contract.frozen.join(', ') || '(none)'}`);
        // The file as the arbiter left it is what the contract is now proven against.
        return { ...contract, frozenPrints: { ...contract.frozenPrints, [target]: fingerprint(project, target) }, amendments: [...contract.amendments, { file: target, why: why.trim(), at: new Date().toISOString() }] };
      });
      out(`amended: ${target}`);
      return 0;
    }
    if (command === 'supersede') {
      const saved = updateContract(file, (contract) => {
        if (contract.closedAt !== null) throw new EyesError(`${id} is closed: a closed contract replaces nothing more`);
        const replaced = supersedeOf(project, a.words[1] ?? '', a.one('--why') ?? '');
        if (replaced.contract === id) throw new EyesError('a contract does not replace its own claim');
        return { ...contract, supersedes: [...contract.supersedes, replaced] };
      });
      const replaced = saved.supersedes.at(-1)!;
      out(`${replaced.contract}/${replaced.claim} no longer stands: replaced by ${id}`);
      return 0;
    }
    if (command === 'notice') {
      const text = a.words.slice(1).join(' ').trim();
      if (text === '') throw new EyesError('sz-eyes contract notice <id> "<what was noticed>" [--evidence <file>]');
      const folder = evidenceFolder(project, id);
      const shown = a.all('--evidence').map((path) => evidencePath(project, id, path));
      for (const path of shown) if (!existsSync(join(folder, path))) throw new EyesError(`${join(folder, path)}: no such file. Evidence is a file under ${folder}, named from there (look/home.png)`);
      updateContract(file, (contract) => ({ ...contract, noticed: [...contract.noticed, { text, evidence: shown }] }));
      out('noted');
      return 0;
    }
    if (command === 'close') {
      const accepted = (a.one('--accepted') ?? '').trim();
      // The record of what stands is stamped inside the contract's lock (the contract's, then the record's,
      // never the other way round), so that nobody comes between "closed" and "its promises start to stand".
      const closed = updateContract(file, (contract) => {
        if (contract.closedAt !== null) throw new EyesError(`contract ${id} was closed at ${contract.closedAt}`);
        needLedger(project);
        const owes = owed(contract);
        if (owes.length > 0) throw new EyesError(`contract ${id} still owes:\n${owes.map((line) => `  - ${line}`).join('\n')}`);
        const also = alsoOwed(project, contract);
        if (also.length > 0) throw new EyesError(`contract ${id} is not closed yet:\n${also.map((line) => `  - ${line}`).join('\n')}\nWhat stood before and broke: fix the product so it holds again (then \`sz-eyes standing record <key> --status holds\`), or, if what was asked has changed, the arbiter records which claim this work replaces.`);
        const gap = notLookedAt(contract);
        if (gap.most && accepted === '') {
          throw new EyesError(
            `contract ${id} was not looked at: ${gap.unseen.length} of its ${gap.of} claims are unchecked:\n${gap.unseen.map((claim) => `  - ${claim.id}: ${claim.note ?? 'no note'}`).join('\n')}\nA contract does not close on claims nobody looked at, and nothing is built on top of it. Get the product running and have them shown: what stops it from starting is the builder's to fix. If what stops it is outside the product (a download that does not arrive, a key, a device), tell the owner what it is and ask. Only when the owner says to close it as it is: --accepted "<their words>".`,
          );
        }
        const at = new Date().toISOString();
        const closed = { ...contract, closedAt: at, ...(gap.most ? { noticed: [...contract.noticed, { text: `closed with ${gap.unseen.length} of ${gap.of} claims not looked at, on the owner's word: "${accepted}"`, evidence: [] }] } : {}) };
        // Its proven claims are stamped first: a contract is never left closed with nothing to say when its
        // claims last held. From here they stand, and what it left is written where the next work is picked from.
        stampClosed(project, closed, at);
        return closed;
      });
      const left = addToBacklog(project, leftBy(closed));
      out(`closed: ${id}${left > 0 ? ` (${left} line(s) added to ${BACKLOG_FILE})` : ''}`);
      return 0;
    }
  }
  process.stderr.write(`sz-eyes: unknown command: ${argv.join(' ')}\n\n${USAGE}`);
  return 2;
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err: unknown) => {
    process.stderr.write(`sz-eyes: ${err instanceof Error ? err.message : String(err)}\n`);
    // 3: the session's command sandbox stopped it, which says nothing about the product. A flow can tell it apart.
    process.exit(err instanceof SandboxError ? 3 : err instanceof EyesError ? 1 : 2);
  },
);
