export const meta = {
  name: 'build',
  description: 'Build a product, or grow one that exists, to the end, unattended: for a new product with screens, first every screen planned, drawn as one clickable prototype, measured, and put before the owner, whose word it waits for; then a spec (new, or the existing one extended), then for each milestone a frozen contract, the build, a verification by an agent that did not build it which also shows again what stood before, fixes, and a page of evidence. Milestones follow one another unless the plan puts some side by side: those are built at the same time in folders of their own, brought together, and everything that stands is shown again on the product as joined',
  whenToUse: 'A new product, or a change of several features to a product that already has a spec (lane L), after the owner has been put the questions only they can answer (a few, each a choice they can tap) and has asked for it to run to the end without them. Typing the command is not an answer to those questions: ask first, then start it with asked and answers (args is an object: { request, asked, answers, design? }). A new product with screens is drawn before anything of it is built: the first run plans and draws every screen, measures them, and stops with the prototype. Open .sz/design/prototype.html for the owner, record what they say in their words (sz-eyes contract judged design feel --verdict yes|no --said "<their words>"), and start the workflow again: on yes it builds the first pass to the drawing, on no it draws again what they said. Only design: "go" in args takes a run from the measured prototype straight into building without their word, and only the owner can ask for it (a prototype waits fifteen minutes; a build nobody wanted costs two hours). For a new product, right after starting the run that builds its first pass (after their yes, with design: "go", or for a product with no screens), start in the background a wait for its builder to say it stands (until sz-eyes contract built > /dev/null 2>&1; do sleep 20; done; sz-eyes contract built: it prints the contract and how the product is started, about an hour in; nothing else answers before the first pass is closed, hours later). When that returns, make a copy of the product (sz-eyes copy <a folder outside the project> --with <what .sz/map.md says is built and not in git>), start the copy the way that line says and tell the owner its address, and that it is still being verified: they see the whole product then, not when everything is finished. facts: "auto" (default) reads once what an authority publishes that the product needs, and later runs use the page it left (for 30 days, or until a request needs a criterion the page lacks); "on" has the publishers read again whatever the page says; "off" skips it. redteam: "plan" | "close" | "both" adds a review in a new conversation before building a plan or closing a milestone (5 to 10 minutes a milestone); a fatal finding at the close is mended once, every claim shown again and the finding looked at again, and only what still holds stops the run. Another model is used only when redteamModel names one distinct from the original. While it runs it says where it is (the look begun and back with its figures, each fix, each ruling) in lines the owner sees in the workflow view; you are woken only when it ends, so keep a background wait on its journal and tell the owner in one line when a stage ends (sz:work has the command). Where it stops with a claim still shown false, that contract stays open and the stop names the three ways on (start again; have the claim\'s own words ruled wrong; close it as it is on the owner\'s own words, --accepted): put those to the owner as it names them. A line in the backlog closes no contract, so do not offer one.',
  phases: [
    { title: 'Plan', detail: 'the spec and its milestones, each with the claims that make it done' },
    { title: 'Design', detail: 'for a new product with screens: every screen planned, drawn as one prototype and measured, then put before the owner before anything is built' },
    { title: 'Build', detail: 'a milestone, or several side by side in folders of their own: contract, oracle, code' },
    { title: 'Verify', detail: 'each claim shown on the running product by an agent that did not build it; what was built side by side is shown again once joined' },
    { title: 'Close', detail: 'evidence page, progress line, commit' },
  ],
}

// args: { request: string, asked: 'owner' | 'away', answers?: string, design?: 'go', maxMilestones?: number, side?: 1|2|3, effort?: string | object, model?: string | object, facts?: "auto"|"on"|"off", redteam?: "off"|"plan"|"close"|"both", redteamModel?: string }
// `request` is the owner's words. `asked` says whether the owner was put the questions only they can answer
// before this run: 'owner' = they were, and `answers` holds what they chose, word for word; 'away' = they said to
// go on without questions, or nobody is in the session. The run asks nobody anything, and it does not start
// until it is told which. (In the owner's first run a session skipped the questions, passed answers it had
// written itself, and the owner found out from the spec: "뭐야 질문 다섯개가 어디있었어요".)
// `design: 'go'`: a new product's measured prototype goes straight into planning and building its first pass,
// without the owner's verdict on it (their claim on how it feels stays theirs, as owner claims do). Without it a
// run stops at the prototype, the owner away or not: a prototype waits fifteen minutes, a build nobody wanted
// costs two hours. Only the owner can ask for it.
// `answers` is also where the owner's word that something may be an example for now, or wait for later, comes in
// (what is real, below): the run finds those words there, or in the request, and nowhere else.
const request = args && typeof args.request === 'string' ? args.request.trim() : ''
const answers = args && typeof args.answers === 'string' ? args.answers.trim() : ''
const asked = args && (args.asked === 'owner' || args.asked === 'away') ? args.asked : ''
const designGo = Boolean(args && args.design === 'go')
const maxMilestones = args && Number.isInteger(args.maxMilestones) ? args.maxMilestones : 6
if (request === '') return { error: 'give args: { request: "<what to build, in the owner\'s words>", asked: "owner" | "away", answers?: "<what the owner chose, word for word>" }' }
if (asked === '') return { error: 'not started: say whether the owner was asked. Before this runs, put to the owner what only they can answer, as the sz:work skill says: a few questions, each a choice they can tap (the AskUserQuestion tool). Then start again with asked: "owner" and what they chose, word for word, in answers. Only if they said to go on without questions, or nobody is in the session to answer: asked: "away".' }
if (asked === 'owner' && answers === '') return { error: 'asked: "owner" needs answers: what the owner chose, word for word' }

const TOOLS = 'The command `sz-eyes` is on your PATH (the sz plugin\'s). Load the skills you need with the Skill tool: `sz:work` (how work is sized, contracted and closed), `sz:verify` (how a product is launched, looked at and operated, and what counts as evidence), `sz:taste` (how a screen is put together, for anything a person looks at in a product made here), `sz:backend` (what a product stands on: where it runs for people, what holds its accounts and its data, and what that must prove), `sz:ship` (what a product needs before it can be put where people reach it), `sz:game` (when the product is a game or moves by itself: how it is built to be asked what it is doing, and proven with its time held), `sz:trial` (whether a person would pay: stand-ins for the people it is for use it the whole way), `sz:worth` (the case for the service: who it is for, what they use instead, and the rows of the whole job that say how deep it has to be).'
// Whether the session runs its commands inside a sandbox is found out once, when the work is planned, and every
// agent after that is told so from its first line. (In the first run under a sandbox each agent found it out
// for itself, by having a browser refused: sixteen lost tries among ten agents.)
const IN_SANDBOX = ' This session runs its commands inside a sandbox, where nothing that opens a browser, a desktop app, a simulator or Docker can start. Run those outside it from the first try (`dangerouslyDisableSandbox: true` on the Bash call): every `sz-eyes web`, `sz-eyes electron`, `sz-eyes ios`, `sz-eyes docker` and `sz-eyes supabase` command, `sz-eyes login relay start`, `sz-eyes image make`, `sz-eyes image use` with `--size`, and the project\'s own flows and tests that open a browser. So is ending or listing a process that an earlier command started (`kill`, `ps`): inside, the sandbox refuses it. Everything else stays inside. If such a call is refused, do not judge the product by reading its code instead: say in what you return that the sandbox stopped the look.'
const MAYBE_SANDBOX = ' If `sz-eyes` says the session\'s command sandbox stopped it, run every command that opens a browser, a desktop app, a simulator or Docker outside the sandbox from the first try (`dangerouslyDisableSandbox: true` on the Bash call; the `sz:verify` skill says which), and likewise ending or listing a process that an earlier command started (`kill`, `ps`). If that call is refused, do not judge the product by reading its code instead: say in what you return that the sandbox stopped the look.'
const HOST_SANDBOX = typeof hostSandbox === 'undefined' ? null : hostSandbox
const AFTER_SANDBOX_STOP = HOST_SANDBOX ? HOST_SANDBOX.stop : 'The owner chooses one: run sessions in auto mode, approve the unsandboxed command when asked, or turn the sandbox off for this project (/sandbox); then ask to continue.'
const observationRefusal = (reason) => HOST_SANDBOX
  ? reason.trim().slice(0, 300)
  : `the session's command sandbox stopped the browser and the call outside it was refused (${reason.trim().slice(0, 200)})`
let SAND = HOST_SANDBOX ? HOST_SANDBOX.instructions : MAYBE_SANDBOX
// How many simulators this machine holds at once, as whoever planned read it from the eyes: one until that is known.
let SIMS = 1
// How many whole gigabytes are free on the disk the project is on, as whoever planned, or closed the milestone
// before, read it from the eyes. Not known until one of them says, and then nothing is judged by it.
let ROOM = null
const learn = (plan) => {
  if (!HOST_SANDBOX && plan.sandboxed === true) SAND = IN_SANDBOX
  if (Number.isInteger(plan.simulators) && plan.simulators > 0) SIMS = plan.simulators
  if (typeof plan.room === 'number' && plan.room >= 0) ROOM = plan.room
}
const GROUND = 'You are working in the project\'s folder. Read `.sz/map.md` first (if there is none, load `sz:onboard` and write it), then `.sz/spec.md`, `.sz/owner.md` (what the owner has said they want of this product: it comes before your own taste) and the last lines of `.sz/progress.md` if they exist. Follow the project\'s own rules as the map lists them. Other work of the owner\'s runs on this machine. Never use their simulator, browser profile or dev-server ports: a headless browser, the eyes\' own simulator, and for anything you launch a port taken from the machine (`PORT=$(sz-eyes port)`), never a number you chose (a product that cannot be told its port is started on the one the map names, only when nothing listens there, and you say so). Before you look at what you launched, make sure it is yours that answers (your process is alive and the page is this product). End every server you start, by the process id you kept (`pid=$!` ... `kill $pid`): never by its port and never by its name, because what holds a port you wanted is somebody else\'s.'

// How hard each kind of agent thinks. Most of a milestone's time is its builder thinking: on the same milestone
// a builder at the highest setting took 21 to 23 minutes and one at "high" 11, for the same verdicts, whichever
// model it was (three runs, 2026-11-16, docs/runs/2026-11-16-speed). The owner chose, that day: the plan and the
// verification think as hard as the session (a wrong plan costs everything after it, and verification is the
// last door); building and fixing at "high"; closing, staging and joining, which are mechanical, at "low".
// A new product's design stage goes by the same words: its screens are planned as the plan is, the board, the
// drawing and its mending are made as a build is, and measuring the prototype is mechanical, with the closing.
// args.effort overrides: one word for the builders, or { plan, build, verify, close, join } each a word
// ("session" for as hard as the session).
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max']
const DEFAULT_EFFORT = { build: 'high', close: 'low', join: 'low' }
// The four stages that run at low effort (the prototype's sweep, the close, bringing milestones together, making
// their folders) each do a list of steps with nobody watching, and a step left out of a close is a milestone that
// stands uncommitted under the next one. Claude Fable 5.2, the model of the owner's sessions, ends a turn before
// the work is done more often at low effort (a list of what remains, a stop at an ordinary obstacle), and
// Anthropic's guidance for it is to say this in the prompt of agentic work at low or medium effort; its figure is
// about 30% more output tokens, here on stages of a minute. This rests on that guidance, not on a measurement:
// no run record shows a closer leaving a step out, and all of them were on Opus. Whoever builds or mends runs at
// high and is not given it: a builder that returns early costs a fix round, not a wrong close, and its own steps
// say when to stop waiting on what will not arrive.
const FINISH = ' Do every step you were given before you return: nobody is watching to say "go on", and a step left out is found later by someone else, or not at all. An ordinary obstacle (a command that times out, a file that is locked, an answer that comes back empty) is looked into and worked through: wait and try again, mend the call, or take another way. What was decided as a stop is not worked past (a command the plugin refuses, a call outside the sandbox that is refused, a merge that conflicts, a contract that will not close): say what you found in what you return. This lifts none of the limits above on what you may change or run.'
const effort = (stage) => {
  const said = args && args.effort
  const word = typeof said === 'string' ? (stage === 'build' ? said : undefined) : said && typeof said === 'object' ? said[stage] : undefined
  if (word === 'session') return {}
  const chosen = EFFORTS.includes(word) ? word : DEFAULT_EFFORT[stage]
  return chosen ? { effort: chosen } : {}
}
// Which model each kind of agent runs on. Unsaid, an agent runs on the session's model. The verifier and the
// arbiter run on the one their own definitions name, whatever the session is, and nothing here moves them:
// verification is the last door, and it is what lets another model build. args.model overrides: one word
// ("sonnet" or "opus") for those who build and mend a milestone, or { plan, design, build } each a word: "plan"
// is the plan and the screens' plan, "design" the board, the drawing and its mending. (2026-11-17: a first pass
// built and mended by Sonnet under an Opus verifier had every flow and rule proven at the first look, as many
// claims refuted as Opus builders have had, and 11 of its 32 screens unlike the drawing; a product of another
// kind built by Opus that night had 5 of 42. Two different products, so the default stays the session's model
// until one product has been built both ways.)
const MODELS = ['sonnet', 'opus']
const model = (stage) => {
  const said = args && args.model
  const word = typeof said === 'string' ? (stage === 'build' ? said : undefined) : said && typeof said === 'object' ? said[stage] : undefined
  return MODELS.includes(word) ? { model: word } : {}
}
// Agents started together, each answering in its own time; one that fails answers null and the others go on.
const beside = typeof parallel === 'function' ? parallel : (thunks) => Promise.all(thunks.map((thunk) => thunk().catch(() => null)))

// What is real, and who may say that something is not. (A product meant to set each item of a photographed dental
// estimate against the neighbourhood's published prices was planned with the prices as examples, "not connected
// yet", and the session preparing its build wrote, on its own and without looking, that reading the photograph was
// not connected either: its one thing would have run on made-up figures from a photograph nobody read, every claim
// proven. Ten minutes of looking found the prices published for every clinic in the country as an open API for a
// free key, and reading the photograph needing a model key of the owner's. Nobody had asked the owner for either.)
// The list of what is not real is structure, checked here before any builder starts: an entry on the one thing's
// path, one the owner's request names, or one put off as later stands only on the owner's own words, found in
// their request or their answers; otherwise nothing is built, and the run says what is needed and how it is given.
// (Written only in a skill, three rules were skipped by a session in one week.)
const REASONS = ['owner', 'people', 'device', 'later']
const REAL = `On the path of the one thing the product is for (what a person gives it, what is done with it, what they get back), everything is real, or nothing is built. Look before anything is called not real: a public source, an open API, a free way (a key the owner applies for at no cost is one), and whether a key is at hand already: the services a product's server can take with a key of the owner's are the arms (\`sz-eyes arm list\`), and \`sz-eyes arm need <name>\` says whether an arm's keys are in the vault, with the owner's steps when they are not (for a key that is no arm's, \`sz-eyes secret has <vault id>\`). "Not connected yet" and "nobody has read it yet" are not reasons: finding the source and reading it is the work. Anything else may be not real yet for one of four reasons only: "owner" (a key, an account, money or publishing that only the owner can give), "people" (others who are not there yet: partners, reviews, the other side of a market), "device" (a device, a store's review or a machine this Mac does not have), "later" (the owner said later). Each entry says what was tried (where it was looked for: the address, what \`sz-eyes secret has\` said) and what it needs to be real, from whom (for a key, the vault id it is to be kept under: lower-case words joined by slashes, like data/<the source>/api-key; never a command that stores it, which you would get wrong: \`sz-eyes arm need\` and \`sz-eyes secret has\` print that line whole, for the owner's own terminal). Three are never on the list without the owner's own words, quoted under "said" from the request or the answers above: what is on the one thing's path, what the owner's request names, and what is put off as later. What is built for real and only waits for people to use it (an empty list with its plain line) is real, and not on the list. This is about what is real, not how much is built: nothing is left out of a pass to keep it off the list.`
const NOT_REAL = {
  type: 'array',
  description: 'what is left not real yet, an entry each, by the rule on what is real; empty when all of it is real',
  items: {
    type: 'object',
    properties: {
      what: { type: 'string', description: 'what is not real yet, as a person would meet it' },
      reason: { type: 'string', enum: REASONS },
      tried: { type: 'string', description: 'never empty: where it was looked for and what was found (the address of the source or the page, what `sz-eyes secret has <id>` said)' },
      needs: { type: 'string', description: 'what it needs to be real, and from whom' },
      vault: { type: 'string', description: 'for a key: the vault id it is to be kept under, lower-case words joined by slashes' },
      arm: { type: 'string', description: 'when it waits for a key of an arm (`sz-eyes arm list`): the arm\'s name, as that list gives it' },
      onPath: { type: 'boolean', description: 'true when it is on the path of the one thing: what a person gives the product for it, what is done with it, what they get back' },
      named: { type: 'boolean', description: 'true when the owner\'s request, or what they answered, names it' },
      said: { type: 'string', description: 'only where the owner allowed it to be an example for now, or said it is for later: their words, quoted word for word from the request or the answers' },
    },
    required: ['what', 'reason', 'tried', 'needs', 'onPath', 'named'],
  },
}
const VAULT_ID = /^[a-z0-9]+(\/[a-z0-9-]+){1,3}$/
const plainWords = (text) => String(text || '').normalize('NFC').replace(/["'“”‘’「」『』]/g, '').replace(/\s+/g, ' ').trim()
// The owner's own words: their request, and what they answered when asked. The session's notes are not theirs.
const OWNERS_WORDS = [request, asked === 'owner' ? answers : ''].map(plainWords).filter(Boolean)
const ownerSaid = (said) => plainWords(said) !== '' && OWNERS_WORDS.some((theirs) => theirs.includes(plainWords(said)))
const notRealOf = (holder) => (holder && Array.isArray(holder.notReal) ? holder.notReal : []).filter((e) => e && typeof e === 'object')
// Why an entry of the list cannot stand without the owner, or null when it may.
const waitsFor = (e) => {
  if (ownerSaid(e.said)) return null
  const theirs = plainWords(e.said) !== '' ? ` (the words given as theirs, "${plainWords(e.said)}", are not in their request or their answers)` : ''
  if (e.onPath === true) return `it is on the path of the one thing the product is for${theirs}`
  if (e.named === true) return `the owner's request names it${theirs}`
  if (e.reason === 'later') return `it is put off as later, which only the owner says${theirs}`
  if (!REASONS.includes(e.reason) || plainWords(e.tried) === '') return 'it is listed without looking: none of the four reasons, or nothing said of where it was looked for'
  return null
}
// A key is given by the owner in their own terminal, with a line only the tool can print: `sz-eyes` is not on the
// PATH of the owner's shell, and this script does not know where the tool is. (In the first run that stopped for
// keys the stop carried `pbpaste | sz-eyes secret set ...`, which answers "command not found" there.) So the stop
// names the command the session runs to get that line. A vault id that is not one is never put in a command.
const keyLine = (e) => (e.vault && VAULT_ID.test(String(e.vault)) ? `sz-eyes secret has ${e.vault}` : '')
// Where the key is an arm's, the arm's own guide is what the owner is shown: where to get the key, step by step, and the line that stores it.
const armLine = (e) => (e.arm && /^[a-z][a-z0-9-]{0,40}$/.test(String(e.arm)) ? `sz-eyes arm need ${e.arm}` : '')
const asNeed = (e, why, milestone) => ({ milestone, what: String(e.what || ''), why: why || '', needs: String(e.needs || ''), give: keyLine(e), steps: armLine(e), tried: String(e.tried || ''), ...(e.vault && !keyLine(e) ? { badVault: String(e.vault) } : {}) })
const needLine = (n) => `${n.what}: ${n.why ? `${n.why}. It needs: ` : ''}${n.needs || '(what it needs was not said)'}${n.steps ? `; run \`${n.steps}\` and put what it prints to the owner as it stands (where they get the key, step by step, and the line that stores it)` : n.give ? `; the owner puts the key in the vault themselves, in their own terminal: run \`${n.give}\` and put the line it prints to the owner as it stands` :n.badVault ? `; "${n.badVault}" is not a vault id (lower-case words joined by slashes), so no command is given for it` : ''}${n.tried ? `. Looked for: ${n.tried}` : ''}`
const ASK = 'Put each to the owner: they give it, or say in their words that it may be an example for now (or wait for later). Then start this workflow again with asked: "owner" and their words, word for word, in answers.'
// What the owner is asked for in this run, as the return gives it to the session.
const needed = []
// Before any builder starts: returns why the run stops, or null when every entry of the milestones' lists may stand.
const holdFor = (ms, head) => {
  const open = ms.filter((m) => m.state !== 'closed')
  const owed = open.flatMap((m) => notRealOf(m).map((e) => ({ e, m, why: waitsFor(e) }))).filter((x) => x.why).map(({ e, m, why }) => asNeed(e, why, m.id))
  if (owed.length === 0) {
    for (const m of open) {
      const list = notRealOf(m)
      if (list.length > 0) log(`not real yet in "${m.title}": ${list.map((e) => `${e.what} (${e.reason}${ownerSaid(e.said) ? `; the owner: "${plainWords(e.said)}"` : ''})`).join('; ')}`)
    }
    return null
  }
  needed.push(...owed)
  const unlooked = owed.some((n) => n.why.startsWith('it is listed without looking'))
  return `${head}: ${owed.map((n) => `[${needLine(n)}]`).join(' ')} ${ASK}${unlooked ? ' What was listed without looking is looked for when it starts again.' : ''}`
}
// The list as it stands is handed to whoever builds, who adds nothing to it.
const UNREAL = (m) => {
  const list = notRealOf(m)
  const shown = list.length === 0
    ? 'Nothing in this milestone is listed as not real: all of it is real.'
    : `What is not real yet in this milestone, as the plan lists it (what | why | what it needs | the owner's words, where they allowed it):\n${list.map((e) => `- ${e.what} | ${e.reason} | ${e.needs || ''}${ownerSaid(e.said) ? ` | the owner allowed it for now: "${plainWords(e.said)}"` : ''}`).join('\n')}\nEach says so in one plain line on its screen, and the spec names it.`
  return `${shown} Whoever builds adds nothing to this list. If you find that something cannot be made real with what is at hand (a key that is not in the vault, a source that does not answer), do not put an example and a line on the screen in its place: stop, commit what you built, and return it under "notReal", with where you looked and what it needs. The run stops there and the owner is asked for it.`
}
// Whoever verifies takes the one thing's claim from a real input to a real result.
const REAL_LOOK = (m) => {
  const allowed = notRealOf(m).filter((e) => e.onPath === true && ownerSaid(e.said))
  return ` The claim of the one thing the product is for (the spec names it) is shown from a real input to a real result: what a person would really give it, through what the product really does with it, to what it really gives back. Shown on an example, a fixture or figures the product made up, it is refuted, whatever the screen says about itself${allowed.length > 0 ? `, except what the owner allowed to be an example for now: ${allowed.map((e) => `${e.what} ("${plainWords(e.said)}")`).join('; ')}` : ''}.`
}

// What `sz-eyes contract new` takes: a claim of 400 characters, a line of what is not done or of risk of 300. A
// plan that writes more cannot be recorded as it stands. (2026-11-19: a plan wrote claims of up to 829 characters
// for a phone milestone; its builder recorded them in parts under ids of its own making and said so under
// "blocked", and the run stopped as not built, an hour's build standing and nothing verified.)
const CLAIM_MOST = 400
const LINE_MOST = 300
const CLAIM = {
  type: 'object',
  properties: {
    id: { type: 'string', description: 'a short lowercase word with digits and dashes, unique in the milestone' },
    says: { type: 'string', maxLength: CLAIM_MOST, description: `what will be true of the running product, as the owner would say it and could see it, with the figure where there is one. One thing, shown by one check, in ${CLAIM_MOST} characters at most: the contract takes no more. What needs more words is more than one claim: cut it into claims with an id and a check each` },
    kind: { type: 'string', enum: ['flow', 'test', 'look', 'command', 'owner'] },
    ref: { type: 'string', description: 'how it is shown: the flow or test file that will exist, the screen and state to look at, the command' },
  },
  required: ['id', 'says', 'kind', 'ref'],
}
const PLAN = {
  type: 'object',
  properties: {
    mode: { type: 'string', enum: ['new', 'continue', 'extend'], description: 'new: there was no spec. continue: an earlier run stopped before finishing what the spec has. extend: the request asks for more than the spec had, and the spec was amended' },
    summary: { type: 'string', description: 'two or three sentences: what the product is, for whom, and the shape you chose (when extending: what is added or changed)' },
    sandboxed: { type: 'boolean', description: 'what `sz-eyes sandbox` said when run as an ordinary command: true when it said "sandboxed"' },
    eyesDown: { type: 'string', maxLength: 600, description: 'only when `sz-eyes` itself does not run on this machine (the shell does not find it, or it ends at once saying its copy has no dependencies or a module is missing): what it printed, as it stands. The run then starts nothing' },
    simulators: { type: 'integer', description: 'only for a product with a part on a phone: the number on the first line of what `sz-eyes ios room` printed (how many simulators this machine holds at once)' },
    room: { type: 'number', description: 'the number on the first line of what `sz-eyes room` printed: whole gigabytes free on the disk the project is on' },
    design: { type: 'string', enum: ['none', 'needed', 'waiting', 'again', 'approved'], description: 'where the design of a new product with screens stands, as the top of your instructions says how to find out; "none" for anything else' },
    said: { type: 'string', description: 'only when design is "again": what the owner said about the prototype, in their words, as the claim feel of contract design records them' },
    decided: { type: 'array', items: { type: 'string' }, description: 'what the request and the answers left open and how you decided it' },
    later: {
      type: 'array',
      description: 'only while the product\'s first pass is not closed: what comes after it, a line each, in the order it should be done (depth where the product earns its keep, then the other areas, then what makes it safe to give to people). No claims: these are planned when the first pass stands.',
      items: { type: 'object', properties: { title: { type: 'string' }, what: { type: 'string', description: 'one or two sentences: what a person will have then that the first pass does not give them' } }, required: ['title', 'what'] },
    },
    milestones: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'a short lowercase word with digits and dashes' },
          title: { type: 'string' },
          builds: { type: 'string', description: 'what is built in it, in two or three sentences' },
          claims: { type: 'array', items: CLAIM },
          notReal: NOT_REAL,
          notDoing: { type: 'array', items: { type: 'string', maxLength: LINE_MOST } },
          risks: { type: 'array', items: { type: 'string', maxLength: LINE_MOST } },
          supersedes: {
            type: 'array',
            description: 'standing claims of earlier, closed contracts (as `sz-eyes standing` lists them) that will stop being true because what was asked has changed. Empty for a new product, and for a milestone that only adds.',
            items: { type: 'object', properties: { contract: { type: 'string' }, claim: { type: 'string' }, why: { type: 'string', description: 'what the owner asked that changes it, in their language' } }, required: ['contract', 'claim', 'why'] },
          },
          after: { type: 'array', items: { type: 'string' }, description: 'ids of the milestones that must be closed before this one starts. Leave it out for a line (each after the one before it). Two milestones with the same "after" are built side by side.' },
          alone: { type: 'boolean', description: 'true when nothing may be built beside it: it changes the shape of what is stored, or accounts and who may do what, or what every other milestone stands on' },
          touches: { type: 'array', items: { type: 'string' }, description: 'for a milestone built beside others: the screens, routes, stored tables and files it will change' },
          where: { type: 'string', description: 'only for a milestone that is built: the folder under .sz/trees/ it was built in, when an earlier run built it beside others and stopped before bringing them together' },
          first: { type: 'boolean', description: 'true for the product\'s first pass while it is not closed: the one milestone of a new product, or, when an earlier run stopped before it closed, that same milestone again' },
          state: { type: 'string', enum: ['todo', 'built', 'closed'], description: 'todo unless this run continues an earlier one: built = its code and frozen contract exist and it has not been verified to the end; closed = its contract is closed' },
          contractId: { type: 'string', description: 'for a milestone that is built or closed: the id of its contract' },
          launch: { type: 'string', description: 'for a milestone that is built, when you know it: the exact command that starts the product and where it is seen. Leave it out otherwise: the run reads it from the contract' },
          disputes: { type: 'array', description: 'for a milestone that is built: frozen checks an earlier run found to be wrong about how they check and nobody has corrected since (not those the contract lists as corrected)', items: { type: 'object', properties: { file: { type: 'string' }, problem: { type: 'string' } }, required: ['file', 'problem'] } },
        },
        required: ['id', 'title', 'builds', 'claims', 'notReal'],
      },
    },
  },
  required: ['mode', 'summary', 'milestones'],
}
const BUILT = {
  type: 'object',
  properties: {
    contractId: { type: 'string' },
    summary: { type: 'string', description: 'what was built, in three sentences at most' },
    launch: { type: 'string', description: 'the exact command that starts the product now, as you ran it and saw it start, and the address or app it is seen at' },
    blocked: { type: 'string', description: 'empty unless the milestone could not be built at all, or could not be started for a reason outside the product (a download that does not arrive, a tool that is not on this machine): then what stopped it, with the figure. Anything written here stops the run before anyone verifies: where the milestone stands, leave it empty, and say what else there is to say (how you recorded something, what you did not see) in the summary' },
    disputes: {
      type: 'array',
      description: 'frozen checks you found to be wrong about how they check (not the product being wrong): each with the file and exactly what is wrong. Empty when there are none.',
      items: { type: 'object', properties: { file: { type: 'string' }, problem: { type: 'string' } }, required: ['file', 'problem'] },
    },
    notReal: {
      type: 'array',
      description: 'empty unless you found that something cannot be made real with what is at hand: then each, and you stopped there',
      items: { type: 'object', properties: { what: { type: 'string' }, tried: { type: 'string', description: 'where you looked and what it said' }, needs: { type: 'string', description: 'what it needs to be real, and from whom' }, vault: { type: 'string', description: 'for a key: the vault id it is to be kept under' } }, required: ['what', 'tried', 'needs'] },
    },
    unlike: {
      type: 'array',
      description: 'only for a first pass built to a drawing: each screen you left unlike its drawing because another claim requires it. A difference you mended is not listed. Empty when there is none.',
      items: { type: 'object', properties: { screen: { type: 'string', description: 'the screen or state, by the drawing\'s id' }, differs: { type: 'string', description: 'what the built screen has and what the drawing has, in a line' }, claim: { type: 'string', description: 'the id of the claim that requires it' } }, required: ['screen', 'differs', 'claim'] },
    },
  },
  required: ['contractId', 'summary', 'launch'],
}
const STARTED = {
  type: 'object',
  properties: {
    launch: { type: 'string', description: 'the exact command that starts the product now, as you ran it and saw it start, and the address or app it is seen at' },
    summary: { type: 'string', description: 'what you had to do to make it start, in two sentences at most; empty if it started as said' },
    blocked: { type: 'string', description: 'empty unless it could not be started for a reason outside the product: then what stopped it, with the figure' },
    looked: {
      type: 'object',
      description: 'only when the contract records a verdict for every one of its claims (an earlier run looked at all of it): those verdicts, as the contract has them. Leave it out when any claim has none yet',
      properties: {
        proven: { type: 'array', items: { type: 'string' }, description: 'ids of the claims recorded as proven' },
        refuted: { type: 'array', description: 'the claims recorded as shown false', items: { type: 'object', properties: { id: { type: 'string' }, fact: { type: 'string', description: 'what was found instead, from the claim\'s note, in a sentence or two' } }, required: ['id', 'fact'] } },
        unchecked: { type: 'array', description: 'the claims recorded as not checked', items: { type: 'object', properties: { id: { type: 'string' }, why: { type: 'string' } }, required: ['id', 'why'] } },
        aside: { type: 'array', items: { type: 'string' }, description: 'ids of the claims set aside for the owner' },
        broken: { type: 'array', description: 'promises of earlier work that `sz-eyes standing` lists as broken', items: { type: 'object', properties: { key: { type: 'string', description: '<contract>/<claim>' }, fact: { type: 'string' } }, required: ['key', 'fact'] } },
      },
      required: ['proven', 'refuted', 'unchecked'],
    },
  },
  required: ['launch'],
}
const VERDICT = {
  type: 'object',
  properties: {
    proven: { type: 'array', items: { type: 'string' }, description: 'claim ids shown true' },
    refuted: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, fact: { type: 'string', description: 'what happened instead, with the figure' }, sameAs: { type: 'string', description: 'when this claim is shown false by the same cause as another claim of this contract shown false at this look or an earlier one: that claim\'s id. One cause is one mend, one ruling and one count. Where the cause is this claim\'s own, leave it out' } }, required: ['id', 'fact'] } },
    unchecked: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, why: { type: 'string' } }, required: ['id', 'why'] } },
    broken: { type: 'array', description: 'claims of earlier work that stood before this one and do not hold now', items: { type: 'object', properties: { key: { type: 'string', description: '<contract>/<claim>' }, fact: { type: 'string', description: 'what happened instead, with the figure' } }, required: ['key', 'fact'] } },
    held: { type: 'array', items: { type: 'string' }, description: 'claims of earlier work (<contract>/<claim>) that were shown again in this look and hold' },
    stood: { type: 'number', description: 'how many claims of earlier work hold after this look, counting those shown before' },
    noticed: { type: 'array', items: { type: 'string' }, description: 'what no claim is about and the owner would want to know; a case in which the product is wrong about what a claim is about is that claim under "refuted", never here; a case you could make only with a part of the product given a behaviour it does not have, and could not bring the running product to, is here, with the case, how it was made, and the figure that shows the product does not get there' },
    carried: { type: 'array', description: 'claims of this contract an earlier look proved and that this look did not run again, because nothing since their verdict reaches their check or what their words are about', items: { type: 'object', properties: { id: { type: 'string' }, range: { type: 'string', description: 'the two commits compared, short: <the verdict\'s>..<HEAD>' }, why: { type: 'string', description: 'what git diff --name-only named, and why none of it is this claim\'s' } }, required: ['id', 'range', 'why'] } },
    sandbox: { type: 'string', description: HOST_SANDBOX ? 'empty unless a required device observation was blocked in this execution environment; then the exact refusal' : 'empty unless the session\'s command sandbox stopped you from looking at the product and the call outside it was refused: then the exact refusal' },
  },
  required: ['proven', 'refuted', 'unchecked'],
}
const CLOSED = {
  type: 'object',
  properties: {
    report: { type: 'string', description: 'path of the evidence page' },
    closed: { type: 'boolean', description: 'true only if `sz-eyes contract close` was run and said "closed"; false if it refused or was not run' },
    why: { type: 'string', description: 'when not closed: what the command said' },
    commit: { type: 'string' },
    line: { type: 'string', description: 'the line added to .sz/progress.md' },
    room: { type: 'number', description: 'the number on the first line of what `sz-eyes room` printed after the commit: whole gigabytes free on the disk the project is on' },
    corrections: { type: 'array', items: { type: 'string' }, description: 'only when told not to edit .sz/map.md and .sz/spec.md here: each line of them this milestone made false, and what it should say now' },
  },
  required: ['report', 'closed', 'line'],
}

const FACTS = {
  type: 'object',
  properties: {
    needed: { type: 'boolean', description: 'whether the product depends on a published rule, figure or exception' },
    stands: { type: 'boolean', description: 'true only when what an earlier run wrote (`.sz/facts.md` or `.sz/facts.none`) settles this request, and nothing was opened or written in this run' },
    readOn: { type: 'string', description: 'when it stands: the day on the page\'s `읽은 날` line, or the day `.sz/facts.none` gives; empty otherwise' },
    why: { type: 'string', description: 'one line on what the product hinges on' },
    page: { type: 'string', description: 'the path written (.sz/facts.md), or empty' },
    fixed: { type: 'array', items: { type: 'string' }, description: 'what the page settles, a line each (when it stands, the lines of its `## 기준` as they are)' },
    unread: { type: 'array', items: { type: 'string' }, description: 'what could not be read and what it needs' },
  },
  required: ['needed', 'why'],
}

// What whoever mends returns: what was mended, and what cannot be made true with what is at hand.
const MENDED = { type: 'object', properties: { fixed: { type: 'array', items: { type: 'string' } }, notFixed: { type: 'array', items: { type: 'string' } }, ranAlso: { type: 'array', items: { type: 'string' }, description: 'one line each for the checks of other claims, of this contract or of earlier work, that this change reached and you ran: `<claim id, or contract/claim>: what its check said`' } }, required: ['fixed'] }

const REDREVIEW = {
  type: 'object',
  properties: {
    checks: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          what: { type: 'string' },
          why: { type: 'string', description: 'what is unshown, false or missing, and where you saw it; for a rule or a figure of the world, the address of the page that gives it and the day it was read' },
          weight: { type: 'string', enum: ['fatal', 'serious', 'minor'] },
          where: { type: 'string', description: 'the claim id, screen, file or address' },
        },
        required: ['what', 'why', 'weight', 'where'],
      },
    },
    fatal: { type: 'array', items: { type: 'string' }, description: 'the fatal checks, a line each' },
    held: { type: 'array', items: { type: 'string' }, description: 'what you tried that held, a line each' },
  },
  required: ['checks', 'fatal'],
}

// ------------------------------------------------------------------ Plan
phase('Plan')
// A new product is planned twice: its first pass alone, and, when that stands, what comes after it. Claims for
// work that stands on a product nobody has seen are guesses, and the owner's first look is worth more than they are.
const AFTER = `

This run has just built and closed the product's first pass. Plan now what comes after it (you will find yourself in the case "Continue" below). You are planning from what is there, not from what the spec guessed: go through the pictures of every area and what its verifiers noticed (the first pass's evidence folder under \`.sz/evidence/\`, the newest lines of \`.sz/backlog.md\`), and start the product yourself only where they leave a question (\`.sz/map.md\` says how). Read \`.sz/owner.md\` first: what the owner has said since the first pass comes before the spec. What the verifiers noticed and nobody has mended goes into the first milestone you plan. A case one of them recorded as one the running product does not come to (made only with a part given a behaviour it does not have) is a gap in what was agreed, not a fault left lying: where the owner's request reaches that state (the product is meant for machines or uses on which it comes about), plan it as a claim of its own whose words name the state, with the case that shows it; where it does not, leave its line in \`.sz/backlog.md\` for the owner to choose.`
// What the owner answered before the run, or that they were not asked: given as it is to whoever plans, the
// product or its screens.
const OWNER_ANSWERS = asked === 'owner' ? `What the owner answered when asked beforehand, in their words:\n${answers}` : 'The owner was not asked anything beforehand. Where the request leaves something open that only they could say (who it is for, how it should feel, accounts, keys, money), take the conservative answer and list it under "decided". Wherever you write this down (the spec, the progress line), say that they were not asked: never that they did not answer.' + (answers ? `\nNotes from the session that started this run (its own words, not the owner's):\n${answers}` : '')
// A new product with screens is drawn before it is built, and its owner decides on the drawing. (Built whole and
// shown afterwards, a product was called "an old flash game"; drawn first by one designer from a plan, as one
// clickable prototype, the same request read as an app, and the owner chose that way.) Where the design stands
// is found out first, so that a run that only draws, or only waits, costs a minute of planning and not a pass.
const DESIGN_CHECK = `Before anything else, find out where this product's design stands: it decides whether you plan at all in this run, and finding out takes a minute. First run \`sz-eyes sandbox\` once, as an ordinary command (do not ask for it to run outside any sandbox), and return under "sandboxed" whether it answered "sandboxed": everyone who works after you is told what it said. Run \`sz-eyes room\` as well and return the number on its first line under "room": the gigabytes free on the disk this project is on, by which the run judges whether a milestone fits before it builds one. If \`sz-eyes\` itself does not run (the shell does not find it, or it ends at once saying that its copy has no dependencies or that a module is missing), nothing here can be measured or shown, so nothing is to be planned, drawn or built: return at once what it printed under "eyesDown", with mode "new", what was asked in a sentence as "summary", and no milestones. Do not run another copy of it from elsewhere on the machine in its place, and write nothing. For a product with a part on a phone, run \`sz-eyes ios room\` as well and return the number on its first line under "simulators": how many simulators this machine holds at once, which is how many verifiers may each have one. Then run \`ls .sz .sz/design\` and \`sz-eyes contract show design\`, and return under "design" the first of these that is so:
- "none": what was asked has no screen a person looks at (a command, a library, a service with no screen of its own); or \`.sz/spec.md\` is there, so the product has been worked on before (unless its first pass has not closed and contract \`design\` marks its claim **feel** [증명됨]: then "approved", and that first pass is still built to the drawing). Go on below as if this paragraph were not here.
- "again": contract \`design\` marks its claim **feel** [반증됨]: the owner looked at the prototype and said no. Return their words, as the claim's note gives them, under "said", and return at once, as for "needed".
- "approved": it marks **feel** [증명됨]: the owner said yes. Plan the first pass below, from the screens as planned and drawn.
- "needed": \`.sz/design/prototype.html\` is not there, or there is no contract \`design\`, or it marks its claim **screens** other than [증명됨] (a design stage stopped before its screens held). Return at once: mode "new", what was asked in two sentences as "summary", no milestones. Write no spec, no map and nothing else: the screens are planned and drawn next, by others, who take up what is there.
- "waiting": the prototype is there and measured, and **feel** is marked [아직] or [확인 못 함]: the owner has not judged it. Return at once, as for "needed".${designGo ? `
This run was started with design "go": the owner said to go on from the measured prototype without waiting for their verdict. Where you would return "waiting", return "approved" and plan the first pass from the prototype as it is; its claim **feel** stays the owner's to judge, and nobody judges it for them. Keep the designer’s measured theme if there is no owner choice in direction.md.` : ''}

`
// What the owner said yes to is what the first pass is built to, and what its first look holds it to.
// The claim that every screen is built as drawn carries its exception in its own words. (2026-11-22: worded without
// it, "the 28 built screens are as drawn and the only differences are these two", it was shown false at the first
// look in three first passes of one product, each time partly by what other claims of the same contract required:
// the statutory form's own words, the source's figures, a control a claim names. A fixer could not make it true,
// a ruling of 12 to 14 minutes set it aside for the owner, and from then on it was nobody's work: what no claim
// required, ten places in the last of the three, stayed unlike the drawing.) So whoever verifies it tells the two
// kinds apart: what a claim requires stands and is listed for the owner, who said yes to the drawing; what no
// claim requires is the claim shown false, and is mended like anything else shown false.
const DRAWN_PLAN = `
- When the design is "approved": the screens are planned (\`.sz/plan/frame.md\` and one file a screen under \`.sz/plan/screens/\`) and drawn (\`.sz/design/prototype.html\`; \`.sz/design/direction.md\` ends with what the builder needs: tokens, parts, each screen's parts and address), and the owner has ${designGo ? 'said to go on from the drawing without judging it first' : 'said yes to the drawing'}. The spec is cut from them and does not decide again what they decided: its areas are the frame's sections, its limits the frame's rules and numbers. Among the first pass's claims: every screen of the plan built as drawn, one claim shown by a look (each built screen beside its picture under \`.sz/design/shots/\`: the same content in the same order, made of the same parts, in the same tokens), worded with its one exception, "except where another claim of this contract requires otherwise": said of every screen and nothing more, it cannot be true beside a claim that asks for what the drawing does not have (the words of a form the law gives, a figure its source gives); and the claim about every screen at its limits, as below. What is real starts from the frame's sections 2 and 10, the list the owner saw at the drawing: look again at each (a key may be at hand since).`
const planIt = (stage) => agent(
  `${stage === 'after' ? '' : DESIGN_CHECK}You are planning a product (or a large change to one) that will then be built milestone by milestone with nobody watching. ${GROUND}${SAND} ${TOOLS}${stage === 'after' ? AFTER : ''}

The owner's request:
${request}

${OWNER_ANSWERS}

If \`.sz/spec.md\` already exists, the product has been worked on before. Read it, the contracts under \`.sz/contracts/\` (\`sz-eyes contract status\`, \`sz-eyes contract show <id>\`), \`.sz/progress.md\`, \`.sz/backlog.md\`, \`git log\` and \`sz-eyes standing\` (what earlier work proved and the product has to keep true). Do not plan again what is done and do not rewrite the spec's history. Then it is one of two cases, or both:
- **Continue** (mode "continue"): an earlier run stopped before finishing what the spec has, and the request asks for that. Return the spec's milestones with their claims as the contracts and the spec have them, each with its "state": "closed" (its contract is closed), "built" (its contract is frozen and its code is committed, and it was not verified to the end: give "contractId", "launch" when you know how it starts (the contract's line 띄우는 법 in \`sz-eyes contract show\` has it; leave it out otherwise, and the run reads it there), and under "disputes" any frozen check the earlier run reported as wrong about how it checks and nobody has corrected since: one the contract lists as corrected (\`sz-eyes contract show\`, under 얼린 뒤 고친 검사) is settled, and is not listed again) or "todo". A milestone whose code was written and that nobody has seen run is still "built" (say under "launch" how it is meant to be started, and that it has not been): this run starts it, and fixes what keeps it from starting, before anyone looks at it. If the product's first pass is not closed yet (an earlier run stopped before it was), return it with "first": true and list what the spec has after it under "later", without claims: that is planned when the first pass stands. Once the first pass is closed, what the spec lists as coming after it and has no contract yet is planned now: write each as a milestone into the spec and return it as "todo" with its claims, ${Math.max(1, maxMilestones - 1)} at most, the rest left listed for a later run. The order of the milestones that are not built yet is decided afresh by the rule under "The order" below: some of them may go side by side now even if the spec lists them in a line (give them "after").
- **Extend** (mode "extend"): the request asks for something the spec does not have, or for something to work differently. Amend \`.sz/spec.md\` so that it describes the product as it will be: change the lines that become false, add the new features to the order they are built in under new milestone names. Return the milestones that are not closed yet plus the new ones (state "todo"), with ids no contract has used. For each new milestone, besides its claims:
  - If \`git worktree list\` shows folders under \`.sz/trees/\`, an earlier run built milestones side by side and stopped before bringing them together: for each such milestone whose contract exists, state "built" (or "closed" if its contract is closed there) and "where": that folder's whole path.
  - "supersedes": the standing claims that will stop being true because what was asked has changed, each with the reason. Be exact: a standing claim you do not list stays a promise, and the milestone must keep it true. Prefer a change that keeps old promises (a new choice whose default is the old behaviour) to one that replaces them.
  - If it changes the shape of what is stored, one claim says that what was saved before the change is still there after it, shown by a test that starts from data in the old shape. The product carries over what exists; nobody is asked to delete their data.
${stage === 'after' ? 'First, whichever mode it is: run `sz-eyes sandbox` once, as an ordinary command (do not ask for it to run outside any sandbox), and return under "sandboxed" whether it answered "sandboxed". Everyone who works after you is told what it said. Run `sz-eyes room` as well and return the number on its first line under "room": the gigabytes free on the disk this project is on. For a product with a part on a phone, run `sz-eyes ios room` as well and return the number on its first line under "simulators": how many simulators this machine holds at once.\n' : ''}
Write no product code. Add a line to \`.sz/progress.md\` and commit \`.sz/\` if you amended the spec. If there is no spec yet (mode "new"):

Write \`.sz/spec.md\` in the owner's language: what the product is and for whom, the one thing it must do well, every area of it a person will use (a line each), how it is launched and looked at, and what is deliberately not built. A new product is made in three passes, and you plan the first now.

**The first pass** is the one milestone you return: the whole product, at the quality it will be used at, built in one stretch by one builder who keeps all of it in mind, and then looked at whole by someone who did not build it. (Cut into slices, each wrapped in a contract, a verification and a close of its own, one product was a single page after three hours, with every claim proven and none refuted; another had nothing to look at after four.)
- All of it: every area the spec lists, each to the depth a person needs to use it for real: what happens when there is nothing yet, when something fails, the second time someone comes. The one thing the product is for is made first and carried furthest.
- Nothing pretends. No made-up figures, no button that does nothing, no screen that only looks finished. What may be left not real, and who says so, is below (**What is real**).
- What a person enters is theirs from the start, with the least account the product can be used with (a guest of this device, or a code by e-mail).
- Its claims are the product's list of what a person can do, and the definition of done the builder works down: 8 to 20 of them, grouped by area, each shown by a flow (name the file it will be kept in: whoever verifies writes it), a test of what is pure rule (written before the code), a look or a command, with the figure or the words where there are any. Among them: every area's screen at phone size as pictures the owner can go through in one sitting (a look, kept in the evidence folder), and how it feels, which is the owner's to judge on those pictures (owner).${stage === 'after' ? '' : DRAWN_PLAN}

**Hardening** comes after it. List under "later", a line each, what makes the product safe to give to people (signing in through other services, deleting an account, one person unable to reach another's data, the phone itself, what the law asks, the app icon made as a picture in the colour the owner settled on, two or three for them to choose from), and anything in the request that is too uncertain or too large for the first pass, said as that. Give these no claims: they are planned when the first pass stands and has been looked at. ${Math.max(1, Math.min(maxMilestones, 6) - 1)} lines at most.

What holds for every milestone, this one and those planned later:
- **What is real.** ${REAL} Return under each milestone's "notReal" what it leaves not real yet, an entry each (empty when all of it is real), with "onPath" and "named" marked. Before any builder starts, the workflow looks for the words under "said" in the request and the answers; where they are not there, it builds nothing and asks the owner for what is needed. Each entry says so in one plain line on its screen, and the spec names it. The claim of the one thing is worded on real input and real data (the photograph a person takes, the prices as published), not on examples; where the owner allowed a part of its path to be an example for now, the claim names that part as the example it is and is worded on real input and data for the rest.
- If the owner had a case made for this service (\`sz-eyes worth show\` lists one: who it is for, what they use instead, the rows of the whole job), the spec is cut from it: the product is for the person and the moment of its \`who\` line; the first pass carries the row of kind \`edge\` furthest, and the first milestone after it delivers that row whole; the rows of kind \`stake\` (what two or more of the things people already use have in common) are all in a milestone or named in the spec as deliberately not built, with the reason; rows of kind \`more\` wait. Name in each milestone the rows it covers, by their ids. If there is no case, plan without one: making a case is done only when the owner asks for it.
- If there was a dive, ${BRIEF} Cut the spec from those pages. Keep the north star in the brief. From \`idea.md\`: the person and the moment, the one thing, the first minute, why a person comes back, what is not built, the feel. A line the idea left open ("비워 둔 것") is decided in the spec and marked as decided there, unless the brief reserved it for the builder. From \`brief.md\`: what it lists under 채울 것 becomes the spec's areas, its one thing, its own line for each signature moment and its constraints. What it lists under 비워 둘 것 is written into the spec as "빌더가 정한다" with the constraint the brief gave it, and no claim fixes it. A signature moment is one claim of the first pass, shown by a look or a flow that shows its effect ("돌리면 숨은 것이 드러난다"); no claim fixes the mechanism ("R키로 돌린다").
- An app for the phone made with a toolkit that also runs in a browser (Expo and React Native do): it is built so that the same app runs in a browser, and until the last pass it is shown there, at phone size, where a look takes seconds. What only a phone has (what the app keeps when it is closed and opened again, coming back from another app after signing in, the camera, health data, notifications, the keyboard over a button) gets a plain fallback in the browser, and is named in the line "on the phone" under "later": that milestone makes the native build and shows those things, and the main path once, on a simulator. (A first native build took four hours before one screen was seen, and most of what it found was its own toolchain.) Only when the toolkit cannot run in a browser does the first pass begin with the empty app running on a simulator, before any screen of the product is written.
- Every milestone leaves the product working. A later milestone never depends on something a milestone before it left broken.
- **The order.** A line is the default: each milestone after the one before it, and you leave "after" out. Put milestones side by side (give them the same "after") only when every one of these is true of each of them: it does not change the shape of what is stored and does not touch accounts or who may do what (such a milestone is "alone": true and has nothing beside it); it adds screens, routes and modules of its own, and where it changes a file the others also change, it adds to a list there (a route table, a menu, an export) and does not rewrite the same lines; none of its claims needs what another of the group builds. Say under "touches" what each of them changes. The first milestone always has nothing beside it. Three side by side at most. When in doubt, a line: milestones built side by side are each proven in a folder of their own, and are shown again together only after they are brought into one, which costs a look each time and a repair when the guess was wrong.
- A product people use is more than a screen: where it keeps what a person enters, what happens when there is nothing yet, when something fails, the second time someone comes. Each milestone after the first pass carries these for its own area; they are not left for the end.
- A product that lives is looked after: from the first milestone it writes down what failed (a log the owner can read) and counts the one thing it is for (started, finished), and \`.sz/map.md\` says where. Without that nobody can tell later whether it works for people.
- A product is made to be put where people reach it. Choose what it stands on with \`sz:backend\` and say in the spec which and why, in two lines. From the first milestone: its settings come from the environment (no secret and no address of this machine in the code), \`/healthz\` answers with the commit it was built from, and every flow runs against the address in \`SZ_URL\` when given one and starts a server of its own only when not. If people have accounts in it, one milestone's claims say that one person cannot read or change what another stored, and neither can someone not signed in, shown by a flow with two people.
- If \`.sz/facts.md\` is there, the spec and its claims are cut from it: a figure or a rule it gives is used as it gives it, with the day it was read; anything it lists as unread is not stated as true — it is either off the product's path or listed under \`notReal\` with what it needs.
- A claim does not state as true a fact about the world that nobody has read from its source. Where the request gives one (a limit, a price, a rule of somebody else's service), the claim says that the product follows the source and shows it with the day it was read, and the spec keeps the request's figure as what the owner wrote. A claim that repeats such a figure cannot be made true if the source says otherwise, and the work stops on it.
- A claim about every screen (nothing cut off, nothing that scrolls sideways, nothing to press smaller than 44px) is a claim at the product's limits, and says so: the spec states each limit (the longest name, the longest sentence a person may write, the largest figure), and the claim is shown by a flow that fills every field with its longest value and measures every screen in every state, named like any other flow. Pictures of the usual case do not show it, and stated without its limits it can be shown false for ever by a longer input. (Four first passes each went a second round on such a claim: a name cut off, mended, and the same name cut off on another screen.)
- A milestone after the first pass has 3 to 7 claims. A claim is something true of the running product that can be shown: with the figure, the words on the screen, the state. Each says how it is shown: a flow (name the file it will be kept in, in the project's own format: whoever verifies writes it), a test of what is pure rule (written before the code), a look at a named screen in a named state, or a command. One claim says what the milestone must not break. What only a person can judge is one claim shown by "owner". Two claims do not each claim one cause: where one change would make both true (the same rule, the same function, the same words on a screen), they are one claim, or the second says what is not the same (another screen, another moment, another input).
- Do not write product code in this step. Add a line to \`.sz/progress.md\` saying the spec is written, and commit \`.sz/\`.

Return the plan.`,
  { label: stage === 'after' ? 'plan:after' : 'plan', phase: 'Plan', schema: PLAN, ...effort('plan'), ...model('plan') },
)

// ------------------------------------------------------------------ Design: a new product's screens, before anything is built
// The screens are planned, the references looked at and the screens drawn at the same time: the designer starts
// the moment the plan's frame exists and takes each screen as it is written. (One after another, outside the
// workflow: a plan of 25 screens took 19 minutes, a reference board 10, the drawing 27, every screen measured
// clean.) Then someone who drew nothing measures every screen, and the run stops for the owner: a prototype waits
// fifteen minutes, a build nobody wanted costs two hours.
// A dive leaves the product's spine and the builder's decisions on separate lines of its confirmed brief.
// A dive started before the product had a folder is kept outside it (`~/.studio-zero/dives`), and `sz-eyes dive show`
// lists it from inside the product after the product's own, with every other idea kept there. (Until 2026-11-26 this
// pointed at `.sz/dive/` alone, and a brief written outside the product was passed over without a word.)
const BRIEF = 'run `sz-eyes dive show`: it lists this product’s own dives (under `.sz/dive/`), then those kept outside any product (under `~/.studio-zero/dives`), each with its folder. One kept outside is this product’s only when the request or the owner’s answers name it or its seed is plainly this product; when in doubt it is not. Of this product’s dives choose the newest relevant dive folder by its `dive.json` creation date. Read its `idea.md` if there is one and its `brief.md` only if it exists in that same folder. A draft is not a confirmed brief. Never borrow another dive’s brief.'
const DESIGN_GROUND = 'You are working in the project\'s folder, on a new product whose screens are drawn and put before its owner before anything of it is built. The command `sz-eyes` is on your PATH (the sz plugin\'s). Read `.sz/owner.md` if it is there (what the owner has said they want of this product: it comes before your own taste). What an earlier run of this stage left under `.sz/plan/` and `.sz/design/` is taken up where it stopped, not started again. If there was a dive, ' + BRIEF + ' The screens are cut from what the brief fills (북극성, the spine, one or two signature moments as effects, and the constraints). What it lists under 비워 둘 것 stays open in the frame and screen plans, with each constraint, for the designer or builder who owns the decision.' + ' Read `.sz/facts.md` where it is there: a figure or wording a screen must show is taken from it, with the day.'
const DESIGN_RECORD = ' For each drawing decision the brief left open, record the choice and a one-line reason under 비워 둔 것과 정한 것 in `.sz/design/direction.md`. Leave inputs and implementation to the builder.'
// Browser storage belongs to the person viewing the prototype. A worker taking a picture in a fresh browser
// needs the theme in the address. Resolve it against this checkout when the drawing is opened from a copy.
const THEME_ADDRESS = 'Read the theme line in `.sz/design/direction.md`. For the drawing use `file://$PWD/.sz/design/prototype.html?t=<name>`, with the chosen theme’s URL-encoded name, or the designer’s named theme where the line says 아직 없음. Keep the screen hash after the query. For an older prototype with no theme line, use its original address.'
const SWEEP = 'sz-eyes web sweep "$drawing_url" --from .sz/design/sweep.txt --size phone --out .sz/design/shots'
const WAITS = `the prototype waits for the owner: nothing is built until they have seen it and said. Open .sz/design/prototype.html for them (at a phone's width each screen is shown alone at prototype.html#<id>; the pictures are in .sz/design/shots/). If they approve a theme, take its name from the address they share or the choice they name. Before recording yes, measure that theme in a fresh browser: \`sz-eyes web sweep "file://$PWD/.sz/design/prototype.html?t=<name>" --from .sz/design/sweep.txt --size phone --out <fresh temporary shots folder>\` (URL-encode the name). Check that every screen and limit state is there and holds; open duplicate pictures to rule out the overview. If the sweep fails or a picture is missing, keep the canonical pictures and direction unchanged, report which screen failed, and stop before recording yes or starting the build. Only after the whole set holds, replace .sz/design/shots/ with the complete set and write “주인이 고른 테마: <name> — <file:///…/prototype.html?t=<name>>” in .sz/design/direction.md. If interrupted, finish both from the same successful sweep before recording yes. If no theme was chosen, keep the designer's measured theme and its 아직 없음 line. Record only what they say, in their words: sz-eyes contract judged design feel --verdict yes|no --said "<their words>". Their verdict is theirs: nobody gives it for them. Then run this workflow again: on yes it plans the first pass and builds it to the drawing, on no it draws again what they said.`
const PLANNED = { type: 'object', properties: { screens: { type: 'array', items: { type: 'string' }, description: 'the screen ids, in the order of their files' }, decided: { type: 'array', items: { type: 'string' }, description: 'what the request and the answers left open and how you decided it' }, notReal: { ...NOT_REAL, description: 'section 10 of the frame, an entry each, and what the one thing needs and is not at hand (section 2) as entries on its path' }, problem: { type: 'string', description: 'empty unless the screens could not be planned: then why' } }, required: ['screens', 'notReal'] }
const BOARD = { type: 'object', properties: { primary: { type: 'string', description: 'the primary reference: the product, and what of its way this product follows' }, kinds: { type: 'array', items: { type: 'string' } }, problem: { type: 'string', description: 'empty unless the board has a gap: no reference tool and nothing in the library for a kind' } }, required: ['primary'] }
const DRAWN = {
  type: 'object',
  properties: {
    idea: { type: 'string', description: 'the idea, in its one sentence' },
    primary: { type: 'string' },
    drawn: { type: 'number', description: 'how many screens were drawn' },
    states: { type: 'number', description: 'how many drawings in all, states and limits included' },
    measured: { type: 'string', description: 'what the last measurement reported' },
    departures: { type: 'array', items: { type: 'string' }, description: 'what departs from the handbook, and why' },
    couldNot: { type: 'array', items: { type: 'string' }, description: 'what you could not do: no reference tool, no image tool, a screen of the plan you could not draw and why' },
    missing: { type: 'string', description: 'empty unless you drew nothing: then which of the plan\'s frame and the reference board never came' },
  },
  required: ['drawn'],
}
const SWEPT = {
  type: 'object',
  properties: {
    screens: { type: 'number', description: 'how many screens the plan has' },
    hold: { type: 'number', description: 'how many of the plan\'s screens are in the prototype and hold' },
    drawings: { type: 'number', description: 'how many drawings the sweep measured: the plan\'s screens and their states and limits, the number its summary line gives' },
    findings: { type: 'array', description: 'every screen that does not hold (a drawing at its limits too), each with what was found', items: { type: 'object', properties: { screen: { type: 'string' }, found: { type: 'string' } }, required: ['screen', 'found'] } },
    summary: { type: 'string', description: 'the sweep\'s summary line, as it printed it' },
    sandbox: { type: 'string', description: HOST_SANDBOX ? 'empty unless a required device observation was blocked in this execution environment; then the exact refusal' : 'empty unless the session\'s command sandbox stopped the browser and the call outside it was refused: then the exact refusal' },
  },
  required: ['screens', 'hold', 'findings'],
}
// What the last measurement of the prototype showed, for the session the run returns to.
let designed = null
const redteam = ['plan', 'close', 'both'].includes(args.redteam) ? args.redteam : 'off'
const reviews = []
// Use the caller's runner. A milestone built in a worktree has its own product, ledger and backlog. It returns the
// review ({ checks, fatal, held }) or null when nobody answered; what a fatal finding stops is the caller's to say.
// `again`, after a closing review's findings were mended: those findings, looked at once more and nothing else.
const redTeam = async (at, m, built, run = agent, where = null, again = null) => {
  const beside = where ? ` This milestone was built beside others: its folder is \`${where}\` (a git worktree of the project on its own branch), and everything it built is there. Read its contract and evidence there (\`cd ${where} && …\`), make any test copy from this worktree, and file findings in its backlog.` : ''
  const planning = at === 'plan'
  const narrow = !planning && Array.isArray(again) && again.length > 0
  const prompt = planning
    ? `You review a plan before anything is built from it, and you did not write it. ${SAND} Start no other agent.

The owner's request:
${request}

${OWNER_ANSWERS}

The spec: \`.sz/spec.md\`. The screens, if they were drawn: \`.sz/plan/frame.md\`, \`.sz/plan/screens/\`, and the brief a
dive left (\`sz-eyes dive show\` lists its folder, under \`.sz/dive/\` or, kept outside any product, under
\`~/.studio-zero/dives\`). The fact page, if there is one: \`.sz/facts.md\`.
The first milestones and their claims: ${JSON.stringify(plan.milestones.map(({ title, claims }) => ({ title, claims })))}.

Read the plan and find what would make it fail after two hours of building: two claims that cannot both be true; a
case nobody planned for (the first time, nothing yet, something failed, the second visit, the longest name and the
largest figure the rules allow); a rule or a figure of the world stated as true with no source; something on the
path of the one thing that is not real and is not listed under notReal; one person able to reach another's data, a
secret in the code to be, a service's terms that forbid this; for a game, a loop, stakes and depth that contradict
each other, or nothing worth doing in the first thirty seconds. Then say what you tried to break and could not.
File each finding as it stands: \`sz-eyes backlog add "<one line, in the owner's language>" --from "red team: plan"\`
(in a Codex worker: \`record ["backlog", "add", "<one line>", "--from", "red team: plan"]\`).
Change no file, write no code, and record no verdict: a claim is the verifier's to show and the owner's to judge.
fatal = if this is true the plan cannot be built as it stands.`
    : narrow
    ? `You reviewed a built milestone in a new conversation and found faults that no claim covers. It has been mended
since by someone you do not see. ${SAND}${beside} Start no other agent.

The product starts like this: ${built.launch}. Its contract: \`sz-eyes contract show ${built.contractId}\`.

What you found before, each with where it was:
${again.map((f) => `- ${f}`).join('\n')}

Look at only these, on the product as it is now, the way you found them (if the project folder is read-only, make a
copy as before: \`copy=$(mktemp -d "$TMPDIR/sz-review.XXXXXXXX")\` and \`sz-eyes copy "$copy"\`, then
\`sz-eyes copy "$copy" --end\` when you are done). Each that still holds goes under "fatal" in the same words, with a
check: its \`where\` and what you saw. Each that no longer holds goes under "held", with what you saw instead. Look for
nothing new: a fault nobody has found yet is not this look's. Change no file, record no verdict, and file nothing in
the backlog: what still holds is there already.
fatal = this cannot stand as it is.`
    : `You review a built milestone before it is closed, and you did not build it. ${SAND}${beside}

The product starts like this: ${built.launch}. Its contract: \`sz-eyes contract show ${built.contractId}\`. Read its
recorded verdicts and the evidence files they name under \`.sz/evidence/${built.contractId}/\`. The closer writes report.html after your review.

Use the existing verdicts for the claims. Try one ordinary, unclaimed use case on the local product with disposable
fixture data, such as returning to an empty list or entering the longest supported name. If the project folder is
read-only, run \`copy=$(mktemp -d "$TMPDIR/sz-review.XXXXXXXX")\` and \`sz-eyes copy "$copy"\` from the milestone
folder. Add \`--with <path>\` for any untracked build output the launch needs. Keep the printed path. Start the
server and try the case in that copy. Stop the server you started, then clean up from the milestone folder with
\`sz-eyes copy "$copy" --end\`, using the saved path. For privacy and secrets, inspect the local authorization code, tests and committed files; report only the
location and impact. Keep live interaction to the ordinary product flow. Say what held up as well as what failed. File each finding with \`sz-eyes backlog add "<one line, in the owner's language>" --from "red team: ${m.id}"\`
(in a Codex worker: \`record ["backlog", "add", "<one line>", "--from", "red team: ${m.id}"]\`).
Change no product code and record no verdict. fatal = this cannot stand as it is.`
  const review = await run(prompt, {
    label: planning ? 'redteam:plan' : narrow ? `redteam:${m.id}:again` : `redteam:${m.id}`, phase: planning ? 'Plan' : 'Close',
    agentType: 'sz:redteam', schema: REDREVIEW, ...effort(planning ? 'plan' : 'verify'),
    ...(MODELS.includes(args.redteamModel) ? { model: args.redteamModel } : {}),
  })
  const what = `red team on ${planning ? 'the plan' : m.title}${narrow ? ', on what it found before' : ''}`
  if (!review) {
    log(`${what}: the review did not answer`)
    return null
  }
  const checks = review.checks ?? []
  const fatal = review.fatal ?? []
  const held = review.held ?? []
  reviews.push({ at, ...(planning ? {} : { milestone: m.id }), ...(narrow ? { again: true } : {}), checks, fatal, held })
  const reviewModel = HOST_SANDBOX?.redteamModel || (MODELS.includes(args.redteamModel) ? args.redteamModel : 'opus')
  log(`${what}: ${reviewModel}, new conversation; ${checks.length} found, ${fatal.length} fatal${held.length ? `; ${narrow ? 'no longer so' : 'could not break'}: ${held.slice(0, 3).join(' / ')}` : ''}`)
  return { checks, fatal, held }
}

// What the screens' planner listed as not real: the owner sees it at the drawing, before anything is built, and is
// asked there for what the build needs from them.
let drawnList = null
const atDrawing = () => {
  const list = drawnList || []
  const owed = list.filter((e) => waitsFor(e))
  const rest = list.filter((e) => !waitsFor(e))
  const line = `${owed.length > 0 ? ` Before the build, from the owner: ${owed.map((e) => `${e.what}: ${e.needs || '(what it needs was not said)'}${armLine(e) || keyLine(e) ? ` (\`${armLine(e) || keyLine(e)}\`)` : ''}`).join('; ')}.` : ''}${rest.length > 0 ? ` Not real yet in the first pass, each said on its screen: ${rest.map((e) => `${e.what} (${e.reason})`).join('; ')}.` : ''}`
  return { owed: owed.map((e) => asNeed(e, waitsFor(e), 'design')), line }
}
const askAtDrawing = () => {
  const { owed, line } = atDrawing()
  if (owed.length === 0) return line
  needed.push(...owed)
  return `${line} While they look, put to them what the build needs from them: for each, a key they put in the vault themselves, in their own terminal (run the command in brackets and put what it prints to them as it stands: their steps and the line that stores the key), or their words that it may be an example for now, which go word for word into answers (asked: "owner") when this workflow is started again. The build does not start without one or the other.`
}

// again: the owner said no, and the contract `design` is there to record on; its claim feel goes back to them.
const sweepDesign = (again) =>
  agent(
    `Measure the prototype of a new product's screens before its owner sees it. You did not draw it and you take nobody's word for it. ${DESIGN_GROUND}${SAND}

1. List the plan's screens yourself, from its files and not from the designer's list (a screen left out of the prototype is one of the things you look for): \`ls .sz/plan/screens | sed -n 's/^[0-9]*-\\(.*\\)\\.md$/#\\1/p' > .sz/design/sweep.txt\`. Then add the lines of the drawings at their limits that \`.sz/design/screens.txt\` has beyond those.
2. ${THEME_ADDRESS} Set drawing_url to that address in the shell running \`${SWEEP}\`. It opens one browser, measures every screen in it, prints for each what it found and then a summary line, and keeps a picture of each.
3. A screen the prototype does not have shows the overview, and the sweep counts it as holding. Pictures that are the same byte for byte (\`shasum .sz/design/shots/*-phone.png\`) show the same thing: open those, and a screen of the plan that is not shown alone at its address does not hold.
4. ${
      again
        ? `Contract \`design\` is there: record on it. \`sz-eyes contract claim design screens --status proven|refuted --note "<the sweep's summary line>"\`: proven only when every screen of the plan is there and holds. When it is, the drawing is the owner's to judge again: \`sz-eyes contract claim design feel --status unchecked --note "<in the owner's language: what they said last time, and what was changed for it>"\`, as an owner's claim that waits for them is marked. While a screen does not hold, leave **feel** as it is.`
        : `If there is no contract \`design\` yet (\`sz-eyes contract show design\`), record it, its words in the owner's language, then \`sz-eyes contract freeze design\`, with no files:
\`sz-eyes contract new design --lane M --request "<the product in a sentence, in the owner's language>" --claim "screens|<every screen of the plan is in the prototype and none is cut off, at phone size and at its limits>|command:<the sweep command as you ran it>" --claim "feel|<the owner's own judgement: this is the product, build it as drawn>|owner:.sz/design/prototype.html"\`
Then \`sz-eyes contract claim design screens --status proven|refuted --note "<the sweep's summary line>"\`: proven only when every screen of the plan is there and holds. Leave **feel** to the owner.`
    }

Change nothing in the prototype or the plan. Return how many screens the plan has, how many of them hold, how many drawings the sweep measured (its summary line counts every drawing, a screen's states and limits too, and calls each a screen), and every screen that does not hold (a drawing at its limits too) with what was found.${FINISH}`,
    { label: 'sweep:design', contractId: 'design', phase: 'Design', schema: SWEPT, ...effort('close') },
  )
const holds = (swept) => Number(swept.screens) > 0 && Number(swept.hold) >= Number(swept.screens) && (swept.findings || []).length === 0

// Draws a new product's screens, or draws them again from what the owner said, and measures them. Returns why
// the run stops short of putting them before the owner, or null when every screen holds.
async function drawScreens(state, said) {
  phase('Design')
  if (state === 'again') {
    log(`the owner said no to the prototype: it is drawn again from what they said, and put before them again`)
    const redrawn = await agent(
      `You are the designer of a new product, and its owner has looked at the prototype of its screens and said no. ${DESIGN_GROUND}${DESIGN_RECORD}${SAND} Load the \`sz:design\` skill: it is how the prototype was made, and how you change it.

What the owner said, in their words:
${said || '(the plan did not bring their words: read them in the note of the claim feel, `sz-eyes contract show design`)'}

The plan of the screens (\`.sz/plan/\`) and the reference board (\`.sz/design/refs.md\`) stand. Read \`.sz/design/direction.md\`, and look at the prototype as it is (\`.sz/design/prototype.html\`, a picture of each screen under \`.sz/design/shots/\`). Change what they said and nothing they did not: where it is about a part or a token, change it there, and every screen made from it changes with it; what they did not speak of stays as it is. Where what they said changes the plan itself (a screen to drop or to add, a step taken out), change \`.sz/plan/\` for exactly that as well, so that the plan and the drawing say the same: whoever measures after you goes by the plan's screens. Measure as the skill says before you return, and correct \`direction.md\` where it no longer says what is drawn. Start no other agent.

Return what you changed for each thing they said.`,
      { label: 'design:again', phase: 'Design', ...effort('build'), ...model('design'), schema: { type: 'object', properties: { changed: { type: 'array', items: { type: 'string' } }, couldNot: { type: 'array', items: { type: 'string' } } }, required: ['changed'] } },
    )
    if (!redrawn) return 'the prototype could not be drawn again from what the owner said (the designer did not answer)'
  } else {
    log('a new product with screens: every screen is planned and drawn first, and put before the owner before anything is built')
    const [planned, board, drew] = await beside([
      () =>
        agent(
          `You plan the screens of a new product, as files a designer draws from. ${DESIGN_GROUND}${SAND}

The owner's request:
${request}

${OWNER_ANSWERS}

Take up what is there: an earlier run may have stopped part of the way. If \`.sz/plan/screens/DONE\` is there, the plan is whole: write nothing, change nothing, and return the screen ids from its files and the list from the frame's sections 2 and 10. If \`.sz/plan/frame.md\` is there without it, the frame and every screen already written stand as they are (a designer may have drawn from them): write only the screens that are missing, then \`DONE\`.

Load the \`sz:design\` skill with the Skill tool only to learn where its folder is, and read its \`references/handoff.md\` whole. That file is what you follow (the skill itself is the designer's, who works beside you): look at how shipped products take a person through these journeys, then write \`.sz/plan/frame.md\` first and whole, then one file a screen under \`.sz/plan/screens/\` in the order of the product's main path, each under another name and renamed when it is whole, and when the last is written, the empty file \`.sz/plan/screens/DONE\`.

A designer starts drawing the moment \`.sz/plan/frame.md\` exists, and takes each screen as its file appears. So write the frame whole and as soon as you can, before any screen; then the screens in order, without going back to change one that is written. (Planned whole first and drawn after, 25 screens took 19 minutes to plan before the drawing could start.) What the request and the answers leave open about structure is decided in the frame and marked as decided there. Carry what the brief reserved for the designer or builder into section 11 with its constraint.

What is real is found before any screen is written (sections 2 and 10 of the frame), by this rule: ${REAL} Return that list under "notReal", an entry each, with what the one thing needs and is not at hand as entries on its path: the owner is asked for those while they look at the drawing, and the build does not start without them.

Write no spec, no code and no picture. Return the screen ids in the order of their files, and the list.`,
          { label: 'screens', phase: 'Design', schema: PLANNED, ...effort('plan'), ...model('plan') },
        ),
      () =>
        agent(
          `You make the reference board of a new product: how shipped products do the screens it stands on. ${DESIGN_GROUND}${SAND}

The owner's request:
${request}

${OWNER_ANSWERS}

Take up what is there: if \`.sz/design/refs.md\` is there, an earlier run made the board and it stands: search nothing, and return its primary reference and its kinds.

Load the \`sz:design\` skill and do its step 1 ("Look at how shipped products do these screens"), and only that: a designer beside you does the rest, and waits for your board. Do not wait for the plan of the screens, which is being written at the same time: name the kinds of screen this product stands on from the request, and start with the house library. Before you write the board, read \`.sz/plan/frame.md\` (wait for it if it is not there yet: \`until [ -e .sz/plan/frame.md ]; do sleep 10; done\`; if it is still not there after twenty minutes, whoever plans the screens has failed: write the board without this check and say so under "problem") and check your kinds against its one thing and its list of screens; change a kind it shows to be wrong. Write \`.sz/design/refs.md\` last, whole, under another name and renamed when it is: the designer starts the moment it exists. (Made alone, a board took 10 minutes.)

Return the primary reference and the kinds of screen the board covers.`,
          { label: 'refs', phase: 'Design', schema: BOARD, ...effort('build'), ...model('design') },
        ),
      () =>
        agent(
          `You are the designer of a new product: you draw every screen of it in its final look, as one clickable prototype, before anything of it is built. ${DESIGN_GROUND}${DESIGN_RECORD}${SAND}

The owner's request:
${request}

Load the \`sz:design\` skill and follow it, the whole stage, by yourself: start no other agent (one hand, one file, one set of parts is what makes the screens read as one product). Two others started with you: one writes the plan of the screens (\`.sz/plan/frame.md\` first, then a file a screen), one the reference board (\`.sz/design/refs.md\`). Both take about ten minutes, and you decide nothing before both are there. Use the wait for what needs neither: read \`sz:taste\` and its handbook for this kind of product whole, and see what the owner's stock of pictures holds (\`sz-eyes image find --kind face\`, and the kinds this request will need). Then wait:
until [ -e .sz/plan/frame.md ] && [ -e .sz/design/refs.md ]; do sleep 10; done
If either is still not there after twenty minutes, draw nothing and return saying which. Then draw the screens that are written and wait for the next, as the skill shows, until \`.sz/plan/screens/DONE\` is there and every screen is drawn. Measure as the skill says before you return: someone who drew nothing measures it again after you.

Take up what is there: if \`.sz/design/prototype.html\` is there when you start, an earlier run began the drawing and stopped. Read \`.sz/design/direction.md\` and the file, keep its direction, its tokens, its parts and every screen it has, and draw only what is missing (a screen of the plan with no address in it, a section of \`direction.md\` not written), then measure all of it.

Return as the skill says.`,
          { label: 'design', phase: 'Design', schema: DRAWN, ...effort('build'), ...model('design') },
        ),
    ])
    drawnList = notRealOf(planned)
    if (!drew || (drew.missing || '').trim() !== '') {
      const why = [drew ? drew.missing.trim() : 'the designer did not answer', planned ? (planned.problem || '').trim() : 'the screens were not planned (nobody answered)', board ? (board.problem || '').trim() : 'the reference board was not made (nobody answered)'].filter(Boolean)
      return `the screens could not be drawn: ${why.join('; ')}. Run this workflow again to take them up where they stopped.`
    }
  }
  let swept = await sweepDesign(state === 'again')
  // What does not hold is mended by whoever draws, as a build's claims are: twice at most.
  for (let round = 1; round <= 2 && swept && !(swept.sandbox || '').trim() && !holds(swept); round++) {
    const findings = (swept.findings || []).map((f) => `- ${f.screen}: ${f.found}`).join('\n') || `- ${Number(swept.screens) - Number(swept.hold)} of the plan's ${swept.screens} screen(s) do not hold (the measurement named none)`
    await agent(
      `You are the designer of a new product's prototype, mending what a measurement found. ${DESIGN_GROUND}${SAND} Load the \`sz:design\` skill: its parts, its words and its look hold here as when it was drawn. If the mend changes a recorded drawing decision, update its line and reason in \`.sz/design/direction.md\`.

Someone who did not draw it measured \`.sz/design/prototype.html\` at phone size (\`${SWEEP}\`, the screens listed in \`.sz/design/sweep.txt\`), and these do not hold:
${findings}

${THEME_ADDRESS} Set drawing_url accordingly for the same sweep. Mend the part, not the screen: a name cut off in one row is cut off in every row made from that part, so the cause is mended where the part is defined, and every screen made from it has the mend. A screen of the plan that the prototype does not have is drawn now, from its file under \`.sz/plan/screens/\`, of the same parts. Then run the same sweep yourself until it reports nothing (a third run means a part is wrong, not a screen). Change nothing in the plan, and start no other agent. Return what you changed.`,
      { label: `fix:design:${round}`, phase: 'Design', ...effort('build'), ...model('design'), schema: { type: 'object', properties: { changed: { type: 'string' } }, required: ['changed'] } },
    )
    swept = await sweepDesign(state === 'again')
  }
  if (swept) designed = { prototype: '.sz/design/prototype.html', screens: swept.screens, hold: swept.hold, findings: swept.findings || [], summary: swept.summary || '' }
  if (!swept) return 'the prototype was drawn and could not be measured (nobody answered)'
  if ((swept.sandbox || '').trim() !== '') return `the prototype was drawn and could not be measured: ${observationRefusal(swept.sandbox)}. ${AFTER_SANDBOX_STOP}`
  if (!holds(swept)) return `the prototype was drawn and still does not hold after two rounds of mending: ${Math.max(0, Number(swept.screens) - Number(swept.hold))} of the plan's ${swept.screens} screen(s) do not hold: ${(swept.findings || []).map((f) => `${f.screen} (${f.found})`).join('; ') || '(the measurement named none)'}. Nothing is put before the owner that does not hold: run this workflow again to take the drawing up where it stopped.`
  const asks = atDrawing().line
  // The sweep's own line counts drawings (a screen's states and limits too) and calls each a screen: both numbers
  // are said, so that 24 screens and "44 screens" are not read as a disagreement.
  const drawings = Number(swept.drawings) > Number(swept.screens) ? ` (${swept.drawings} drawings with their states and limits)` : ''
  log(`DESIGN READY: open .sz/design/prototype.html. ${swept.screens} screen(s) of the plan drawn${drawings}, all ${swept.screens} hold at phone size and at their limits${asks ? `.${asks}` : ''}`)
  return null
}

// The run stops at the prototype: what came of the design stage goes back to the session, and nothing is built.
const stopAtDesign = (stopped) => {
  log(stopped)
  return { mode: plan.mode || 'new', summary: plan.summary || '', decided: plan.decided || [], spec: null, design: designed, milestones: [], joins: [], forOwner: [], notBuilt: [], needed, stopped }
}
// Nothing is built while the plan leaves not real what only the owner can let be so.
const stopNotReal = (stopped) => {
  log(stopped)
  return { mode: plan.mode || null, summary: plan.summary || '', decided: plan.decided || [], spec: '.sz/spec.md', design: designed, milestones: [], joins: [], forOwner: [], notBuilt: [...milestones.filter((m) => m.state !== 'closed').map((m) => m.title), ...(more ? later : [])], needed, redteam: reviews, stopped }
}

// Every run but `off` asks once. What an earlier run wrote is read first, and a publisher's page is paid for again
// only when that page is gone, older than 30 days, or short of a criterion this request turns on. (Until 2026-11-26
// every run read the publishers again and wrote the page anew: a run that only stopped at the drawing, and one whose
// milestones were all closed, each paid for the same reading, and the page's day became the day of the last run.)
// `on` is the owner's word to read the publishers again whatever the page says; `auto` (the default) is not.
const factsAgain = args.facts === 'on'
if (args.facts !== 'off') {
  const found = await agent(
    `${factsAgain ? 'This run was started with facts "on": the owner wants the publishers read again. Skip STEP 1 whatever the page says, open again the publisher of every quotation the page has, and correct only what they publish differently now.\n\n' : ''}You keep the one page of what an authority publishes about the one thing this product is for, and you write it
before anyone plans the product. ${SAND}

The owner's request:
${request}

${OWNER_ANSWERS}

Today is what \`date +%F\` prints: run it, and count days from it.

STEP 1 — does what an earlier run wrote still stand? Read \`.sz/facts.md\` and \`.sz/facts.none\`, whichever is there
(when both are, \`.sz/facts.md\` is the one that counts).
- \`.sz/facts.md\`, its \`읽은 날\` 30 days ago or less, and nothing in the request above turns on a criterion its
  \`## 기준\` does not cover: open no publisher and write nothing, not one character. Return needed: true, stands: true,
  readOn: the day on its \`읽은 날\` line, page: ".sz/facts.md", and under fixed the lines of its \`## 기준\` as they are.
  A page an earlier run paid for is what this run uses: reading the same publishers again for the same product makes
  the owner pay twice for one answer.
- \`.sz/facts.none\`, dated 30 days ago or less, and nothing in the request above is new to it: write nothing, and
  return needed: false, stands: true, readOn: its day, why: its reason.
Otherwise go on to STEP 2.

STEP 2 — decide whether the product's one thing turns on a rule, a figure or an exception that somebody other than
the owner publishes: a law or a regulation, a benefit or a price table, a standard, a licence, a fee schedule, a
published criterion (분양가 상한, 퇴직금 산정, 보상 기준, 약가, 요금표, 공공데이터의 정의).
- If nothing on the path the product's person takes does: write no page, return needed: false with the reason in
  one line, and write \`.sz/facts.none\` as that one line, \`<today> <the reason>\`, so that the next run does not pay
  for this question again.
- If it does: open the page that holds the criterion (법령정보센터, 정부24, 공단·공사, the operator's own tariff page,
  the standard's publisher) and quote the sentence as it stands, with its address and the day you read it. Then
  write \`.sz/facts.md\` in this shape, the headings as they stand:

# 사실 기준: <what it governs>
읽은 날: <YYYY-MM-DD>
## 무엇을 정하는가
## 기준
## 예외
## 숫자
## 우리 제품에 걸리는 것
## 아직 못 읽은 것

A page that is already there is extended, not written anew. Every quotation on it stays word for word, with its
address and its day. Where a publisher now says otherwise, the new quotation goes beside the old one with its own
day, and the old one is marked as replaced, not deleted. What this request needs and the page lacks is added, each
line with the day it was read. \`읽은 날\` is the day of the oldest reading the page rests on: change it only when you
have opened again, in this run, the publisher of every quotation on the page. A page you added to without that keeps
the day it has, so that it never looks younger than what it quotes.

A figure enters the page inside a quotation, or as plain arithmetic over quoted figures that you show. No figure of
your own, none from memory, none summarised to favour the product. A page that refuses you (a login, a fee, another
country's law) is written under 아직 못 읽은 것 with what it needs. Judge nothing about whether the product should be
built, and change no product code.

Return needed, stands (true only when STEP 1 held and nothing was opened or written), readOn, why, the page's path,
what the page now settles (one line each), and what you could not read.`,
    { label: 'facts', phase: 'Plan', agentType: 'sz:facts', schema: FACTS, ...effort('plan') },
  )
  const stood = Boolean(found && found.stands === true)
  const day = found && found.readOn ? found.readOn : 'an earlier run'
  if (!found) log('the fact check did not answer: the plan is made without it')
  else if (stood && factsAgain) log(`facts: "on" asked for the publishers to be read again, and the fact check read nothing: what it settled on ${day} is used as it stands`)
  else if (!found.needed) log(stood ? `no published rule bears on this product (settled on ${day}): not looked into again` : `no published rule bears on this product: ${found.why}`)
  else if (stood) log(`the fact page ${found.page || '.sz/facts.md'} stands as it was read on ${day}: not read again`)
  else {
    const unread = found.unread ?? []
    log(`the fact page ${found.page || '.sz/facts.md'} stands: ${(found.fixed ?? []).slice(0, 3).join(' / ')}${unread.length ? ` (not read: ${unread.join('; ')})` : ''}`)
  }
}

let plan = await planIt('start')
if (!plan) return { error: 'no plan came back' }
// Eyes that do not run: every stage after this one would find it out for itself, each in its own way.
if (typeof plan.eyesDown === 'string' && plan.eyesDown.trim() !== '') {
  const stopped = `nothing was started: sz-eyes does not run on this machine as the plugin is installed, so nothing could be measured or shown. What it printed: ${plan.eyesDown.trim()} Put that right (for a copy of the harness without its dependencies: pnpm install in that copy), then start the workflow again.`
  log(stopped)
  return { mode: null, summary: plan.summary || '', decided: plan.decided || [], spec: '.sz/spec.md', design: null, milestones: [], joins: [], forOwner: [], notBuilt: [], needed: [], stopped }
}
learn(plan)
const DESIGNS = ['none', 'needed', 'waiting', 'again', 'approved']
let design = DESIGNS.includes(plan.design) ? plan.design : 'none'
if (design === 'needed' || design === 'again') {
  const short = await drawScreens(design, typeof plan.said === 'string' ? plan.said.trim() : '')
  if (short) return stopAtDesign(short)
  if (!designGo) return stopAtDesign(WAITS + askAtDrawing())
  log('the owner said to go on without judging the prototype first (design: "go"): the first pass is planned from it and built to it, and how it feels stays theirs to say')
  phase('Plan')
  plan = await planIt('start')
  if (!plan) return { error: 'no plan came back' }
  learn(plan)
  design = DESIGNS.includes(plan.design) ? plan.design : 'none'
}
if (design === 'waiting' || design === 'needed' || design === 'again') return stopAtDesign(WAITS)
if (!Array.isArray(plan.milestones) || plan.milestones.length === 0) return { error: 'no plan came back' }
if (redteam === 'plan' || redteam === 'both') {
  const review = await redTeam('plan', null, null)
  if (review && review.fatal.length > 0) {
    const stopped = `nothing was built: ${review.fatal.join('; ')}. The findings are in .sz/backlog.md. The plan stands at .sz/spec.md. Review the request and answers, and start again.`
    log(stopped)
    return { mode: plan.mode || null, summary: plan.summary || '', decided: plan.decided || [], spec: '.sz/spec.md', design: designed, milestones: [], joins: [], forOwner: [], notBuilt: plan.milestones.map((m) => m.title), needed, redteam: reviews, stopped }
  }
}
// A first pass whose screens were drawn and judged (or let go on) is built to the drawing and held to it.
const toDrawing = design === 'approved'
// Of a new product only the first pass is built from this plan; what comes after it is planned when it stands.
// The first milestone of a new product is its first pass, marked or not; in a run that takes up a product whose
// first pass never closed, it is the one the plan marks.
const marked = plan.milestones.findIndex((m) => m.first === true && m.state !== 'closed')
const cutAt = marked >= 0 ? marked : plan.mode === 'new' ? 0 : -1
const fresh = cutAt >= 0
let milestones = fresh ? plan.milestones.slice(0, cutAt + 1).map((m, k) => ({ ...m, first: k === cutAt })) : plan.milestones.slice(0, maxMilestones)
const later = fresh ? [...(plan.later || []).map((l) => l.title), ...plan.milestones.slice(cutAt + 1).map((m) => m.title)] : []
let more = later.length > 0
const owedAtStart = holdFor(milestones, 'nothing was built: the plan leaves something not real that may be so only on the owner\'s own word')
if (owedAtStart) return stopNotReal(owedAtStart)
// How long to expect is said before the first milestone: 20 to 30 minutes each is what a small web product took
// with building at "high" (docs/runs/2026-11-16-speed). An owner who is told nothing learns the length of a run
// by waiting through it.
const ahead = milestones.filter((m) => m.state !== 'closed').length
const whose = asked === 'owner' ? 'planned from what the owner answered' : 'the owner was not asked beforehand: what was open is decided conservatively and listed in the spec'
if (fresh) {
  log(`${plan.mode === 'new' ? 'spec written' : 'continuing'}. First pass: ${milestones[cutAt].title}${more ? `. After it, planned when it stands: ${later.join(' / ')}` : ''}`)
  log(`${whose}; the whole product can be looked at when its first pass stands (this run logs BUILT then), before it is verified and closed`)
} else {
  log(`${plan.mode === 'extend' ? 'spec extended' : 'continuing'}: ${milestones.length} milestone(s): ${milestones.map((m) => m.title).join(' / ')}`)
  log(`${whose}; ${ahead} milestone(s) to go, expect about ${ahead * 20} to ${ahead * 30} minutes (a phone app's native build adds its own)`)
}

// ------------------------------------------------------------------ one milestone, from its contract to its close
// `where` is null when it is built in the project's own folder, with nothing beside it. When it is built beside
// others it is the folder made for it (a git worktree of the project): everything is done there, and what it
// did is brought into the project's folder afterwards, with the others, and shown again together.
const WRITE_FLOWS = (contractId) => ` The flows of this contract have not been written: its builder was told to leave them to you. For each claim of yours that names a flow file: show the claim on the product by operating it, then keep exactly what you did as that file, in the project's own format (the map says which), run it once and see it reach its last line, and have the contract hold it: \`sz-eyes contract add-check ${contractId} --frozen <the file>\`. Write it also when the claim turned out false: it fails now, for that reason, and it is what the fix will be proven against. A claim about every screen at the product's limits is one flow too: it fills every field a person can type into, and every figure that grows, with the longest value the spec allows (where the spec is silent, the longest the product accepts), opens every screen in every state at phone size and measures each (\`sz-eyes web look <address> --size phone\`, or the look a \`sz-eyes web do\` ends on), prints every finding above minor with its screen, and fails when there is one. Report every finding it prints, not the first: whoever mends them is handed the whole list at once. A flow starts a server of its own only when it is not handed one (\`SZ_URL\`). Commit the flows you wrote, and nothing else.`
// Every milestone is checked this way, the first pass and what is built on a product that stands. (Until
// 2026-11-18 a later milestone's builder wrote its flows before the code. On the phone milestone of that night
// its builder drove a simulator against its own flows for 92 of its 182 minutes, ten of them were then ruled
// wrong about how they check, one ruling after another for 75 minutes, and the first pass, whose flows the
// verifiers wrote afterwards, had no dispute at all.)
const FIRST_STEPS = (m, replaces) => `2. Write first only the tests of what is pure rule (a calculation, a table of what is allowed and what is not): they are quick, and they are the definition. Run them once and see them fail for the right reason. Do not write the flows: whoever verifies writes each of them on the product as it stands, so that no check is fitted to what was built, and so that you get to the product sooner.${replaces ? ' The flow or test a replaced promise was proven by is the one exception: it is rewritten now to say the new truth (or removed if nothing of it remains), and frozen with this contract; every other flow and test of earlier work stays exactly as it is.' : ''}
3. Freeze: \`sz-eyes contract freeze ${m.id} --frozen <each of those files>\`, each file as its own \`--frozen\` (with no files if there are none). From here you edit neither the contract nor those files. If you later find that one of them is itself wrong about how it checks (a quoting error, a figure copied wrong), do not work around it and do not stop: finish the build, and list it under "disputes" with the file and exactly what is wrong; someone who did not build this will settle it.`
// The look of a first pass whose every screen was drawn before it was built is settled: the builder carries it,
// and its first look sets each built screen beside its drawing.
const DRAWN_BUILD = `, and it is settled: every screen was drawn before this build (\`.sz/design/prototype.html\`), and that drawing is what is built, so do not settle it again. \`.sz/design/direction.md\` ends with what you need (빌더에게: the tokens, the parts, each screen's parts and its address in the prototype). ${THEME_ADDRESS} Carry the paper, ink and brand of that theme into the product. Carry the prototype's tokens and parts: for a web product its markup and CSS as they are; for a phone app the tokens, the parts and each screen's order, written again in the toolkit. Each screen is built as drawn: the same content in the same order, made of the same parts, in the same tokens. \`sz:taste\` is for what the design leaves open.`
const AS_DRAWN = ` Every screen of this product was drawn before it was built (\`.sz/design/prototype.html\`, a picture of each under \`.sz/design/shots/\`), and the first pass was built to that drawing. ${THEME_ADDRESS} Its pictures are the canonical set for that address. For the claim that every screen is built as drawn, where it is yours: take a picture of each built screen the way \`sz-eyes web sweep\` does (one browser, every screen at phone size, \`--out\` a folder under the contract's evidence folder) and set it beside its drawing. For every difference in content, order, parts or tokens, read the contract's other claims. Where one of them requires what the built screen has (the words of a form the law gives, a figure its source gives, a control the claim names), the difference stands: write each, with its screen and the claim that requires it, into a file under the contract's evidence folder and name that file as this claim's evidence, because the owner said yes to the drawing and is told where the product leaves it and why. A difference that no claim requires is this claim shown false: name every one with its screen, not the first, because whoever mends them is handed the whole list.`
// A builder sets what it built beside the drawing once before it returns. (2026-11-22: one product's first pass
// was built three times from the same drawing. Twice without this: by one comparison of the words on 27 screen
// states, 79 and 75% of the drawing's lines stood on the built screens in order, and in the second of the two a
// verifier found differences no claim required on 19 of the 27 (dates as 1995-03-08 where 1995년 3월 8일 was
// drawn, a letter's values as input boxes, a step and three buttons nobody drew). Once with it: 82%, and such
// differences on 10. That builder took 70 minutes where the others took 55 and 58. One of the builders without
// it had put its pictures beside the drawings unasked, and named three differences: looking is not what does
// it, writing down every difference and mending each is.) Once, because whoever verifies sets every screen
// beside its drawing anyway. The pictures are taken at the end: the ones under early/ are of the one path, from
// before the rest existed. What another claim requires is not mended toward the drawing (mending the words of a
// statutory form to the drawing's would have been the fault) and is returned under "unlike", which the run logs
// and returns; whether a claim does require it is judged by whoever verifies, not on the builder's word.
const BESIDE_DRAWING = ` Then, once, set what you built beside its drawing. ${THEME_ADDRESS} Use the canonical pictures for that address as the reference. Take a picture of every state the drawing has (\`.sz/design/sweep.txt\` lists them, a picture of each is under \`.sz/design/shots/\`; a sheet of the drawing's own parts is not a screen of the product) on the product as it now stands, at phone size, into the contract's evidence folder under \`built/\`, and read each beside its drawing. Write down every difference in content, order, parts or tokens, with its screen. A difference that comes from a part or a token is mended at the part, so that it is right on every screen made of it. A difference that another claim requires (the words of a form the law gives, a figure a rule works out) is not mended toward the drawing: it stays, and you return it under "unlike" with the claim that requires it, because the drawing is the owner's and so is the choice between the two. Mend the rest and take those pictures again. Do not set them beside the drawing a second time: whoever verifies does, and this look is to hand them fewer differences, not to prove the claim.`
const LEFT_OPEN = ` If there was a dive, ${BRIEF} Where its brief lists 비워 둘 것, carry the designer's choices from \`.sz/design/direction.md\` and the builder's earlier choices from \`.sz/map.md\`. Decide the input, timing and implementation still open for this milestone within each constraint. For each choice, write one line with the decision and its reason in \`.sz/map.md\`. What the brief filled is not yours to change: where it cannot be built as it says, stop and say so under "blocked".`
const FIRST = `This milestone is the product's first pass: all of it, in one stretch, by you. Work in this order. The look first${toDrawing ? DRAWN_BUILD : ' (load `sz:taste`: colour, type and spacing settled once, as names every screen uses).'} The frame: how a person gets from one area to another, and the shapes of everything that will be stored. Then the one thing the product is for, to the quality it will be used at. When that path works: start the product, write the command that starts it into \`.sz/map.md\`, put a picture of each of its screens at phone size into the contract's evidence folder under \`early/\`, and commit with a message that begins \"look:\". The owner may open it from then on, before anything else exists. Then every other area, each to its claims. Work down the claims, and run each flow as you finish what it shows. Before you return, fill every field with the longest value the spec allows and look at every screen at phone size (\`sz-eyes web look <address> --size phone\` says what is cut off, what scrolls sideways and what is too small to press): mend it wherever the same thing is shown, not on the one screen where you saw it.${toDrawing ? BESIDE_DRAWING : ''} Do not stop to report in between: you are done when every claim's own check passes and the product has run in front of you.
`
// A milestone shown on a simulator is built so that its flows can be written: a flow presses a field by its id.
// (2026-11-19: no field of a phone app had one. The verifier's flow pressed each by its words, Maestro pressed
// the label beside it, and what was typed went nowhere in five fields of six: the claim stayed unchecked.)
const onDevice = (m) => (m.claims || []).some((c) => onASimulator(c))
// What a milestone has taken on the disk, measured, in gigabytes: about 16 where an app is built for a phone
// (2026-11-21: what the build wrote 7.1, installed dependencies 1.9, an Android build 0.9, evidence 2.5, its
// repository 2.1), about 3 where none is (2026-11-22: 6 over two milestones of a web product and a fix), about 1
// for one an earlier run built that is only started and looked at. With less than that free nothing is started:
// a disk that fills stops everything on the machine, the owner's other work with it. (2026-11-21: 145 MB were
// left an hour into a build, and the machine's containers stopped, the owner's seven among them.) With less than
// twice that, the milestone is started and whoever builds is told to ask the disk before a step that writes much.
const TAKES = (m, resumed) => (resumed ? 1 : onDevice(m) ? 16 : 3)
const HANDLES = ' This milestone is shown on a simulator, by flows that whoever verifies writes: give every field a person types into a `testID`, and everything a person presses that has no words of its own (an icon, a picture). A flow presses a field by its id; by its words Maestro may press the label beside it, and what is typed goes nowhere. `sz-eyes ios look <the simulator\'s id>` on a screen lists its fields and says which have no id: run it on each screen with a field before you return.'
// What a claim costs to show, in tests' worth: a flow is written and run against the product, a look is pictures
// set beside drawings, and one that says something of every screen costs a flow more. One shown on a
// simulator costs several of a browser's while its flow is still to be written: the app is installed, every step
// waits on the device, and the flow is written in the device's own driver. Written, it costs its run.
// (2026-11-19: three flows on a simulator were weighed as three in a browser and went to one verifier, who took
// 144 minutes, 55 to 85 a flow; the other verifier, with two browser flows and a command, took 40.)
const EVERY_SCREEN = /every screen|all (the )?screens|each screen|\d+ screens|모든 화면|화면마다|각 화면|화면 \d+개|\d+\s*개 화면|\d+\s*화면/i
const ON_A_DEVICE = /simulator|emulator|maestro|시뮬레이터|에뮬레이터/i
const onASimulator = (c) => (c.kind === 'flow' || c.kind === 'look') && ON_A_DEVICE.test(`${c.says || ''} ${c.ref || ''}`)
const weightOf = (c, written = false) => {
  if (c.kind === 'owner') return 0
  if (c.kind !== 'flow' && c.kind !== 'look') return 1
  const one = onASimulator(c) ? (written ? 4 : 10) : 3
  return EVERY_SCREEN.test(String(c.says || '')) ? one + 3 : one
}
// Claims shown by one check are shared as one: the check is written once, by one verifier, and costs what its
// heaviest claim does. (2026-11-19: a flow's two claims went to two verifiers at a look after a fix, and both ran
// it; at a first look both would have been told to write the same file.)
const unitsOf = (claims, written) => {
  const units = []
  const at = new Map()
  for (const c of claims) {
    const ref = String(c.ref || '').trim()
    const key = c.kind === 'owner' || ref === '' ? null : `${c.kind}:${ref}`
    if (key !== null && at.has(key)) {
      const unit = units[at.get(key)]
      unit.ids.push(c.id)
      unit.cost = Math.max(unit.cost, weightOf(c, written))
      unit.device = unit.device || onASimulator(c)
      continue
    }
    if (key !== null) at.set(key, units.length)
    units.push({ ids: [c.id], cost: weightOf(c, written), device: onASimulator(c) })
  }
  return units
}
const costOf = (units) => units.reduce((sum, u) => sum + u.cost, 0)
// Units in their order, cut where the running cost is nearest to an even share.
const cut = (units, shares) => {
  const total = costOf(units)
  const parts = []
  let from = 0
  let sum = 0
  for (let k = 1; k < shares && from < units.length; k++) {
    const aim = (total * k) / shares
    let to = from
    while (to < units.length && (to === from || Math.abs(sum + units[to].cost - aim) <= Math.abs(sum - aim))) sum += units[to++].cost
    parts.push(units.slice(from, to))
    from = to
  }
  if (from < units.length) parts.push(units.slice(from))
  return parts
}
// The claims in the plan's order, shared by what they cost to show: null when one verifier is enough (about four
// flows' worth at a first look), five shares at most. A look after a fix takes twice as much a verifier and three
// at most: the flows are written by then. What is shown on a simulator goes to no more verifiers than the machine
// holds simulators, each of them with one of its own; the rest is shared among the others, who come first (the
// first verifier also shows again what stood before, in a browser). (2026-11-21: three verifiers with four
// simulators between them, each 3.8 GB, and nine stacks, on 24 GB: the swap filled, a simulator took four minutes
// to boot, and the look after a fix took 91 minutes where one verifier had taken 37.)
const sharesOf = (claims, each = 10, most = 5, written = false) => {
  const units = unitsOf(claims, written)
  if (costOf(units) <= each + 2) return null
  const device = units.filter((u) => u.device)
  const rest = units.filter((u) => !u.device)
  let parts
  if (device.length === 0) parts = cut(units, Math.min(most, Math.ceil(costOf(units) / each)))
  else {
    const forDevice = Math.max(1, Math.min(SIMS, most - (rest.length > 0 ? 1 : 0), Math.ceil(costOf(device) / each), device.length))
    const forRest = rest.length === 0 ? 0 : Math.max(1, Math.min(most - forDevice, Math.ceil(costOf(rest) / each)))
    parts = [...cut(rest, forRest), ...cut(device, forDevice)]
  }
  const ids = parts.map((part) => part.flatMap((u) => u.ids))
  return ids.length > 1 ? ids : null
}
// What an earlier run's look recorded, as whoever started the milestone read it from the contract: taken up only
// when it covers every claim and leaves something to mend. Anything else is looked at whole.
const lookedBefore = (looked, claims) => {
  if (!looked || typeof looked !== 'object') return null
  const list = (value) => (Array.isArray(value) ? value.filter(Boolean) : [])
  const known = new Set(claims.map((c) => c.id))
  const refuted = list(looked.refuted).filter((r) => known.has(r.id) && plainWords(r.fact) !== '').map((r) => ({ id: r.id, fact: String(r.fact) }))
  const falseNow = new Set(refuted.map((r) => r.id))
  const proven = list(looked.proven).map(String).filter((id) => known.has(id) && !falseNow.has(id))
  const unchecked = list(looked.unchecked).filter((u) => known.has(u.id) && !falseNow.has(u.id)).map((u) => ({ id: u.id, why: String(u.why || '') }))
  const aside = list(looked.aside).map(String).filter((id) => known.has(id) && !falseNow.has(id))
  const broken = list(looked.broken).filter((b) => plainWords(b.key) !== '').map((b) => ({ key: String(b.key), fact: String(b.fact || '') }))
  const seen = new Set([...proven, ...falseNow, ...unchecked.map((u) => u.id), ...aside])
  if (claims.some((c) => !seen.has(c.id)) || refuted.length + broken.length === 0) return null
  return { proven, refuted, unchecked, aside, broken }
}
async function milestone(m, n, before, where) {
  // A CLI worker starts in the milestone's actual worktree. Claude's Workflow uses PLACE below.
  const runAgent = typeof milestoneAgent === 'function'
    ? (prompt, options) => milestoneAgent(where, m.contractId || m.id, prompt, options)
    : agent
  let stopped = null
  const here = where ? `the folder \`${where}\`` : 'the current folder'
  const PLACE = where
    ? ` This milestone is built beside others, each in a folder of its own. Yours is \`${where}\`: a git worktree of this project on its own branch, already made, with the product's dependencies in place. Do everything there: start every command with \`cd ${where} &&\`, and read and write only files under it (give their whole path). The project's own folder and the other milestones' folders are not yours while this runs: change nothing in them, and do not merge or switch branches. Do not edit \`.sz/map.md\` or \`.sz/spec.md\`: they are corrected when the milestones are brought together. What you launch is yours alone as well: a port of its own for every server and packager (\`sz-eyes port\`), and, if the product runs on a simulator, a simulator of this milestone's own (\`sz-eyes ios spare --name sz-${m.id}\`), never the one the others use; shut it down when you are done (\`sz-eyes ios rest <its id>\`).`
    : ''
  const claims = m.claims.map((c) => `- ${c.id} | ${c.says} | ${c.kind}:${c.ref}`).join('\n')
  const replaces = (m.supersedes || []).map((r) => `- ${r.contract}/${r.claim} | ${r.why}`).join('\n')

  // A milestone an earlier run built is started before anyone looks at it. (One was handed to its verifier with
  // code that had never run: the app's first build was still to be made, the verifier waited on a download for 36
  // minutes, and what kept the app from opening was found later by nobody whose work it was.)
  // What makes it one is that it was built and its contract frozen, not that the plan wrote down how it starts:
  // `launch` is the plan's to leave out, and until 2026-11-26 a milestone without it was built again, and
  // `sz-eyes contract new` refused the id it already had.
  const resumed = Boolean(m.state === 'built' && m.contractId)
  // Nothing is started on a disk it would not fit on.
  const takes = TAKES(m, resumed)
  if (ROOM !== null && ROOM < takes) {
    stopped = `nothing of milestone "${m.title}" was started: the disk the project is on has ${ROOM} GB free, and a milestone ${resumed ? 'that is built and still to be looked at' : onDevice(m) ? 'that builds an app for a phone' : 'like this one'} has taken about ${takes} GB (what it builds, what it installs, its evidence). A disk that fills stops everything else on this machine too. Free room and ask to continue: \`sz-eyes evidence prune <a closed contract>\` removes what no verdict of a closed milestone names, and what a product no longer worked on has built or installed can be made again.`
    log(stopped)
    return { entry: null, stopped }
  }
  const TIGHT = ROOM !== null && ROOM < 2 * takes ? ` The disk this project is on had ${ROOM} GB free when this run last asked, and a milestone like this one has taken about ${takes}. Before a step that writes gigabytes (a build for a phone, an install of dependencies), run \`sz-eyes room\`; if the step would not fit, do not start it: say so under "blocked", with both figures.` : ''
  if (TIGHT) log(`${m.title}: the disk has ${ROOM} GB free and a milestone like this one has taken about ${takes}: it is started, and whoever builds is told to ask before a step that writes gigabytes`)
  const started = !resumed
    ? null
    : await runAgent(
        `A milestone of this product was built by an earlier run and has not been verified to the end. Before anyone looks at it, start it. ${GROUND}${SAND} ${TOOLS}${PLACE}${TIGHT}

Milestone "${m.title}" (${m.id}), contract \`${m.contractId}\` (read it: \`sz-eyes contract show ${m.contractId}\`). ${m.launch ? `It is said to be launched like this: ${m.launch}` : `The plan did not say how it is launched: \`sz-eyes contract show ${m.contractId}\` gives it on the line 띄우는 법 (what its builder said when it stood), and where the contract has no such line, \`.sz/map.md\` says how the product is started.`}

1. Commit what the earlier run left uncommitted, if it belongs to this milestone.
2. Start the product that way and see it running: its first screen in a browser, or for a phone app the build installed and opened on a simulator of your own (\`sz:verify\` says how, and what a first build of a phone app needs).
3. If it does not start, the cause is yours to find and to fix in the product. Do not edit the contract or the flows and tests it froze, and record no verdicts. Commit the fix, and correct \`.sz/map.md\` if how it is launched has changed.
4. If it cannot be started for a reason outside the product (a download that does not arrive, a tool that is not on this machine), do not wait on it: a download or a build that shows nothing new for a minute is stopped, and you say what stopped it under "blocked", with the figure.
5. Say what the contract records of an earlier look. \`sz-eyes contract show ${m.contractId}\` marks every claim: [증명됨] proven, [반증됨] shown false, [확인 못 함] not checked, [주인이 정할 것] set aside for the owner, [아직] nobody has looked. If no claim is marked [아직], return under "looked" the ids under each of the four, with for each claim shown false what was found instead (from its note, in a sentence or two), and under its "broken" each promise of earlier work that \`sz-eyes standing\` lists as broken. If any claim is still [아직], leave "looked" out. You only read them: a verdict is recorded by whoever looks, and that is not you.

Stop what you started, and return the exact command that starts it now.`,
        { label: `start:${m.id}`, phase: 'Build', schema: STARTED, ...effort('build'), ...model('build') },
      )
  const built = resumed ? (started ? { contractId: m.contractId, summary: started.summary || 'built in an earlier run', launch: started.launch || m.launch || '', blocked: started.blocked || '', disputes: m.disputes || [] } : null) : await runAgent(
    `You are building milestone ${n} of ${milestones.length} of a product, with nobody watching. ${GROUND}${SAND} ${TOOLS}${PLACE}${TIGHT}

Milestone "${m.title}" (${m.id}): ${m.builds}
${m.first ? FIRST : ''}${LEFT_OPEN}
Milestones before it:
${before}

Its claims, agreed before you start (id | what will be true | how it is shown):
${claims}
${m.notDoing && m.notDoing.length > 0 ? `Not done in this milestone: ${m.notDoing.join('; ')}` : ''}
${m.risks && m.risks.length > 0 ? `Risks named when it was planned: ${m.risks.join('; ')}` : ''}
${replaces ? `Promises of earlier work that this milestone replaces, because what was asked has changed (contract/claim | why):\n${replaces}` : ''}

${UNREAL(m)}

What earlier work proved still stands (\`sz-eyes standing\` lists it), except what is named above as replaced: this milestone keeps all of it true. A flow or test from earlier work that fails after your change means the product is wrong, not the check.

Do this, in order:
1. Record the contract: \`sz-eyes contract new ${m.id} --lane M --request "<the milestone in a sentence, in the owner's language>" --target <web|ios|...> --claim "<id>|<says>|<kind>:<ref>" ...\` with exactly the claims above, plus \`--not\` and \`--risk\` for the lines above${replaces ? ', and `--supersedes "<contract>/<claim>|<why>"` for each promise it replaces' : ''}.
${FIRST_STEPS(m, replaces)}${m.first ? '' : ' If a claim is wrong about what was asked, build what you can and say which claim and why in "summary", not under "blocked": what is written there stops the run before anyone looks at a milestone that stands, and a claim that cannot be true is ruled on when it is shown false.'}
4. ${m.first && toDrawing ? 'Build the milestone, each screen as drawn (`sz:taste` only for what the drawing leaves open).' : 'Build the milestone. For anything a person looks at, load `sz:taste` first; and where the product\'s screens were drawn before it was built (`.sz/design/direction.md` is there), the look is the one drawn: a new or changed screen is made of that file\'s tokens and parts (its last section, 빌더에게, lists them), and `sz:taste` is for what it leaves open.'} If it changes the shape of what is stored, it carries over what is already there (on start, or by a command the map names): data written by the version before must still open. Run the project's checks (type check, tests, the flows of earlier milestones) as you go and leave them passing.
5. Start the product yourself with one command and see it running before you return: its first screen in a browser, or for a phone app the build installed and opened on a simulator of your own (\`sz:verify\` says how, and what a first build of a phone app needs).${onDevice(m) ? HANDLES : ''} Say exactly which command, and where it is seen. Then say that it stands: \`sz-eyes contract built ${m.id} --launch "<that command, and where it is seen>"\` (from then on the owner can be shown the product while it is verified). A milestone that has never run is not built: what stops it from starting is yours to fix here, not the verifier's to find. If it cannot be started for a reason outside the product (a download that does not arrive, a tool that is not on this machine), do not wait on it (a download or a build that shows nothing new for a minute is stopped) and say what stopped it under "blocked". ${where ? 'If this milestone changed how it is launched, say so in "summary" (the map is corrected when the milestones are brought together).' : 'If this milestone changed how it is launched, correct \`.sz/map.md\`.'}
6. Commit the work on the current branch with a message that says what the milestone built.

Do not judge your own claims and do not record verdicts: someone who did not build this will operate it. Do not leave a server running.`,
    { label: `build:${m.id}`, phase: 'Build', schema: BUILT, ...effort('build'), ...model('build') },
  )
  // A builder that found something cannot be made real stopped there: nobody verifies an example in its place.
  const unreal = !resumed && built && Array.isArray(built.notReal) ? built.notReal.filter((e) => e && plainWords(e.what) !== '') : []
  if (unreal.length > 0) {
    const list = unreal.map((e) => asNeed(e, '', m.id))
    needed.push(...list)
    stopped = `milestone "${m.title}" stopped on what cannot be made real with what is at hand, and nothing was made an example in its place: ${list.map((n) => `[${needLine(n)}]`).join(' ')} ${ASK}`
    log(stopped)
    return { entry: null, stopped }
  }
  if (!built || (built.blocked && built.blocked.trim() !== '')) {
    stopped = `milestone "${m.title}" ${resumed ? 'was built by an earlier run and could not be started' : 'could not be built'}: ${built ? built.blocked : 'the builder did not answer'}${built ? '. If what stopped it is outside the product, tell the owner what it is and ask how to get past it: that is theirs to choose.' : ''}`
    log(stopped)
    return { entry: null, stopped }
  }

  // It stands: the owner can look while it is verified. (A first pass stood at 21:07 and closed at 00:39.)
  if (!resumed) log(`BUILT: "${m.title}" stands and is being verified. It can be looked at now: ${built.launch}`)
  // What a builder left unlike the drawing because another claim requires it is the owner's to choose between:
  // it is said when the milestone stands, and again in what the run returns.
  const line = (text) => String(text || '').replace(/\s+/g, ' ').trim()
  const unlike = !resumed && Array.isArray(built.unlike) ? built.unlike.filter((u) => u && line(u.screen) !== '' && line(u.claim) !== '') : []
  if (unlike.length > 0) log(`${unlike.length} screen(s) left unlike the drawing because another claim requires it: ${unlike.map((u) => `[${line(u.screen)} (${line(u.claim)}): ${line(u.differs)}]`).join(' ')}`)
  const left = unlike.length > 0 ? { unlike } : {}

  // A frozen check the builder says is itself wrong goes to someone who neither built nor judges: the arbiter
  // corrects how it checks, never what it checks, and writes the correction into the contract. (The first real
  // run stopped here for good: a check its builder had written with a quoting error could be fixed by nobody.)
  // All of a milestone's disputes go to one arbiter in one sitting: what the checks need is started once, and what
  // one check showed about the machine is known for the next. (2026-11-18: eleven disputes went to eleven arbiters
  // one after another for 75 minutes, each starting the product again, three in a row stopped by the same tip of
  // Safari's; and a fault one of them corrected in one flow was left in another that called the same helper.)
  const disputes = (built.disputes || []).filter((d) => d && plainWords(d.file) !== '')
  if (disputes.length > 0) {
    const many = disputes.length > 1
    await runAgent(
      `Settle ${many ? `${disputes.length} disputes about frozen checks` : 'a dispute about a frozen check'}, met while building contract \`${built.contractId}\` in the project in ${here}.${PLACE} ${many ? 'The files, each with what the builder says is wrong with it' : 'The file, with what the builder says is wrong with it'}:
${disputes.map((d) => `- \`${d.file}\`: ${d.problem}`).join('\n')}
${many ? 'Each' : 'It'} was frozen by that contract or by an earlier one that is closed: the contracts under \`.sz/contracts/\` say which, and a correction is recorded on the contract that froze it. The product is launched like this: ${built.launch}.${many ? ' Start what they need once (the product, a simulator of your own) and settle them one after another on it; stop it when you are done.' : ''} Decide ${many ? 'for each ' : ''}which it is (the check, the product, the claim, or a claim that what the owner asked later has replaced), act as your instructions say for that case, and return what you decided${many ? ' for each' : ''}. Where a check is wrong in a way the project's other frozen checks share (a helper called the same way, the same quoting), those are yours to correct too, though nobody disputed them: correct each the same way and record each with \`sz-eyes contract amend\`, and name them in what you return.`,
      { label: `arbiter:${m.id}`, phase: 'Build', agentType: 'sz:arbiter', ...effort('verify'), schema: { type: 'object', properties: { rulings: { type: 'array', items: { type: 'object', properties: { file: { type: 'string' }, which: { type: 'string', enum: ['check', 'product', 'claim', 'replaced'] }, changed: { type: 'string' }, now: { type: 'string' } }, required: ['file', 'which', 'now'] } } }, required: ['rulings'] } },
    )
  }

  // The owner watches the run in the workflow view, which shows each of these lines as it is said, above the
  // agents' labels. A look or a fix of half an hour must not be a label nobody can read. (2026-11-26: two looks ran
  // 39 and 43 minutes with nothing said. The owner, watching, asked what "day-true again" was; the session, woken
  // by nothing, had said nothing for 59 minutes.) The lines give no minutes: a workflow script has no clock (asking
  // for the time throws in it, so that a run started again comes out the same), and the view times every agent.
  const tally = (v) => `${v.proven.length} proven, ${v.refuted.length} refuted, ${v.unchecked.length} unchecked${(v.broken || []).length > 0 ? `, ${v.broken.length} promise(s) of earlier work broken` : ''}${Array.isArray(v.noticed) && v.noticed.length > 0 ? `, ${v.noticed.length} noticed outside the claims` : ''}`
  // A verifier's line counts the claims that were its own to look at: what it says of another's is not taken.
  const shareOf = (v, part) => ({ ...v, proven: v.proven.filter((id) => part.includes(id)), refuted: v.refuted.filter((r) => part.includes(r.id)), unchecked: v.unchecked.filter((u) => part.includes(u.id)) })
  const claimIds = new Set(m.claims.map((c) => c.id))
  // Claims a verifier marks as shown false by one cause (sameAs) are one mend, one ruling and one count toward the
  // two fixes a claim gets. A name that is no claim of this contract, or the claim itself, names no cause.
  // (2026-11-26: a tab's address going to the server was claimed by four claims of one contract, each mended and
  // looked at by itself: more than ten fix commits, nineteen looks.) What a look said of a cause stays said: claims
  // once tied are one cause from then on, whichever of them is false now and whichever way round they were named
  // (a verifier writes "the same as the other" under both). A cause is known by the first of its claims in the
  // contract's order, and what was counted and found for either goes with it.
  const causeOf = (r) => (r && typeof r.sameAs === 'string' && r.sameAs !== r.id && claimIds.has(r.sameAs) ? r.sameAs : null)
  const tied = new Map()
  const rootOf = (id) => {
    let at = id
    while (tied.has(at)) at = tied.get(at)
    return at
  }
  const placeOf = (id) => m.claims.findIndex((c) => c.id === id)
  const tie = (refuted) => {
    for (const r of refuted || []) {
      const other = causeOf(r)
      if (other === null) continue
      const [a, b] = [rootOf(r.id), rootOf(other)]
      if (a === b) continue
      const [keep, drop] = placeOf(a) <= placeOf(b) ? [a, b] : [b, a]
      tied.set(drop, keep)
      if (fixes.has(drop)) fixes.set(keep, Math.max(fixes.get(keep) || 0, fixes.get(drop)))
      fixes.delete(drop)
      if (found.has(drop) && !found.has(keep)) found.set(keep, found.get(drop))
      found.delete(drop)
    }
  }
  // The other claims of a claim's cause: the one the cause is known by, and those shown false with it now.
  const sameCause = (r) => {
    const root = rootOf(r.id)
    return [...new Set([...(root === r.id ? [] : [root]), ...(verdict && verdict.refuted ? verdict.refuted : []).filter((o) => o.id !== r.id && rootOf(o.id) === root).map((o) => o.id)])]
  }
  const record = `\`sz-eyes standing record <contract>/<claim> --status holds|broken|unchecked --during ${built.contractId} --note "<what was run and what it showed>"\``
  // again: null for the first look, or what was shown false and has been worked on since.
  const verify = (again, share) =>
    runAgent(
      `Verify contract \`${built.contractId}\` of the project in ${here}.${PLACE}${SAND} The product is launched like this: ${built.launch}. ${
        again
          ? `This is a second look, after a fix. ${again.claims.length > 0 ? `These claims of the contract were shown false before: ${again.claims.join(', ')}. Check each from the start, on the product as it is now, and record it with \`sz-eyes contract claim\`. ${again.claims.some((id) => again.facts && again.facts[id]) ? `What was found then: ${again.claims.filter((id) => again.facts && again.facts[id]).map((id) => `[${id}: ${String(again.facts[id]).slice(0, 600)}]`).join(' ')}. Where that is a case the claim's own check does not walk, the check passing shows nothing of the fix: bring the product to that case again. ` : ''}` : ''}${again.standing.length > 0 ? `These promises of earlier work were found broken: ${again.standing.join(', ')}. Show each again and record it with ${record}. ` : ''}A fix can break a neighbour: ${share ? `show again your other claims, each by its own flow, test or command${share.k === 0 ? ', and what stood before this work (\`sz-eyes standing\`) with the project\'s quick checks (its type check and its tests of pure rule)' : ''}` : 'show again this contract\'s other claims and what stood before (\`sz-eyes standing\`) by the project\'s whole check command run once where it has one, and a flow, test or command by itself only where that run failed or says nothing of a claim'}; flows that would get in each other's way on one copy (one moves the clock, one restarts the backend, one fills the database to its limits) run each on a copy of the product of its own (\`sz-eyes copy\`), at the same time and not one after another; report whatever fails now (a claim of this contract under "refuted", recorded with \`sz-eyes contract claim\`; a promise of earlier work under "broken", recorded as above). New cases are tried at this look only where the fix reached: ${again.claims.length > 0 ? 'on the claims named above as shown false before, and on any other claim of yours' : 'on any claim of yours'} whose screens or rules the fix changed (\`git log --stat\` shows on top what the fix just made changed). A claim that an earlier look proved and that the fix did not reach is shown again by its own check and is not tried with new cases: it had that at the first look, and a piece of work in which every look tries new cases on every claim closes only when a look finds nothing new anywhere. Not every such claim needs even its own check, and this goes before what is said above about showing your other claims again: where the commits since a claim's verdict touch nothing of its own and none of the files every claim leans on, it is not run at all. The contract keeps, for each verdict, the commit the product was at when it was looked at (\`sz-eyes contract show ${built.contractId}\` has it on the line 판정한 커밋), and \`git diff --name-only <that commit>..HEAD\`, run in the project's folder (a copy is not a repository), says what has changed since. Where the diff names none of the files that claim is about (its own check, its screen, its rule, its figure) and none of the shared ones, do not start it: return it under "carried" with its id, the two commits and what the diff named, and its verdict stands as it was. A change to one of these reaches every claim, so the claim is run: the app's entry or router, a module more than one screen uses (anything the map calls shared), a package manifest or a lock file, the build and type-check configuration, a schema or migration, the design's tokens or theme, a setting read everywhere (the environment, the words, the error handler), and the line of \`.sz/map.md\` that says how it is launched. Never carried: a claim with no commit on its verdict, a claim shown false before (the contract says how often), one whose own check is in the diff or is listed in the contract as corrected and not committed (얼린 뒤 고친 검사, 커밋되지 않음: a diff of commits does not see it), and one whose check is the command that runs all of the project's checks (any change to the product or to its tests is a change to what that command runs). When you record a verdict you gave on a copy made at an earlier commit than the project is at now, say which (\`--at <that commit>\`), so that the next comparison starts from what you looked at. Where you cannot tell whether the diff stands near a claim's words, run it. What its own check, or the screen in front of you as you run it, shows wrong is still that claim shown false. Claims you did not look at again keep their verdict: leave them out. A claim about every screen at the product's limits is judged by its flow, at the limits the spec states: an input the product does not accept shows nothing about it. ${again.noticed === null ? 'Under "noticed" return only what you notice that is new.' : `Before the fix, this was noticed outside the claims: ${again.noticed.length > 0 ? again.noticed.map((n) => `[${n}]`).join(' ') : '(nothing)'}. One that lies where the fix did not reach is still so: return it as it is, without walking to it again. Walk again only to those on a screen or in a rule the fix changed, and drop one the fix has ended. Under "noticed" return those that are still so and whatever you notice that is new.`}`
          : `Give every claim a verdict and record each with \`sz-eyes contract claim\`. Then show again what stood before this work (\`sz-eyes standing\`) and record each with ${record}.`
      }${share ? ` You are one of ${share.of} verifiers looking at this contract at the same time. Yours are these claims: ${share.part.join(', ')}. Give a verdict to these and to no other. ${share.k === 0 ? 'You are also the one who shows again what stood before this work.' : 'Do not show again what stood before this work: another verifier does.'} Start a copy of the product of your own, on a port of your own and with a place of its own for what it stores (\`sz-eyes copy <a folder outside the project>\` makes one from what is committed: its files, its installed dependencies, a stack name of its own, and \`--with <path>\` what the map says is built and not in git; the map says how it is launched; never the same database file or folder as another copy)${m.claims.some((c) => onASimulator(c)) ? (m.claims.some((c) => share.part.includes(c.id) && onASimulator(c)) ? ` and, for your claims that are shown on a simulator, one simulator of your own (\`sz-eyes ios spare --name sz-${m.id}-${share.k + 1}\`; rest it when you are done, \`sz-eyes ios rest <its id>\`). One and no more: this machine holds ${SIMS} at once, and with more up every one of them crawls` : `. None of your claims is shown on a simulator: take none (this machine holds ${SIMS} at once, and ${SIMS === 1 ? 'it is another verifier\'s' : 'they are the other verifiers\''})`) : ' and, if it runs on a simulator, a simulator of your own (\`sz-eyes ios spare --name sz-' + m.id + '-' + (share.k + 1) + '\`)'}, and stop what you started when you are done: a server by its process id, then the copy with \`sz-eyes copy <its folder> --end\`, which stops its stack before the folder goes (never remove a copy's folder yourself).` : ''}${again ? '' : WRITE_FLOWS(built.contractId)}${m.first && toDrawing ? AS_DRAWN : ''}${REAL_LOOK(m)} I am telling you nothing about whether any claim is true. A claim's figures are one case of what it is about: when you try another case and the product is wrong about the same thing (an answer its own rule or source does not give, something untrue of what the person put in, a count of what does not count), that claim is \`refuted\` with your case as the fact, though its own check passes; it is not something noticed, which nobody mends before this work closes. A claim is shown false on the product: running with its own parts, on the machines the spec says it is for. This machine is one of them only if the spec says so: where the product is for people's phones or a smaller server, a state a slower machine of those comes to is one the product comes to, though this one is too fast to show it. A case is the claim's when the product comes to it by what a person puts in or does (any input, any order, any moment, however hard and however many tries; and whatever can be sent to the product from outside is what a person puts in, though its own screens never send it: a request made straight to its server, an address typed by hand, a file handed to it) or by what happens around it (the clock reaching a day, load, a network that drops, a forced quit, the power going); a seam or a stand-in is a fair way to bring such a state about sooner (a clock set to that day, a server made slow). It is not the claim's when you could make it only by giving a part of the product a behaviour it does not have there (a detector made 150 times slower than it runs), or by handing its inner code what its own parts never hand it, and you could not bring the running product to it: that shows what the code would do, not what the product does. Try to bring the running product there before you decide. Where you cannot, and no claim of this contract and no promise \`sz-eyes standing\` lists names that state, the case is outside the contract: worth knowing, and not a claim shown false. Record it with \`sz-eyes contract notice ${built.contractId} "<the case; how you made it; what the code did; what you tried on the running product and the figure that shows it does not get there>"\`, naming in it the claim it is nearest, and give that claim the verdict its own check and your other cases show. It keeps nothing open and nobody mends it before this close: the owner decides whether it becomes a claim. This is not a way to pass a claim: when in doubt, the case is the claim's and the claim is \`refuted\`. Record what you notice that no claim is about with \`sz-eyes contract notice\`, stop any server you start, and return the verdicts: under "broken" every promise of earlier work that does not hold now, under "held" every one you showed again that holds. Under each claim you show false, "sameAs" names another claim of this contract shown false by the same cause (the same function, the same rule, the same words leaving the same crack), where that is what you found: one cause is one mend, and claims mended one at a time for one cause are how a day goes on it. Where the cause is this claim's alone, leave it out. A claim is still shown false either way.`,
      { ...(share ? { claims: share.part } : {}), label: `verify:${m.id}${again ? ':again' : ''}${share ? `:${share.k + 1}of${share.of}` : ''}`, phase: 'Verify', agentType: 'sz:verifier', schema: VERDICT, ...effort('verify') },
    )
  // A milestone with much to show, its flows still to be written, is looked at by up to five verifiers at once,
  // each with claims of its own and a copy of the product of its own. The fix waits for the slowest of them, so
  // the shares go by what the claims cost to show and keep the plan's order (claims of one area stay with one
  // verifier). (2026-11-17: twenty claims cut in three by their count gave one verifier seven flows and 74
  // minutes and the others 45 and 61; one verifier alone had taken 17 minutes over 19 claims with flows written.)
  const lookTogether = async () => {
    const parts = sharesOf(m.claims)
    log(`${m.title}: the first look begins: ${m.claims.length} claim(s), shown on the running product by ${parts ? `${parts.length} verifiers side by side` : 'one verifier'} who did not build it`)
    if (!parts) return verify(null)
    const looks = await beside(parts.map((part, k) => async () => {
      const look = await verify(null, { part, k, of: parts.length })
      log(`${m.title}: verifier ${k + 1} of ${parts.length} is back: ${look ? tally(shareOf(look, part)) : 'no answer'}`)
      return look
    }))
    if (looks.every((look) => !look)) return null
    const all = { proven: [], refuted: [], unchecked: [], broken: [], held: [], noticed: [], stood: undefined, sandbox: '' }
    looks.forEach((look, k) => {
      const mine = new Set(parts[k])
      if (!look) { parts[k].forEach((id) => all.unchecked.push({ id, why: 'the verifier that had this claim did not answer' })); return }
      all.proven.push(...look.proven.filter((id) => mine.has(id)))
      all.refuted.push(...look.refuted.filter((r) => mine.has(r.id)))
      all.unchecked.push(...look.unchecked.filter((u) => mine.has(u.id)))
      // A claim a verifier was given and said nothing about has not been looked at.
      for (const id of parts[k]) if (!look.proven.includes(id) && !look.refuted.some((r) => r.id === id) && !look.unchecked.some((u) => u.id === id)) all.unchecked.push({ id, why: 'its verifier gave no verdict' })
      all.broken.push(...(look.broken || []))
      all.held.push(...(look.held || []))
      all.noticed.push(...(look.noticed || []))
      if (look.stood !== undefined) all.stood = look.stood
      if (!all.sandbox && (look.sandbox || '').trim() !== '') all.sandbox = look.sandbox
    })
    return all
  }
  // New cases are tried on every claim at the first look, and after a fix only where the fix reached. (2026-11-23:
  // every look tried new cases on every claim. A first pass's third look left one claim false; its fourth found
  // three: a claim the third had proven, broken by a case nobody had tried; a new case of the one just mended; a
  // fault the third fix had put in. All three were real, and the pass ended open after 297 minutes, as the one
  // before it had after 304. With twenty claims each tried anew at every look, the look that finds nothing new
  // anywhere may never come within four fixes. The owner chose the bound: one hunt a claim, and another on what
  // a fix touches. What it costs is known: a fault that only a later hunt would have found is not found in this
  // piece of work.) What a claim's own check or its screen shows wrong is that claim shown false at any look.
  // What was noticed before goes the same way: only what lies where the fix reached is walked to again. (Tried on
  // that run's state after its third fix, 2026-11-23: the verifier handed this bound showed its seven claims by
  // their own checks in 11 minutes where the run's had taken 21 and broken a claim the fix had not touched; both
  // walked again to all sixteen things noticed earlier, five to seven minutes, though the fix had reached none.)
  // The look after a fix is shared as well, by fewer: each verifier checks from the start what was mended among
  // its claims and shows its other claims again by their own checks, and the first also shows what stood before
  // and is handed what was noticed. A claim nobody looked at again keeps its verdict, as with one verifier.
  // (2026-11-18: one verifier took 33 minutes over 17 claims at this look, with the fix waiting behind it.)
  const lookAgain = async (again) => {
    const parts = sharesOf(m.claims, 20, 3, true)
    log(`${m.title}: every claim is shown again on the product as the fix leaves it${parts ? `, by ${parts.length} verifiers side by side` : ''}${again.claims.length > 0 ? ` (from the start: ${again.claims.join(', ')})` : ''}`)
    if (!parts) return verify(again)
    const looks = await beside(parts.map((part, k) => async () => {
      const look = await verify({ claims: again.claims.filter((id) => part.includes(id)), facts: again.facts, standing: k === 0 ? again.standing : [], noticed: k === 0 ? again.noticed : null }, { part, k, of: parts.length })
      log(`${m.title}: after the fix, verifier ${k + 1} of ${parts.length} is back: ${look ? tally(shareOf(look, part)) : 'no answer'}`)
      return look
    }))
    if (looks.every((look) => !look)) return null
    const all = { proven: [], refuted: [], unchecked: [], broken: [], held: [], noticed: undefined, stood: undefined, carried: [] }
    looks.forEach((look, k) => {
      if (!look) return
      const mine = new Set(parts[k])
      all.proven.push(...look.proven.filter((id) => mine.has(id)))
      all.refuted.push(...look.refuted.filter((r) => mine.has(r.id)))
      all.unchecked.push(...look.unchecked.filter((u) => mine.has(u.id)))
      all.broken.push(...(look.broken || []))
      all.held.push(...(look.held || []))
      all.carried.push(...(look.carried || []).filter((c) => c && mine.has(c.id)))
      if (look.stood !== undefined) all.stood = look.stood
    })
    // What was noticed before is the first verifier's to carry on; the others add only what is new.
    const added = looks.slice(1).flatMap((look) => (look && look.noticed) || [])
    all.noticed = looks[0] && looks[0].noticed !== undefined ? [...looks[0].noticed, ...added] : added.length > 0 ? [...(again.noticed || []), ...added] : undefined
    return all
  }
  // A milestone an earlier run looked at whole and left with claims shown false is taken up at the fix: what was
  // shown false is mended, and every claim is shown again after it, as after any fix. (2026-11-19: a first pass
  // stopped with two of twenty claims shown false; to go on, it would have been looked at whole again by five
  // verifiers, three quarters of an hour, before anyone mended the two.)
  const earlier = resumed && started ? lookedBefore(started.looked, m.claims) : null
  if (earlier) log(`${m.title}: an earlier run looked at all of it and left ${earlier.refuted.length} claim(s) shown false${earlier.broken.length > 0 ? ` and ${earlier.broken.length} promise(s) of earlier work broken` : ''} (${[...earlier.refuted.map((r) => r.id), ...earlier.broken.map((b) => b.key)].join(', ')}): those are mended first, and every claim is shown again after the fix`)
  // noticed: null = what that look noticed is in the contract and was not handed on; whoever looks next adds what is new.
  let verdict = earlier ? { proven: earlier.proven, refuted: earlier.refuted, unchecked: earlier.unchecked, broken: earlier.broken, held: [], noticed: null, stood: undefined, sandbox: '' } : await lookTogether()
  if (!earlier && verdict) log(`${m.title}: the first look is back: ${tally(verdict)}`)
  // A claim can be false because its own words are wrong: it repeats a fact about the world that the source
  // gives otherwise. No fix makes it true, and only the owner may change what was agreed. It is set aside for
  // them by someone who built nothing, with where the fact is read, and the work goes on. (Two of four runs on
  // one request stopped for the night on one such claim each; one of them had tried to fix the product twice.)
  // What the last ruling did, for the loop and for the stop: whether anyone answered, and how many frozen checks it corrected.
  let ruledLast = null
  let correctedLast = 0
  const setAside = earlier ? earlier.aside.map((id) => ({ id, ruling: 'set aside for the owner by an earlier run: the contract has the ruling' })) : []
  const rule = async (unfixed) => {
    // After a fix, only what the fixer says cannot be made true is ruled on: the claims it mended are looked at
    // again by a verifier in any case. (Handed all three claims shown false, the arbiter ran the flows of the two
    // just mended: 8 of its 16 minutes, 2026-11-18.) A line that names no claim leaves all of them to rule on.
    const said = unfixed.join('\n')
    const begins = (id, text) => new RegExp(`^[\\s\\-*\`"'(]*${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w-])`).test(text)
    const idOf = (text) => (verdict.refuted.find((r) => begins(r.id, text)) || {}).id
    // A line may also be about the frozen check of a claim that was not shown false: the fix changed, by a source
    // or by the drawing, words that this check presses or reads. It names its claim, and hands no other to rule on.
    const named = unfixed.map((text) => idOf(text) || [...claimIds].find((id) => begins(id, text)))
    if (verdict.refuted.length === 0 && !named.some(Boolean)) return
    const narrowed = unfixed.length > 0 && named.every(Boolean)
    const open = narrowed ? verdict.refuted.filter((r) => named.includes(r.id)) : verdict.refuted
    const ruled = await runAgent(
      `Claims of contract \`${built.contractId}\` of the project in ${here} were shown false on the running product by someone who did not build it.${PLACE}${SAND} ${TOOLS} The product is launched like this: ${built.launch}.

The claims shown false, each with what happened instead:
${open.length > 0 ? open.map((r) => `- ${r.id}: ${r.fact}${sameCause(r).length > 0 ? ` (the same cause as ${sameCause(r).join(', ')}: rule the cause once, and say for each claim which it is)` : ''}`).join('\n') : 'None of the claims shown false is yours to decide this time: what follows is about frozen checks that now press or read an old form.'}
${said ? `What the one who was fixing them said it could not make true, or was not its to touch (each line begins with the claim it is about):\n${said}` : ''}
${narrowed && open.length < verdict.refuted.length ? 'The other claims shown false at that look were mended and are looked at again after you: they are not yours to check, and their flows are not yours to run.' : ''}

For each, decide which it is. You built nothing and you take nobody's word: read the contract (\`sz-eyes contract show ${built.contractId}\`), look at the product, and open the source yourself. Claims shown false by one cause are one question about the product and one mend: rule the cause, and say for each claim which case it is. A ruling that calls it three faults is how one crack is mended three times.
- **The product is wrong.** It can do what the claim says and does not. Leave the claim as it is: this is the common case, and when in doubt it is this one.
- **The claim's own words are wrong.** They state as true a fact about the world (a limit, a price, a rule of somebody else's service) that its own source gives otherwise, or something that cannot be true together with another claim, and the product follows the source. Then record it, and change nothing else: \`sz-eyes contract dispute ${built.contractId} <claim id> --ruling "<what the claim says; what is so; where that is read: the address and the sentence>"\`. The claim's words stay as they were agreed, and the owner decides. Or the claim's own figure, or a frozen test or flow it is shown by, asks for an answer its source refuses and the product gives that answer: then no product is right by both, and which reading holds is the owner's to say. Record it the same way, with the file and the case beside the source's sentence.
- **A frozen flow or test stops for a reason that is not its claim's.** The product was mended to follow a claim's source or the drawing it is held to, and the check still presses, reads or waits for the old words, an old label or an old selector, or asserts text its claim never mentions. Such a check asks the product for no answer of its claim's: it stops on the way there, and a claim sent to the owner for that sends them a word to choose that the source or their own drawing has chosen already. Open the source, or the drawing (\`.sz/design/\`), and see for yourself that the product's new form is the one it gives. Then correct how it presses or reads, by the smallest change and as your own rules say (never a figure or an outcome it expects, a condition, a step its claim requires, or a failure into a pass), record it (\`sz-eyes contract amend ${built.contractId} --file <the file> --why "<what the mend changed in the product, by which source or drawing, and what you changed in the check>"\`), which also commits that check and the contract together and nothing else (read what it says: where it says the commit did not happen, that is yours to settle here), and run it once. A claim whose check you corrected is not set aside: return it under "corrected" with the file and what you changed, and whoever looks next runs it. Where the check could pass only by expecting something else (another figure, another outcome, a step fewer), this is not that case: it is one of the two above.
- **The case was not the claim's.** The claim's own check walks its case and passes in front of you, and every case you were handed against it is one its finder could make only by giving a part of the product a behaviour it does not have on the machines it is for (a detector slowed far past how it runs there), or by handing its inner code what its own parts never hand it, and could not bring the running product to. A request anyone can send to the product from outside (to its server, by an address, in a file) is not inner code: it is what a person puts in, though the product's own screens never send it. And the machines it is for are the ones the spec names, not this one: where a slower or smaller machine of those would come to the state, the product comes to it. See for yourself that the product does not get there: read how that part runs, measure it, and try what a person or the machine around it can do (other input, load, a forced quit, the power going). If it does not, and no claim of this contract and no promise \`sz-eyes standing\` lists names that state, the case shows what the code would do, not the product wrong about its claim. Record the case as a notice (\`sz-eyes contract notice ${built.contractId} "<the case; how it was made; what the code did; what shows the running product does not get there>"\`), record the claim by what its own check showed (\`sz-eyes contract claim ${built.contractId} <claim id> --status proven --note "<what its check showed in front of you, and that the case it was shown false by is one the running product does not come to: it is in the notices>"\`), and return it under "notTheClaim". This is not a way to pass a claim: where one of the cases is what a person or the world around the product brings about, or you got the product there yourself, the product is wrong and the claim stays as it is. When in doubt, the product is wrong. One ruling a claim: a claim you set aside for the owner is not given back as well.

Change no product code and no claim's words, and no flow or test except as the third case says. Return what you decided for each.`,
      { label: `rule:${m.id}${said ? '' : ':last'}`, phase: 'Verify', agentType: 'sz:arbiter', ...effort('verify'), schema: { type: 'object', properties: { disputed: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, ruling: { type: 'string', description: 'what the claim says, what is so, and where that is read' } }, required: ['id', 'ruling'] } }, productWrong: { type: 'array', items: { type: 'string' } }, corrected: { type: 'array', description: 'frozen checks corrected in how they press or read, one entry a file', items: { type: 'object', properties: { id: { type: 'string', description: 'the claim the check shows' }, file: { type: 'string' }, changed: { type: 'string', description: 'the line, the old form and the new' } }, required: ['id', 'file', 'changed'] } }, notTheClaim: { type: 'array', description: 'claims whose own check passed in front of you and that were shown false only by a case the running product does not come to', items: { type: 'object', properties: { id: { type: 'string' }, why: { type: 'string', description: 'the case, how it was made, and what shows the running product does not get there' } }, required: ['id', 'why'] } } }, required: ['disputed'] } },
    )
    // A corrected check is in the contract (`sz-eyes contract amend`) and committed; its claim keeps the verdict
    // it had and is shown again at the next look, by the check as corrected.
    ruledLast = Boolean(ruled)
    correctedLast = ((ruled && ruled.corrected) || []).filter((c) => c && claimIds.has(c.id)).length
    for (const c of ((ruled && ruled.corrected) || []).filter((c) => c && claimIds.has(c.id))) log(`${m.title}: the check ${line(c.file)} of claim "${c.id}" was corrected in how it presses or reads, not in what it expects: ${line(c.changed).slice(0, 200)}`)
    const aside = ((ruled && ruled.disputed) || []).filter((d) => open.some((r) => r.id === d.id))
    // A verdict given over a case the running product does not come to was not that claim's. Whoever ruled has
    // recorded the claim by its own check and the case as a notice; here the claim leaves the fix loop. Only what
    // was handed to it this time (`open`) can be given back, and a claim it also set aside waits for the owner.
    // (2026-11-26: three looks showed one claim false by cases made in the product's engine with its speech
    // detector slowed as it never is on that machine, the verifier writing each time that the running app could
    // not be brought there. Two fixes went into a path the product does not take, the third look found a fault
    // the first fix had put in, the last ruling found the product wrong, and the milestone stayed open.)
    const notTheirs = ((ruled && ruled.notTheClaim) || []).filter((d) => d && open.some((r) => r.id === d.id) && !aside.some((s) => s.id === d.id))
    const left = open.filter((r) => !aside.some((d) => d.id === r.id) && !notTheirs.some((d) => d.id === r.id))
    if (left.length > 0) log(`${m.title}: ${ruled ? 'the ruling leaves' : 'nobody ruled (no answer), which leaves'} ${left.length} claim(s) shown false: ${left.map((r) => r.id).join(', ')}`)
    if (notTheirs.length > 0) {
      const given = (id) => notTheirs.some((d) => d.id === id)
      verdict = {
        ...verdict,
        proven: [...new Set([...verdict.proven, ...notTheirs.map((d) => d.id)])],
        refuted: verdict.refuted.filter((r) => !given(r.id)),
        unchecked: verdict.unchecked.filter((u) => !given(u.id)),
        // null: what was noticed is in the contract and was not handed on; whoever ruled has written this there too.
        noticed: verdict.noticed === null ? null : [...(verdict.noticed || []), ...notTheirs.map((d) => `${d.id}: ${line(d.why)}`)],
      }
      for (const d of notTheirs) log(`${m.title}: claim "${d.id}" stands by its own check: the case it was shown false by is one the running product does not come to (${line(d.why).slice(0, 200)}). It is recorded as noticed and goes to .sz/backlog.md when the contract closes`)
    }
    if (aside.length === 0) return
    setAside.push(...aside)
    verdict = { ...verdict, refuted: verdict.refuted.filter((r) => !aside.some((d) => d.id === r.id)) }
    for (const d of aside) log(`${m.title}: claim "${d.id}" is set aside for the owner (its words are wrong, not the product): ${d.ruling.slice(0, 200)}`)
  }
  // A check frozen on the product as it was first built can hold a mend back for a word. (2026-11-23: a first
  // pass's screen said "30일 넘게" where the law's table says "30일 이상". The fixer mended the screen; the flow a
  // verifier had written at the first look pressed the old words and stopped at step 151; whoever ruled could
  // change no flow, and the claim went to the owner to choose a word the law had chosen. Flows written the same
  // way held four screens away from the drawing, and the claim that every screen is as drawn was set aside with
  // them.) So whoever fixes mends to the source or the drawing and names each frozen check that now presses or
  // reads the old form, and whoever rules corrects that in the check, under the limits its own rules set (how a
  // check checks, never what it expects), records it in the contract and commits it. The claim is looked at again.
  // A fixer may not touch a frozen check, and until 2026-11-22 had nothing to say when one was wrong about its
  // claim's source. (A first pass's rule test, written by its builder before the code and frozen with the
  // contract, expected "meets the rule" for two months of partial arrears that are not in a row; the ministry's
  // answer that the screen cites refuses exactly that, and the claim's own example added such days into its 77.
  // Two fixers kept the test passing and noted the conflict in passing; each look found the product wrong by the
  // source in another case; the last ruling found the product wrong; the milestone stayed open at 304 minutes
  // and nobody had ruled on the test.) Now whoever fixes puts such a claim under "notFixed" with the check, the
  // case and the source's sentence, and whoever rules may set it aside for the owner as it does a claim whose
  // own words are wrong: which reading of a law holds is theirs to say, not a fixer's and not a test's.
  // A claim is handed to a fixer twice at most, and a milestone is mended four times at most: what a look shows
  // false for the first time has not had its fix yet. (Until 2026-11-19 a milestone was mended twice, whatever was
  // found when. A first pass stopped that night "after two fixes" with two claims shown false: one found only at
  // the third look, one mended once. Each fix had made true what it was handed, and each look had found something
  // the one before had not.)
  // A claim keeps its earlier verdict unless a look after a fix gave it a new one: what was shown false and was not
  // looked at again is still false, and a promise found broken is mended only when it was shown to hold.
  const takeLook = (again) => {
    const proven = new Set(again.proven.filter((id) => claimIds.has(id)))
    const refuted = new Set(again.refuted.map((r) => r.id))
    const unchecked = new Set(again.unchecked.map((u) => u.id))
    const looked = (id) => proven.has(id) || refuted.has(id) || unchecked.has(id)
    const held = new Set(again.held || [])
    const brokenNow = new Set((again.broken || []).map((b) => b.key))
    // What a look did not run again because the fix did not reach it: a claim an earlier look proved, to which
    // this look gave no verdict. It keeps the verdict it had, as any claim not looked at again does, so carrying
    // gives no verdict and takes none away: a claim shown false and named here is still false. (2026-11-26: 21
    // looks after fixes each ran every claim of its verifier, one claim's type check and 1204 tests three times.)
    const wasProven = new Set(verdict.proven)
    carried = (again.carried || []).filter((c) => c && claimIds.has(c.id) && wasProven.has(c.id) && !looked(c.id))
    verdict = {
      proven: [...verdict.proven.filter((id) => !looked(id)), ...proven],
      refuted: [...verdict.refuted.filter((r) => !looked(r.id)), ...again.refuted],
      unchecked: [...verdict.unchecked.filter((u) => !looked(u.id)), ...again.unchecked],
      broken: [...(verdict.broken || []).filter((b) => !held.has(b.key) && !brokenNow.has(b.key)), ...(again.broken || [])],
      stood: again.stood === undefined ? verdict.stood : again.stood,
      // The second look was handed what the first noticed and returns what of it is still so, plus what is new.
      noticed: again.noticed === undefined ? verdict.noticed : again.noticed,
    }
    tie(verdict.refuted)
  }
  let carried = []
  const fixes = new Map()
  // What each claim was shown false by, look after look. A claim mended once and shown false again by another case
  // of the same kind is not mended by a patch for that case: its fixer is handed both and told to mend the kind.
  // (2026-11-22: a claim that nothing of a person stays in an error record was shown false by three sets of names
  // at three looks; two fixers each taught the scrubber the names it was shown, and the milestone stayed open.)
  const found = new Map()
  const owing = () => (verdict ? [...verdict.refuted.map((r) => r.id), ...(verdict.broken || []).map((b) => b.key)] : [])
  if (verdict) tie(verdict.refuted)
  let rounds = 0
  // A fix or a corrected check that no look came back from: nothing closes over it.
  let unlooked = false
  for (let round = 1; round <= 4 && owing().length > 0 && owing().every((key) => (fixes.get(rootOf(key)) || 0) < 2); round++) {
    rounds = round
    log(`${m.title}: fix ${round} begins (a claim is mended twice at most, a milestone four times): ${owing().join(', ')}`)
    // One cause is one mend: two claims of one cause are not two of the fixes a claim gets.
    for (const root of new Set(owing().map((key) => rootOf(key)))) fixes.set(root, (fixes.get(root) || 0) + 1)
    const wrong = verdict.refuted.map((r) => `- ${r.id}: ${r.fact}${sameCause(r).length > 0 ? ` (the same cause as ${sameCause(r).join(', ')}: one change mends both, and say under "fixed" what it covered)` : ''}`).join('\n') || '(none)'
    const causes = new Map()
    for (const r of verdict.refuted) causes.set(rootOf(r.id), [...(causes.get(rootOf(r.id)) || []), r.id])
    const shared = [...causes.entries()].filter(([, ids]) => ids.length > 1)
    if (shared.length > 0) log(`${m.title}: fix ${round}: one cause is one mend: ${shared.map(([root, ids]) => [root, ...ids.filter((id) => id !== root)].join(' = ')).join('; ')}`)
    const broke = (verdict.broken || []).map((b) => `- ${b.key}: ${b.fact}`).join('\n')
    // What was found before is kept by cause, and said once a cause.
    const twice = verdict.refuted.filter((r, at, all) => found.has(rootOf(r.id)) && all.findIndex((other) => rootOf(other.id) === rootOf(r.id)) === at)
    const lastTime = twice.length > 0 ? `\n${twice.length > 1 ? 'These were' : 'This one was'} mended once already and shown false again. What was found the time before:\n${twice.map((r) => `- ${r.id}${rootOf(r.id) === r.id ? '' : ` (the cause it shares with ${rootOf(r.id)}, which was mended)`}: ${String(found.get(rootOf(r.id))).slice(0, 600)}`).join('\n')}\nA claim is handed to a fixer twice: this is the last time. Where what was found now is another case of the kind found before, a patch for that case meets a third. Mend the kind: change what makes such cases possible, so that none of the kind is left (do not take in or keep what the product cannot handle, do not state a figure it cannot know, work a figure out the way the thing it describes is made), and say under "fixed" why no further case of the kind can come. If that cannot be done, the claim cannot be made true as it is worded: put it under "notFixed" and say why.\n` : ''
    for (const r of verdict.refuted) found.set(rootOf(r.id), r.fact)
    const mended = await runAgent(
      `You are fixing a product so that claims shown false on it become true. ${GROUND}${SAND} ${TOOLS}${PLACE}

Contract \`${built.contractId}\` (read it: \`sz-eyes contract show ${built.contractId}\`). The product is launched like this: ${built.launch}.
Someone who did not build it operated the product and found these claims false:
${wrong}
${broke ? `And these were true before this work and are not now (each is a promise of earlier work: \`sz-eyes standing\` shows how it is checked):\n${broke}` : ''}
${lastTime}
${round === 1 && earlier ? 'An earlier run found these and stopped; it, or someone since, may have mended some of them already (`git log` since the look that found them says). One that was mended before and shown false again by another case of the same kind (the log shows each earlier mend) is not mended by one more patch for the case named: mend the kind (change what makes such cases possible, so that none of the kind is left), or put it under "notFixed" and say why it cannot be made true as it is worded. For each that a commit has mended, say which commit and what it changed, and do not run its check: whoever looks next runs every one of them, and run here as well they are the same minutes twice. Mend only what is still to be mended.\n\n' : ''}Find the cause of each in the product and fix it there. Where a claim is shown by pictures kept in the evidence folder (a look the owner will go through), take those pictures again from the product as you leave it: a picture from before your fix shows the fault you mended, and the claim is false again for that alone. Where a claim says something of every screen (nothing cut off, nothing too small to press), mend the cause wherever the same thing is shown, not only in the place named, and run that claim's flow over the whole product until it reports nothing before you return. Where a claim says something of all of a kind (every figure, every link, every answer) and what was found names one place, that is the place the verifier came upon: look for the others the way it found that one (its note and the evidence folder say how) and mend each. Where what was found is a case the claim's own check does not walk (the check passes, and the product is wrong in the case named), the check shows nothing of your fix: bring the product to that case and see it right, mend the neighbouring cases the same cause reaches, and where it is a matter of pure rule add the case as a test of its own, in a file no contract froze. What a verifier recorded under "noticed" is not yours to mend and is not handed to you here. Where the one who found a claim false says the case was made only with a part of the product given a behaviour it does not have (or its inner code handed what its own parts never hand it) and that the running product could not be brought there, do not bend the product to that case: change nothing for it, and put one line under "notFixed" with the case and what shows the product does not get there. Whoever rules next says whether it is the claim's. Where the same claim was also shown false by a case the running product does come to, mend that one as any other. Whatever you change in the product, name its claim under "fixed", also when a line of "notFixed" names the same claim: a product that was changed is looked at again before anything closes, and one that was not is not. Do not edit the contract, the flows or the tests it names, or those of earlier work, and do not record verdicts. Where the claim's own figure, or a frozen test or flow it is shown by, asks for an answer that the claim's source refuses (the page or the law the claim or the screen cites: open it), no fix makes both true: do not bend the product to the figure or the check against its source, and do not leave it wrong by the source to keep a check passing. Change nothing for that claim and put it under "notFixed": the file and the case, what is expected there, and the source's sentence with its address. Whoever rules next opens the source and settles it. Run the check of each claim you were handed until it passes (its flow, its test, its command), and the project's quick checks (its type check and its tests of pure rule). Do not run the other flows, of this contract or of earlier work: whoever looks again runs all of them once, side by side on copies of their own, and run here one after another they are most of an hour in which nothing is learned. One exception: the few checks your own change reaches. After you commit, read what you changed (\`git show --stat --oneline HEAD\`) and find, among the other claims of this contract and the promises \`sz-eyes standing\` lists, the few whose check file, screen or rule those files are about. Run each of those checks once, by itself, and put one line each under "ranAlso" (\`<claim id, or contract/claim>: what its check said\`); leave it empty when the change reaches none. Where one of them fails now, find out why before you return. Where your change broke what that claim says, mend it here: that is this fix's work, and left to the next look it is another round of fixing and looking. Where the check only reads the old form of something your claim's source or the drawing changed, it is the case the next sentences settle (a line under "notFixed"), not a thing to bend back. One search comes first, though: before you commit, search the flows and tests of this contract and of earlier work for the words, figures and names your fix changes on a screen or in an answer (the old form, as it stood). A check that reads the old form fails at the next look, and that is another round of fixing and looking. Run each one that does, by itself, and keep what it reads as it was unless the claim you were handed says otherwise. Where it does (its source, or the drawing the product is held to, asks for the new form), mend the product and do not bend it back to keep that check passing: put one line under "notFixed" for each frozen check that now presses or reads the old form, beginning with the id of the claim that check shows, with the file, the line, the old words and the new. Whoever rules next corrects how such a check presses or reads; it is not yours to edit. Commit the fix. If a claim cannot be made true without changing what was asked, change nothing for it and say why. Nothing is put in as an example to make a claim true: what cannot be made real with what is at hand goes under "notFixed", with what it needs; each line of "notFixed" starts with the id of its claim and a colon (\`<claim id>: why\`), one claim a line. Do not leave a server running.`,
      { label: `fix:${m.id}:${round}`, phase: 'Build', ...effort('build'), ...model('build'), schema: MENDED },
    )
    log(`${m.title}: fix ${round} is back: ${mended ? `${(mended.fixed || []).length} mended${(mended.notFixed || []).length > 0 ? `, ${mended.notFixed.length} it says it could not mend: a ruling follows` : ''}` : 'no answer'}`)
    // What the fixer says cannot be made true is ruled on before anyone looks again: a claim set aside is not looked at twice more.
    // What the fixer ran of the neighbours its change reached: a fix that breaks one of them is found here, by the
    // one who made it, instead of by the look after it. (2026-11-26: three fixes of one contract each broke another
    // claim, and every one was found by the next look: a fix and a look more each time.)
    const also = ((mended && mended.ranAlso) || []).map((said) => line(said)).filter((said) => said !== '')
    if (also.length > 0) log(`${m.title}: fix ${round} also ran ${also.length} check(s) its change reached: ${also.map((said) => said.slice(0, 120)).join(' | ')}`)
    correctedLast = 0
    if (mended && Array.isArray(mended.notFixed) && mended.notFixed.length > 0) await rule(mended.notFixed.map((line) => String(line)))
    // A product that was changed is looked at again before anything closes, whatever was ruled: a claim set aside
    // or given back in the same round does not end the looking. (Found reviewing this very change, 2026-11-26: a
    // fixer mends, names the same claim under "notFixed" for a case it left, the ruling gives the claim back, and
    // the milestone closed on a commit no verifier had run. A check a ruling corrected was never run by one either.)
    const changed = Boolean(mended && (mended.fixed || []).length > 0) || correctedLast > 0
    if (verdict.refuted.length + (verdict.broken || []).length === 0 && !changed) break
    // A claim can be shown false by a case its own check does not walk: whoever looks again is handed the case.
    const again = await lookAgain({ claims: verdict.refuted.map((r) => r.id), facts: Object.fromEntries(verdict.refuted.map((r) => [r.id, r.fact])), standing: (verdict.broken || []).map((b) => b.key), noticed: verdict.noticed === null ? null : verdict.noticed || [] })
    if (!again) {
      log(`${m.title}: nobody answered at the look after fix ${round}: what was shown false stays so`)
      unlooked = changed
      break
    }
    takeLook(again)
    log(`${m.title}: the look after fix ${round} is back: ${tally(verdict)}`)
    if (carried.length > 0) log(`${m.title}: ${carried.length} claim(s) not run again, the fix did not reach them: ${carried.map((c) => `${c.id} (${line(c.range).slice(0, 30)})`).join(', ')}`)
  }
  if (verdict && verdict.refuted.length > 0) await rule([])
  if (verdict && unlooked && verdict.refuted.length + (verdict.broken || []).length === 0) {
    stopped = `milestone "${m.title}" was mended and nobody looked at it again (the verifier did not answer): nothing closes on a product no one has looked at since its last fix. Its contract stays open; started again, the run shows every claim again.`
    log(stopped)
    return { entry: { id: m.id, title: m.title, contractId: built.contractId, proven: verdict.proven, refuted: verdict.refuted, unchecked: verdict.unchecked, noticed: verdict.noticed || [], report: null, ...left }, stopped }
  }
  if (verdict && (verdict.sandbox || '').trim() !== '') {
    stopped = `milestone "${m.title}" was built and could not be looked at: ${observationRefusal(verdict.sandbox)}. Nothing is known to be wrong with the product. ${AFTER_SANDBOX_STOP}`
    log(stopped)
    return { entry: { id: m.id, title: m.title, contractId: built.contractId, proven: verdict.proven, refuted: verdict.refuted, unchecked: m.claims.filter((c) => !verdict.proven.includes(c.id)).map((c) => ({ id: c.id, why: 'the command sandbox stopped the look' })), noticed: verdict.noticed || [], report: null, ...left }, stopped }
  }
  if (!verdict) {
    stopped = `milestone "${m.title}" was built and could not be verified (the verifier did not answer)`
    log(stopped)
    return { entry: { id: m.id, title: m.title, contractId: built.contractId, proven: [], refuted: [], unchecked: m.claims.map((c) => ({ id: c.id, why: 'the verifier did not answer' })), noticed: [], report: null, ...left }, stopped }
  }

  let broken = verdict.broken || []
  const entryNow = () => ({ id: m.id, title: m.title, contractId: built.contractId, launch: built.launch, setAside, proven: verdict.proven.filter((id) => !setAside.some((d) => d.id === id)), refuted: verdict.refuted, unchecked: verdict.unchecked, broken, stood: verdict.stood === undefined ? null : verdict.stood, replaced: m.supersedes || [], noticed: verdict.noticed || [], carried, report: null, corrections: [], ...left })
  let entry = entryNow()
  if (redteam === 'close' || redteam === 'both') {
    // A review is paid for over a milestone that can close. One with claims still shown false or promises broken
    // after its fixes stops below whatever a review finds, and is reviewed again when it is taken up. (2026-11-26:
    // the review ran before the stop "still has claims shown false", over a milestone two fixes had not saved.)
    if (verdict.refuted.length + broken.length > 0) log(`${m.title}: the close review is skipped: the milestone cannot close (${verdict.refuted.length} claim(s) shown false, ${broken.length} promise(s) of earlier work broken)`)
    else {
      const first = await redTeam('close', m, built, runAgent, where)
      if (first && first.fatal.length > 0) {
        // A fatal finding is a fault no claim covers. Until 2026-11-26 it stopped the run there, with no way to mend
        // it: started again, the run verified the milestone again (10 to 20 minutes), paid for the same review and
        // met the same finding. Now it is mended once, every claim is shown again on the mended product (a mend
        // that nobody looks at again is the builder's word for itself), the review looks again at what it found and
        // at nothing else, and only what still holds stops the run.
        const backlog = `${where ? where + '/' : ''}.sz/backlog.md`
        const seen = first.checks.filter((c) => c && c.weight === 'fatal').map((c) => `  ${c.what} (at ${c.where}): ${c.why}`)
        const mendedReview = await runAgent(
          `You are mending a product because a review in a new conversation, made on the running product, found what no claim covers. ${GROUND}${SAND} ${TOOLS}${PLACE}

Contract \`${built.contractId}\` (read it: \`sz-eyes contract show ${built.contractId}\`). The product is launched like this: ${built.launch}.
What the review found (it is also in \`${backlog}\`):
${first.fatal.map((f) => `- ${f}`).join('\n')}${seen.length > 0 ? `\nWhere it saw each, and what goes wrong there for the person:\n${seen.join('\n')}` : ''}

Find the cause of each in the product and mend it there; where it is one case of a kind, mend the kind. Every claim of the contract was shown true before this review, and whoever looks next shows each again on the product as you leave it: run the project's quick checks (its type check and its tests of pure rule) and the check of each claim your change reaches, and leave them passing. A check that stops passing means the product is wrong, not the check. Do not edit the contract, the flows or tests it froze, or those of earlier work, and record no verdicts. Commit the fix. What cannot be made true with what is at hand goes under "notFixed", one line each with what it needs; nothing is put in as an example. Do not leave a server running.`,
          { label: `fix:${m.id}:review`, phase: 'Close', ...effort('build'), ...model('build'), schema: MENDED },
        )
        const notFixed = ((mendedReview && mendedReview.notFixed) || []).map((line) => String(line)).filter((line) => line.trim() !== '')
        let second = null
        if (mendedReview) {
          const after = await lookAgain({ claims: [], facts: {}, standing: [], noticed: verdict.noticed === null ? null : verdict.noticed || [] })
          if (!after) {
            stopped = `milestone "${m.title}" was mended where its close review found a fault, and nobody could look at it again (the verifier did not answer). Its contract stays open, and the findings are in ${backlog}.`
            log(stopped)
            return { entry, stopped }
          }
          takeLook(after)
          broken = verdict.broken || []
          entry = entryNow()
          if (verdict.refuted.length + broken.length > 0) {
            stopped = `milestone "${m.title}" was mended where its close review found a fault, and the mend left ${verdict.refuted.length} claim(s) shown false and ${broken.length} promise(s) of earlier work broken: ${[...verdict.refuted.map((r) => `${r.id} (${r.fact})`), ...broken.map((b) => `${b.key} (${b.fact})`)].join('; ')}. Its contract stays open: started again, the run takes it up at the fix. The review's findings are in ${backlog}.`
            log(stopped)
            return { entry, stopped }
          }
          second = await redTeam('close', m, built, runAgent, where, first.fatal)
        }
        const survived = [...new Set([...notFixed, ...(second ? second.fatal : first.fatal)])]
        if (survived.length > 0) {
          stopped = `milestone "${m.title}" was verified, mended once where its close review found a fault, and ${survived.length} fault(s) still hold: ${survived.join('; ')}. Its contract stays open, and the findings are in ${backlog}. Started again, the run verifies this milestone and reviews it again from the start, and nothing carries these into a fix: the owner may rather say what to do about them first.`
          log(stopped)
          return { entry, stopped }
        }
        log(`${m.title}: the close review found ${first.fatal.length} fault(s); they were mended, every claim was shown again, and none of the faults holds now`)
      }
    }
  }
  const closed = await runAgent(
    `Close milestone "${m.title}" of the project in ${here}. ${TOOLS}${PLACE}
1. \`sz-eyes evidence ${built.contractId}\` writes the evidence page; note its path. In Codex, call record with ["evidence", "${built.contractId}"].
2. ${verdict.refuted.length + (verdict.broken || []).length === 0 ? `\`sz-eyes contract close ${built.contractId}\` (it also writes what the verifier noticed and what could not be checked to \`.sz/backlog.md\`). It refuses when most of the claims were not looked at: then do not pass \`--accepted\` (that is the owner's to say), leave the contract open, and return "closed": false with what it said under "why". When it said closed, run \`sz-eyes evidence prune ${built.contractId}\` before anything is committed: every look took its pictures again, and this removes from the milestone's evidence folder those that no verdict, notice or record names (the page and what they name stay). In Codex, use record for both: ["contract", "close", "${built.contractId}"] then ["evidence", "prune", "${built.contractId}"].` : `Leave the contract open: it has claims shown false, or broke what stood before it. Nothing here closes it: \`sz-eyes contract close\` refuses with "still owes" while a claim is shown false, no line of \`.sz/backlog.md\` changes that, and you do not pass \`--accepted\` (those words are the owner's alone). Its evidence stays as it is: it is what the fix is worked from. So that the owner finds what is known and not done where they look for it, write it to \`.sz/backlog.md\` with \`sz-eyes backlog add "<one line>" --from "계약 ${built.contractId}"\`: one line for each claim shown false (its id, and what was found instead, from its note in \`sz-eyes contract show ${built.contractId}\`), and one for each line that command lists as noticed, word for word (the same words are not written a second time when the contract closes later). A backlog line is how the next work finds this, never a way to close the contract.`}
3. ${where ? 'If this milestone made a line of \`.sz/map.md\` or \`.sz/spec.md\` false (how it is launched, where it keeps things, what it does), do not edit them here: return under "corrections" each such line and what it should say now.' : 'If this milestone made a line of \`.sz/map.md\` or \`.sz/spec.md\` false (how it is launched, where it keeps things, what it does), correct that line.'} If the project has a case (\`sz-eyes worth show\`) and the contract is closed, mark each row of the whole job that a claim proven here covers: \`sz-eyes worth row <case> <row> --ours have --by ${built.contractId}/<claim>\`. Only rows a proven claim shows; the rest stay as they are.
4. Read \`sz-eyes backlog\`. For each open line that this milestone has ended (the thing it names is built or fixed now, and a claim proven here or a commit of this milestone shows it), run \`sz-eyes backlog done "<some words of the line>" --by "${built.contractId}/<claim>, or the commit"\`. Tick only what is shown to be ended; a line that is half done stays open.
5. Add one line to \`.sz/progress.md\` in the owner's language: the date, the milestone, how many claims are proven, refuted and unchecked, and each claim set aside for the owner with what they have to decide, how many promises of earlier work were shown again and whether any broke or was replaced, anything the verifier noticed that the owner should know, and what comes next. The figures are these, as the verifier returned them: ${verdict.proven.length} proven, ${verdict.refuted.length} refuted, ${verdict.unchecked.length} unchecked${carried.length > 0 ? ` (${carried.length} of those proven were not run again at the last look, because the fix did not reach them: ${carried.map((c) => c.id).join(', ')})` : ''}${verdict.stood === undefined ? '' : `; of what stood before this milestone, ${verdict.stood} hold`}, ${(verdict.broken || []).length} broken, ${(m.supersedes || []).length} replaced. Use them in the line and in the commit message; do not count again from \`sz-eyes standing\`, which after closing also counts this milestone's own claims.
6. Commit \`.sz/\` (the contract, the evidence, the standing record, the backlog, the progress line)${where ? ', on this folder\'s own branch' : ''}.
7. Run \`sz-eyes room\` and return the number on its first line under "room".
Change no product code.${FINISH}`,
    { label: `close:${m.id}`, phase: 'Close', schema: CLOSED, ...effort('close') },
  )
  if (closed && typeof closed.room === 'number' && closed.room >= 0) ROOM = closed.room
  entry.report = closed ? closed.report : null
  entry.corrections = (closed && closed.corrections) || []
  log(`${m.title}: ${verdict.proven.length} proven, ${verdict.refuted.length} refuted, ${verdict.unchecked.length} unchecked${verdict.stood === undefined ? '' : `; of what stood before, ${verdict.stood} hold and ${broken.length} broke`}`)

  // Nothing is built on a milestone that is known to be broken: the owner is told where it stands instead. The
  // contract's own word decides, not what the agents reported: a contract that would not close is not done.
  if (verdict.refuted.length + broken.length === 0 && !(closed && closed.closed === true)) {
    stopped = `milestone "${m.title}" was verified and its contract did not close: ${closed ? closed.why || 'sz-eyes contract close refused' : 'the closer did not answer'}`
    log(stopped)
    return { entry, stopped }
  }
  if (verdict.refuted.length + broken.length > 0) {
    // The stop says what can be done, and what cannot. (2026-11-26: it said how often the milestone had been mended
    // and nothing else. The session offered its owner "leave it in the backlog and go on", twice; the owner chose
    // it; `sz-eyes contract close` refused with "still owes", and the session had to take both offers back.)
    const ways = verdict.refuted.length > 0 ? ` There are three ways on, and no other: start the run again (the claim goes to a fixer again, and every claim is shown again after it); where it is the claim's own words that are wrong, they are ruled so and the claim waits for the owner (\`sz:arbiter\` records \`sz-eyes contract dispute\`; ${ruledLast ? 'whoever ruled at the end of this run found the product wrong' : 'nobody ruled at the end of this run (no answer)'}, and a run started again asks again after its fix); or, when the owner says the product may go out with that claim false, close it on their words (\`sz-eyes contract close ${built.contractId}${where ? ` --dir ${where}` : ''} --accepted "<their words>"\`: it is written down as a known limit, and does not stand). A line in .sz/backlog.md closes no contract, and no agent writes the owner's words for them.` : ''
    const kept = broken.length > 0 ? ' A promise of earlier work found broken is not closed over on anyone\'s word: it is mended (start the run again), or, where what the owner asked has changed, whoever rules records which claim this work replaces.' : ''
    stopped = `milestone "${m.title}" still has ${verdict.refuted.length} claim(s) shown false and ${broken.length} promise(s) of earlier work broken after ${['no fix', 'one fix', 'two fixes', 'three fixes', 'four fixes'][rounds]}${rounds > 2 || owing().some((key) => (fixes.get(key) || 0) >= 2) ? ' (a claim is handed to a fixer twice at most, and a milestone is mended four times at most)' : ''}: ${[...verdict.refuted.map((r) => `${r.id} (${r.fact})`), ...broken.map((b) => `${b.key} (${b.fact})`)].join('; ')}. Its contract stays open and nothing is built on it.${ways}${kept}`
    log(stopped)
    return { entry, stopped }
  }
  return { entry, stopped: null }
}


// ------------------------------------------------------------------ the order: a line, or milestones side by side
// Most milestones stand on the one before, so a line is the default and nothing below changes for it. What the
// plan puts side by side is built and proven at the same time, each in a folder of its own, then brought into
// the project's folder; and because two things proven apart are not yet proven together, every claim that
// stands is shown again on the product as joined before anything is built on it. (`beside`, which starts them
// together, is near the top: a new product's design stage uses it first.)
// What the plan puts side by side is built side by side, three at once at most; args.side = 1 keeps a line.
// Run for real twice on 2026-11-16 (docs/runs/2026-11-16-order): a pair, and three at once. Both met conflicts
// when brought together (a table of routes, the map), both were settled by an agent and every claim that stood
// was shown again on the product as joined. Against a line they took a quarter to two fifths less time.
let side = Math.max(1, Math.min(3, Number.isFinite(Number(args && args.side)) ? Math.floor(Number(args.side)) : 3))
let ids = new Set(milestones.map((m) => m.id))
const afterOf = (m) => {
  const at = milestones.indexOf(m)
  return Array.isArray(m.after) ? m.after.filter((id) => ids.has(id) && id !== m.id) : at > 0 ? [milestones[at - 1].id] : []
}
const done = []
const closedIds = new Set()
const joins = []
let stopped = null
const beforeText = () => done.map((d) => `- ${d.title}: ${d.earlier ? 'closed in an earlier run' : d.refuted.length === 0 ? 'proven' : `left with ${d.refuted.length} claim(s) refuted`}`).join('\n') || '(this is the first)'
const inOrder = () => done.sort((a, b) => milestones.findIndex((m) => m.id === a.id) - milestones.findIndex((m) => m.id === b.id))

for (const m of milestones) {
  if (m.state !== 'closed' || m.where) continue
  // What was shown of it is in its contract (some of its claims may be the owner's to judge, still open): none of that is repeated here as "proven".
  done.push({ id: m.id, title: m.title, contractId: m.contractId || m.id, earlier: true, verdicts: `closed in an earlier run: sz-eyes contract show ${m.contractId || m.id}`, proven: [], refuted: [], unchecked: [], noticed: [], report: null })
  closedIds.add(m.id)
  log(`${m.title}: closed in an earlier run`)
}

const STAGED = { type: 'object', properties: { folders: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, where: { type: 'string', description: 'the whole path of the folder' } }, required: ['id', 'where'] } }, problem: { type: 'string', description: 'empty unless the folders could not be made ready: then why' } }, required: ['folders'] }
const JOINED = { type: 'object', properties: { merged: { type: 'array', items: { type: 'string' }, description: 'ids brought into the project\'s folder' }, conflicted: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, files: { type: 'array', items: { type: 'string' } } }, required: ['id', 'files'] } } }, required: ['merged', 'conflicted'] }

// Brings what a group built into the project's folder and shows everything that stands again on the result.
// Returns why the run stops here, or null when the product stands joined.
async function bring(group, whereOf) {
  const list = (some) => some.map((m) => `- ${m.id} | ${m.title} | branch sz/${m.id} | folder ${whereOf.get(m.id)}`).join('\n')
  const corrections = group.flatMap((m) => (done.find((d) => d.id === m.id) || {}).corrections || [])
  const join = (some, again) =>
    agent(
      `Bring into the project in the current folder milestones that were built side by side, each in a folder of its own${again ? ' (these could not be brought in before and have since been brought up to date)' : ''}. ${TOOLS} Work in the project's own folder, never inside the milestones' folders. Change no product code and settle no conflict in it yourself. If git refuses to write under \`.git\` because of the session's command sandbox, run that command outside it (\`dangerouslyDisableSandbox: true\` on the Bash call).

The milestones (id | title | branch | folder):
${list(some)}

For each, in this order:
1. \`git merge --no-ff sz/<id> -m "<its title>"\`.
   - \`.sz/backlog.md\` and \`.sz/progress.md\` keep the lines of both sides by themselves.
   - If the merge stops on \`.sz/standing.json\` and nothing else: \`sz-eyes standing mend\`, then \`git add .sz/standing.json\` and \`git commit --no-edit\`.
   - If it stops on anything else: \`git merge --abort\`, leave that milestone's folder and branch as they are, and return it under "conflicted" with the files that conflicted. Go on with the next.
2. When it merged: \`git worktree remove <its folder>\` (with \`--force\` only when what is left there is not in git: installed dependencies, build output, data it stored while being tried) and \`git branch -d sz/<id>\`.
Then, if any merged:
3. ${corrections.length > 0 ? `Correct \`.sz/map.md\` and \`.sz/spec.md\`: each of these is a line a milestone made false and what it should say now. ${corrections.map((c) => `[${c}]`).join(' ')} Commit.` : 'Nothing in the map or the spec was reported as made false.'}
4. If what the product depends on changed (its lock file), put the dependencies in place again as the map says.
Run nothing else and judge nothing.${FINISH}`,
      { label: `join:${some.map((m) => m.id).join('+')}${again ? ':again' : ''}`, phase: 'Verify', schema: JOINED, ...effort('join') },
    )
  let joined = await join(group, false)
  if (!joined) return `milestones ${group.map((m) => `"${m.title}"`).join(', ')} were built side by side and could not be brought together (nobody answered). Each is closed on its own branch (sz/<id>) in its folder under .sz/trees/.`
  let merged = new Set(joined.merged)
  // What does not merge is brought up to date by someone who can build, in that milestone's own folder; nothing
  // about it is taken on trust: once in, it is shown again with everything else.
  const stuck = (joined.conflicted || []).map((c) => ({ m: group.find((g) => g.id === c.id), files: c.files })).filter((c) => c.m)
  for (const { m, files } of stuck) {
    await agent(
      `You are bringing one milestone's work up to date with the product it has to join. ${GROUND}${SAND} ${TOOLS}

Milestone "${m.title}" (contract \`${m.id}\`, closed) was built in the folder \`${whereOf.get(m.id)}\` beside others. The others have been brought into the project's own folder, and this one's branch no longer merges into it: ${files.join(', ') || '(git did not say which files)'}.

Do everything in that folder (start every command with \`cd ${whereOf.get(m.id)} &&\`; read and write only files under it):
1. Merge into it the branch the project's own folder has checked out (\`git worktree list\` shows which).
2. Settle each conflict so that what this milestone promised and what the others built are both true. Read both sides; \`sz-eyes contract show <id>\` says what each milestone promised. If \`.sz/standing.json\` conflicts: \`sz-eyes standing mend\`. Do not change a flow or a test that a contract froze so that it passes: if two milestones cannot both be true, settle nothing for that file and say so.
3. Run the project's whole check command and this milestone's own flows and tests there, and fix the product until they pass.
4. Commit.
Do not merge anything into the project's own folder yourself, and do not record verdicts.`,
      { label: `resolve:${m.id}`, phase: 'Build', ...effort('build'), ...model('build'), schema: { type: 'object', properties: { settled: { type: 'string', description: 'what conflicted and how each was settled' }, cannot: { type: 'string', description: 'empty unless two milestones cannot both be true: then which claims, and why' } }, required: ['settled'] } },
    )
  }
  if (stuck.length > 0) {
    const again = await join(stuck.map((c) => c.m), true)
    for (const id of (again && again.merged) || []) merged.add(id)
  }
  const out = group.filter((m) => !merged.has(m.id))
  const lastId = (done.find((d) => d.id === group.filter((m) => merged.has(m.id)).slice(-1)[0]?.id) || {}).contractId || group[0].id
  let gate = null
  if (merged.size > 0) {
    const joinedAgent = typeof milestoneAgent === 'function'
      ? (prompt, options) => milestoneAgent(null, lastId, prompt, options)
      : agent
    const record = `\`sz-eyes standing record <contract>/<claim> --status holds|broken|unchecked --during ${lastId} --note "<what was run and what it showed>"\``
    const look = (again) =>
      joinedAgent(
        `Milestones ${group.filter((m) => merged.has(m.id)).map((m) => `"${m.title}"`).join(', ')} of the project in the current folder were built side by side, each proven in a folder of its own, and have just been brought into this one. Nobody has seen them together. There is no new claim to prove.${SAND} ${
          again
            ? `This is a second look, after a fix. These promises did not hold when the milestones were brought together: ${again.join(', ')}. Show each again, and once more everything else that stands, since a fix can break a neighbour.`
            : `Show again every claim that stands (\`sz-eyes standing\`) on the product as it is now in this folder: run every flow, test and command they are shown by (the project's whole check command in one go where it has one), and look at each screen that more than one of these milestones changed.`
        } The product is launched as \`.sz/map.md\` says. Record each with ${record}. I am telling you nothing about whether they hold. Record what you notice that no claim covers and that being brought together caused with \`sz-eyes contract notice ${lastId}\` only if that contract is still open; otherwise return it under "noticed". Stop any server you start. Return under "broken" every promise that does not hold now, under "held" those you showed again that hold, under "stood" how many hold; leave "proven", "refuted" and "unchecked" empty.`,
        { label: `gate:${group.map((m) => m.id).join('+')}${again ? ':again' : ''}`, phase: 'Verify', agentType: 'sz:verifier', schema: VERDICT, ...effort('verify') },
      )
    gate = await look(null)
    for (let round = 1; round <= 2 && gate && !(gate.sandbox || '').trim() && (gate.broken || []).length > 0; round++) {
      const broke = gate.broken.map((b) => `- ${b.key}: ${b.fact}`).join('\n')
      const joinMend = await joinedAgent(
        `You are fixing a product after milestones that were built side by side were brought into one. ${GROUND}${SAND} ${TOOLS}

Each was proven alone. Together, these promises do not hold (each is a standing claim: \`sz-eyes standing\` shows how it is checked):
${broke}

Find the cause in the product (usually two milestones that each changed the same thing their own way) and fix it there so that all of them hold. Do not edit a contract or the flows and tests one names, and do not record verdicts. Run the project's checks, and the checks of the promises your change reaches (\`sz-eyes standing\` says how each is shown), one line each under "ranAlso", beginning with the claim it shows. Commit the fix. Do not leave a server running.`,
        { label: `mend:${group.map((m) => m.id).join('+')}:${round}`, phase: 'Build', ...effort('build'), ...model('build'), schema: MENDED },
      )
      const joinAlso = ((joinMend && joinMend.ranAlso) || []).map((said) => String(said || '').replace(/\s+/g, ' ').trim()).filter((said) => said !== '')
      if (joinAlso.length > 0) log(`the mend after the join also ran ${joinAlso.length} check(s) its change reached: ${joinAlso.map((said) => said.slice(0, 120)).join(' | ')}`)
      const again = await look(gate.broken.map((b) => b.key))
      if (!again) break
      gate = again
    }
  }
  joins.push({ ids: group.map((m) => m.id), merged: [...merged], notMerged: out.map((m) => m.id), stood: gate && gate.stood !== undefined ? gate.stood : null, broken: (gate && gate.broken) || [], noticed: (gate && gate.noticed) || [] })
  for (const m of group) if (merged.has(m.id)) closedIds.add(m.id)
  if (merged.size > 0 && !gate) return `milestones ${[...merged].join(', ')} were brought together and could not be shown together (the verifier did not answer)`
  if (gate && (gate.sandbox || '').trim() !== '') return `milestones ${[...merged].join(', ')} were brought together and could not be looked at: ${observationRefusal(gate.sandbox)}. ${AFTER_SANDBOX_STOP}`
  if (gate && (gate.broken || []).length > 0) return `milestones ${[...merged].join(', ')} were each proven alone and, brought together, ${gate.broken.length} promise(s) do not hold after two fixes: ${gate.broken.map((b) => `${b.key} (${b.fact})`).join('; ')}`
  if (out.length > 0) return `milestone(s) ${out.map((m) => `"${m.title}"`).join(', ')} were built and closed on their own branch and could not be brought into the project's folder (the conflict was not settled). They are in ${out.map((m) => whereOf.get(m.id)).join(', ')}.`
  log(`brought together: ${[...merged].join(', ')}${gate && gate.stood !== undefined ? `; ${gate.stood} promise(s) hold on the product as joined` : ''}`)
  return null
}

while (!stopped) {
  const rest = milestones.filter((m) => !done.some((d) => d.id === m.id))
  if (rest.length === 0) {
    if (!more) break
    // A run asked to end here plans nothing it will not build: the run that builds what comes next plans it,
    // from the product as it then is and what the owner has said by then.
    if (done.length >= maxMilestones) {
      log(`the run was asked to end after ${maxMilestones} milestone(s): what comes after is planned by the run that builds it. Still listed: ${later.join(' / ') || '(nothing)'}`)
      break
    }
    // The first pass stands: what comes after it is planned now, from the product as it is.
    more = false
    phase('Plan')
    const next = await planIt('after')
    if (next) learn(next)
    const todo = next && Array.isArray(next.milestones) ? next.milestones.filter((m) => m.state !== 'closed' && !done.some((d) => d.id === m.id)) : []
    if (todo.length === 0) {
      stopped = `the first pass is closed, and what comes after it was not planned (${next ? 'the plan came back with nothing to build' : 'nobody answered'}): start again to go on. Still listed: ${later.join(' / ')}`
      log(stopped)
      break
    }
    milestones = [...milestones.filter((m) => done.some((d) => d.id === m.id)), ...todo].slice(0, maxMilestones)
    ids = new Set(milestones.map((m) => m.id))
    plan = { ...plan, decided: [...(plan.decided || []), ...(next.decided || [])] }
    const owedAfter = holdFor(milestones.filter((m) => !done.some((d) => d.id === m.id)), 'the first pass stands; nothing after it was built: the plan for what comes after it leaves something not real that may be so only on the owner\'s own word')
    if (owedAfter) {
      stopped = owedAfter
      log(stopped)
      break
    }
    const left = milestones.length - done.length
    log(`planned after the first pass: ${left} milestone(s): ${todo.slice(0, left).map((m) => m.title).join(' / ')}; expect about ${left * 20} to ${left * 30} minutes in a line`)
    continue
  }
  let ready = rest.filter((m) => afterOf(m).every((id) => closedIds.has(id)))
  // An order that goes round in a circle, or waits on something that is not in the plan: the rest goes in a line.
  if (ready.length === 0) ready = [rest[0]]
  const first = ready[0]
  // Left by an earlier run in a folder of its own: finished there, then brought in.
  if (first.where) {
    const whereOf = new Map([[first.id, first.where]])
    if (first.state === 'closed') done.push({ id: first.id, title: first.title, contractId: first.contractId || first.id, earlier: true, verdicts: `closed in an earlier run: sz-eyes contract show ${first.contractId || first.id}`, proven: [], refuted: [], unchecked: [], noticed: [], report: null })
    else {
      const r = await milestone(first, milestones.indexOf(first) + 1, beforeText(), first.where)
      if (r.entry) done.push(r.entry)
      if (r.stopped) { stopped = r.stopped; break }
    }
    stopped = await bring([first], whereOf)
    continue
  }
  // With nothing beside it: the first of all, one marked alone, one built in an earlier run, and whatever is
  // ready by itself.
  const group = side === 1 || closedIds.size === 0 || first.alone === true || first.state === 'built' ? [first] : ready.filter((m) => m.alone !== true && m.state !== 'built' && !m.where).slice(0, side)
  if (group.length < 2) {
    const r = await milestone(first, milestones.indexOf(first) + 1, beforeText(), null)
    if (r.entry) done.push(r.entry)
    if (r.stopped) { stopped = r.stopped; break }
    closedIds.add(first.id)
    if (first.first && r.entry) log(`FIRST PASS READY. The whole product can be looked at now: ${r.entry.launch}. Every screen: ${r.entry.report || `.sz/evidence/${r.entry.contractId}/`}`)
    continue
  }

  log(`side by side: ${group.map((m) => m.title).join(' / ')}`)
  const staged = await agent(
    `Make ready for ${group.length} milestones of the project in the current folder to be built side by side, each in a folder of its own. ${TOOLS} Work in the project's own folder and change no product code. If git refuses to write under \`.git\` because of the session's command sandbox, run that command outside it (\`dangerouslyDisableSandbox: true\` on the Bash call).

The milestone ids: ${group.map((m) => m.id).join(', ')}

1. \`git status --short\`. If anything is uncommitted, commit it: what earlier milestones left is part of the product, and the new folders start from this commit.
2. So that the folders are not taken for part of the product: add the line \`.sz/trees/\` to \`.git/info/exclude\` if it is not there.
3. So that lines both sides add to the same list are both kept later: add to \`.git/info/attributes\` (make it if needed), if not there, the lines \`.sz/backlog.md merge=union\` and \`.sz/progress.md merge=union\`.
4. For each id: \`git worktree add .sz/trees/<id> -b sz/<id>\`. If a folder or a branch of that name is left from an earlier run, make nothing and say so under "problem".
5. In each folder, put the product's dependencies in place as \`.sz/map.md\` says they are installed. Where the project's own folder already has them, copying is quicker than installing (on macOS \`cp -cR node_modules .sz/trees/<id>/node_modules\`). Whatever the map says must exist before the product starts and is not in git (a settings file, a built folder) is copied likewise. Never copy what the product stored (a database, what people entered): each folder starts with its own. For a native app, what a first build downloads and compiles is large and slow to get again (for React Native on iOS, the \`ios/Pods\` folder with its prebuilt archives): copy it too where the project's own folder has it.
6. In each folder run the project's quick check once (the map's check command), to see that it passes there before anything is changed.
Return each id with the whole path of its folder (\`pwd\` inside it).${FINISH}`,
    { label: `stage:${group.map((m) => m.id).join('+')}`, phase: 'Build', schema: STAGED, ...effort('join') },
  )
  const whereOf = new Map(((staged && staged.folders) || []).map((f) => [f.id, f.where]))
  if (!staged || (staged.problem || '').trim() !== '' || group.some((m) => !whereOf.get(m.id))) {
    // Folders of their own could not be made: nothing is lost by building them one after another.
    log(`the milestones are built in a line after all: ${staged ? staged.problem || 'a folder is missing' : 'nobody answered'}`)
    side = 1
    continue
  }
  const before = beforeText()
  const results = await beside(group.map((m) => () => milestone(m, milestones.indexOf(m) + 1, before, whereOf.get(m.id))))
  const good = []
  const bad = []
  group.forEach((m, k) => {
    const r = results[k]
    if (r && r.entry) done.push(r.entry)
    if (r && r.entry && !r.stopped) good.push(m)
    else bad.push(r && r.stopped ? r.stopped : `milestone "${m.title}": nobody answered`)
  })
  inOrder()
  // What came through is brought together and shown again even when another of the group did not: it is closed,
  // and leaving it on a branch would lose it. Then the run stops, saying which did not come through.
  if (good.length > 0) stopped = await bring(good, whereOf)
  if (bad.length > 0) stopped = [stopped, ...bad].filter(Boolean).join(' Also: ')
}
inOrder()

return {
  mode: plan.mode || null,
  summary: plan.summary,
  decided: plan.decided || [],
  spec: '.sz/spec.md',
  // The last measurement of a new product's prototype when this run drew it; null when it drew nothing.
  design: designed,
  milestones: done,
  redteam: reviews,
  // What was built side by side: which milestones, which came into the project's folder, and how many promises held on the product as joined.
  joins,
  // Claims whose own words turned out wrong about the world: set aside, not changed. Each is the owner's to settle (sz-eyes contract judged <contract> <claim> --verdict yes|no --said "...").
  forOwner: done.flatMap((d) => (d.setAside || []).map((a) => `${d.contractId}/${a.id}: ${a.ruling}`)),
  notBuilt: [...milestones.filter((m) => !done.some((d) => d.id === m.id)).map((m) => m.title), ...(more ? later : [])],
  // What the owner is asked for before what stopped can be built: each with why, what it needs and, for a key, the
  // command they run in their own terminal to put it in the vault.
  needed,
  stopped,
}
