export const meta = {
  name: 'build',
  description: 'Build a product, or grow one that exists, to the end, unattended: for a new product with screens, first every screen planned, drawn as one clickable prototype, measured, and put before the owner, whose word it waits for; then a spec (new, or the existing one extended), then for each milestone a frozen contract, the build, a verification by an agent that did not build it which also shows again what stood before, fixes, and a page of evidence. Milestones follow one another unless the plan puts some side by side: those are built at the same time in folders of their own, brought together, and everything that stands is shown again on the product as joined',
  whenToUse: 'A new product, or a change of several features to a product that already has a spec (lane L), after the owner has been put the questions only they can answer (a few, each a choice they can tap) and has asked for it to run to the end without them. Typing the command is not an answer to those questions: ask first, then start it with asked and answers (args is an object: { request, asked, answers, design? }). A new product with screens is drawn before anything of it is built: the first run plans and draws every screen, measures them, and stops with the prototype. Open .sz/design/prototype.html for the owner, record what they say in their words (sz-eyes contract judged design feel --verdict yes|no --said "<their words>"), and start the workflow again: on yes it builds the first pass to the drawing, on no it draws again what they said. Only design: "go" in args takes a run from the measured prototype straight into building without their word, and only the owner can ask for it (a prototype waits fifteen minutes; a build nobody wanted costs two hours). For a new product, right after starting the run that builds its first pass (after their yes, with design: "go", or for a product with no screens), start in the background a wait for its first pass to stand (until [ -n "$(sz-eyes standing --summary)" ]; do sleep 20; done); when that returns, start the product as .sz/map.md says and tell the owner its address and where the page with every screen is: they see the whole product then, not when everything is finished.',
  phases: [
    { title: 'Plan', detail: 'the spec and its milestones, each with the claims that make it done' },
    { title: 'Design', detail: 'for a new product with screens: every screen planned, drawn as one prototype and measured, then put before the owner before anything is built' },
    { title: 'Build', detail: 'a milestone, or several side by side in folders of their own: contract, oracle, code' },
    { title: 'Verify', detail: 'each claim shown on the running product by an agent that did not build it; what was built side by side is shown again once joined' },
    { title: 'Close', detail: 'evidence page, progress line, commit' },
  ],
}

// args: { request: string, asked: 'owner' | 'away', answers?: string, design?: 'go', maxMilestones?: number, side?: 1|2|3, effort?: string | object, model?: string | object }
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
const IN_SANDBOX = ' This session runs its commands inside a sandbox, where nothing that opens a browser, a desktop app, a simulator or Docker can start. Run those outside it from the first try (`dangerouslyDisableSandbox: true` on the Bash call): every `sz-eyes web`, `sz-eyes electron`, `sz-eyes ios` and `sz-eyes docker` command, and the project\'s own flows and tests that open a browser. Everything else stays inside. If such a call is refused, do not judge the product by reading its code instead: say in what you return that the sandbox stopped the look.'
const MAYBE_SANDBOX = ' If `sz-eyes` says the session\'s command sandbox stopped it, run every command that opens a browser, a desktop app, a simulator or Docker outside the sandbox from the first try (`dangerouslyDisableSandbox: true` on the Bash call; the `sz:verify` skill says which). If that call is refused, do not judge the product by reading its code instead: say in what you return that the sandbox stopped the look.'
let SAND = MAYBE_SANDBOX
const GROUND = 'You are working in the project\'s folder. Read `.sz/map.md` first (if there is none, load `sz:onboard` and write it), then `.sz/spec.md`, `.sz/owner.md` (what the owner has said they want of this product: it comes before your own taste) and the last lines of `.sz/progress.md` if they exist. Follow the project\'s own rules as the map lists them. Other work of the owner\'s runs on this machine. Never use their simulator, browser profile or dev-server ports: a headless browser, the eyes\' own simulator, and for anything you launch a port taken from the machine (`PORT=$(sz-eyes port)`), never a number you chose. Before you look at what you launched, make sure it is yours that answers (your process is alive and the page is this product). End every server you start, by the process id you kept (`pid=$!` ... `kill $pid`): never by its port and never by its name, because what holds a port you wanted is somebody else\'s.'

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

const CLAIM = {
  type: 'object',
  properties: {
    id: { type: 'string', description: 'a short lowercase word with digits and dashes, unique in the milestone' },
    says: { type: 'string', description: 'what will be true of the running product, as the owner would say it and could see it, with the figure where there is one' },
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
          notDoing: { type: 'array', items: { type: 'string' } },
          risks: { type: 'array', items: { type: 'string' } },
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
          launch: { type: 'string', description: 'for a milestone that is built: the exact command that starts the product and where it is seen' },
          disputes: { type: 'array', description: 'for a milestone that is built: frozen checks an earlier run found to be wrong about how they check', items: { type: 'object', properties: { file: { type: 'string' }, problem: { type: 'string' } }, required: ['file', 'problem'] } },
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
    blocked: { type: 'string', description: 'empty unless the milestone could not be built at all, or could not be started for a reason outside the product (a download that does not arrive, a tool that is not on this machine): then what stopped it, with the figure' },
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
  },
  required: ['contractId', 'summary', 'launch'],
}
const STARTED = {
  type: 'object',
  properties: {
    launch: { type: 'string', description: 'the exact command that starts the product now, as you ran it and saw it start, and the address or app it is seen at' },
    summary: { type: 'string', description: 'what you had to do to make it start, in two sentences at most; empty if it started as said' },
    blocked: { type: 'string', description: 'empty unless it could not be started for a reason outside the product: then what stopped it, with the figure' },
  },
  required: ['launch'],
}
const VERDICT = {
  type: 'object',
  properties: {
    proven: { type: 'array', items: { type: 'string' }, description: 'claim ids shown true' },
    refuted: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, fact: { type: 'string', description: 'what happened instead, with the figure' } }, required: ['id', 'fact'] } },
    unchecked: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, why: { type: 'string' } }, required: ['id', 'why'] } },
    broken: { type: 'array', description: 'claims of earlier work that stood before this one and do not hold now', items: { type: 'object', properties: { key: { type: 'string', description: '<contract>/<claim>' }, fact: { type: 'string', description: 'what happened instead, with the figure' } }, required: ['key', 'fact'] } },
    held: { type: 'array', items: { type: 'string' }, description: 'claims of earlier work (<contract>/<claim>) that were shown again in this look and hold' },
    stood: { type: 'number', description: 'how many claims of earlier work hold after this look, counting those shown before' },
    noticed: { type: 'array', items: { type: 'string' }, description: 'what no claim covers and the owner would want to know' },
    sandbox: { type: 'string', description: 'empty unless the session\'s command sandbox stopped you from looking at the product and the call outside it was refused: then the exact refusal' },
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
    corrections: { type: 'array', items: { type: 'string' }, description: 'only when told not to edit .sz/map.md and .sz/spec.md here: each line of them this milestone made false, and what it should say now' },
  },
  required: ['report', 'closed', 'line'],
}

// ------------------------------------------------------------------ Plan
phase('Plan')
// A new product is planned twice: its first pass alone, and, when that stands, what comes after it. Claims for
// work that stands on a product nobody has seen are guesses, and the owner's first look is worth more than they are.
const AFTER = `

This run has just built and closed the product's first pass. Plan now what comes after it (you will find yourself in the case "Continue" below). You are planning from what is there, not from what the spec guessed: go through the pictures of every area and what its verifiers noticed (the first pass's evidence folder under \`.sz/evidence/\`, the newest lines of \`.sz/backlog.md\`), and start the product yourself only where they leave a question (\`.sz/map.md\` says how). Read \`.sz/owner.md\` first: what the owner has said since the first pass comes before the spec. What the verifiers noticed and nobody has mended goes into the first milestone you plan.`
// What the owner answered before the run, or that they were not asked: given as it is to whoever plans, the
// product or its screens.
const OWNER_ANSWERS = asked === 'owner' ? `What the owner answered when asked beforehand, in their words:\n${answers}` : 'The owner was not asked anything beforehand. Where the request leaves something open that only they could say (who it is for, how it should feel, accounts, keys, money), take the conservative answer and list it under "decided". Wherever you write this down (the spec, the progress line), say that they were not asked: never that they did not answer.' + (answers ? `\nNotes from the session that started this run (its own words, not the owner's):\n${answers}` : '')
// A new product with screens is drawn before it is built, and its owner decides on the drawing. (Built whole and
// shown afterwards, a product was called "an old flash game"; drawn first by one designer from a plan, as one
// clickable prototype, the same request read as an app, and the owner chose that way.) Where the design stands
// is found out first, so that a run that only draws, or only waits, costs a minute of planning and not a pass.
const DESIGN_CHECK = `Before anything else, find out where this product's design stands: it decides whether you plan at all in this run, and finding out takes a minute. First run \`sz-eyes sandbox\` once, as an ordinary command (do not ask for it to run outside any sandbox), and return under "sandboxed" whether it answered "sandboxed": everyone who works after you is told what it said. Then run \`ls .sz .sz/design\` and \`sz-eyes contract show design\`, and return under "design" the first of these that is so:
- "none": what was asked has no screen a person looks at (a command, a library, a service with no screen of its own); or \`.sz/spec.md\` is there, so the product has been worked on before (unless its first pass has not closed and contract \`design\` marks its claim **feel** [증명됨]: then "approved", and that first pass is still built to the drawing). Go on below as if this paragraph were not here.
- "again": contract \`design\` marks its claim **feel** [반증됨]: the owner looked at the prototype and said no. Return their words, as the claim's note gives them, under "said", and return at once, as for "needed".
- "approved": it marks **feel** [증명됨]: the owner said yes. Plan the first pass below, from the screens as planned and drawn.
- "needed": \`.sz/design/prototype.html\` is not there, or there is no contract \`design\`, or it marks its claim **screens** other than [증명됨] (a design stage stopped before its screens held). Return at once: mode "new", what was asked in two sentences as "summary", no milestones. Write no spec, no map and nothing else: the screens are planned and drawn next, by others, who take up what is there.
- "waiting": the prototype is there and measured, and **feel** is marked [아직] or [확인 못 함]: the owner has not judged it. Return at once, as for "needed".${designGo ? `
This run was started with design "go": the owner said to go on from the measured prototype without waiting for their verdict. Where you would return "waiting", return "approved" and plan the first pass from the prototype as it is; its claim **feel** stays the owner's to judge, and nobody judges it for them.` : ''}

`
// What the owner said yes to is what the first pass is built to, and what its first look holds it to.
const DRAWN_PLAN = `
- When the design is "approved": the screens are planned (\`.sz/plan/frame.md\` and one file a screen under \`.sz/plan/screens/\`) and drawn (\`.sz/design/prototype.html\`; \`.sz/design/direction.md\` ends with what the builder needs: tokens, parts, each screen's parts and address), and the owner has ${designGo ? 'said to go on from the drawing without judging it first' : 'said yes to the drawing'}. The spec is cut from them and does not decide again what they decided: its areas are the frame's sections, its limits the frame's rules and numbers. Among the first pass's claims: every screen of the plan built as drawn, one claim shown by a look (each built screen beside its picture under \`.sz/design/shots/\`: the same content in the same order, made of the same parts, in the same tokens), and the claim about every screen at its limits, as below. What is real starts from the frame's sections 2 and 10, the list the owner saw at the drawing: look again at each (a key may be at hand since).`
const planIt = (stage) => agent(
  `${stage === 'after' ? '' : DESIGN_CHECK}You are planning a product (or a large change to one) that will then be built milestone by milestone with nobody watching. ${GROUND}${SAND} ${TOOLS}${stage === 'after' ? AFTER : ''}

The owner's request:
${request}

${OWNER_ANSWERS}

If \`.sz/spec.md\` already exists, the product has been worked on before. Read it, the contracts under \`.sz/contracts/\` (\`sz-eyes contract status\`, \`sz-eyes contract show <id>\`), \`.sz/progress.md\`, \`.sz/backlog.md\`, \`git log\` and \`sz-eyes standing\` (what earlier work proved and the product has to keep true). Do not plan again what is done and do not rewrite the spec's history. Then it is one of two cases, or both:
- **Continue** (mode "continue"): an earlier run stopped before finishing what the spec has, and the request asks for that. Return the spec's milestones with their claims as the contracts and the spec have them, each with its "state": "closed" (its contract is closed), "built" (its contract is frozen and its code is committed, and it was not verified to the end: give "contractId", "launch", and under "disputes" any frozen check the earlier run reported as wrong about how it checks) or "todo". A milestone whose code was written and that nobody has seen run is still "built" (say under "launch" how it is meant to be started, and that it has not been): this run starts it, and fixes what keeps it from starting, before anyone looks at it. If the product's first pass is not closed yet (an earlier run stopped before it was), return it with "first": true and list what the spec has after it under "later", without claims: that is planned when the first pass stands. Once the first pass is closed, what the spec lists as coming after it and has no contract yet is planned now: write each as a milestone into the spec and return it as "todo" with its claims, ${Math.max(1, maxMilestones - 1)} at most, the rest left listed for a later run. The order of the milestones that are not built yet is decided afresh by the rule under "The order" below: some of them may go side by side now even if the spec lists them in a line (give them "after").
- **Extend** (mode "extend"): the request asks for something the spec does not have, or for something to work differently. Amend \`.sz/spec.md\` so that it describes the product as it will be: change the lines that become false, add the new features to the order they are built in under new milestone names. Return the milestones that are not closed yet plus the new ones (state "todo"), with ids no contract has used. For each new milestone, besides its claims:
  - If \`git worktree list\` shows folders under \`.sz/trees/\`, an earlier run built milestones side by side and stopped before bringing them together: for each such milestone whose contract exists, state "built" (or "closed" if its contract is closed there) and "where": that folder's whole path.
  - "supersedes": the standing claims that will stop being true because what was asked has changed, each with the reason. Be exact: a standing claim you do not list stays a promise, and the milestone must keep it true. Prefer a change that keeps old promises (a new choice whose default is the old behaviour) to one that replaces them.
  - If it changes the shape of what is stored, one claim says that what was saved before the change is still there after it, shown by a test that starts from data in the old shape. The product carries over what exists; nobody is asked to delete their data.
${stage === 'after' ? 'First, whichever mode it is: run `sz-eyes sandbox` once, as an ordinary command (do not ask for it to run outside any sandbox), and return under "sandboxed" whether it answered "sandboxed". Everyone who works after you is told what it said.\n' : ''}
Write no product code. Add a line to \`.sz/progress.md\` and commit \`.sz/\` if you amended the spec. If there is no spec yet (mode "new"):

Write \`.sz/spec.md\` in the owner's language: what the product is and for whom, the one thing it must do well, every area of it a person will use (a line each), how it is launched and looked at, and what is deliberately not built. A new product is made in three passes, and you plan the first now.

**The first pass** is the one milestone you return: the whole product, at the quality it will be used at, built in one stretch by one builder who keeps all of it in mind, and then looked at whole by someone who did not build it. (Cut into slices, each wrapped in a contract, a verification and a close of its own, one product was a single page after three hours, with every claim proven and none refuted; another had nothing to look at after four.)
- All of it: every area the spec lists, each to the depth a person needs to use it for real: what happens when there is nothing yet, when something fails, the second time someone comes. The one thing the product is for is made first and carried furthest.
- Nothing pretends. No made-up figures, no button that does nothing, no screen that only looks finished. What may be left not real, and who says so, is below (**What is real**).
- What a person enters is theirs from the start, with the least account the product can be used with (a guest of this device, or a code by e-mail).
- Its claims are the product's list of what a person can do, and the definition of done the builder works down: 8 to 20 of them, grouped by area, each shown by a flow (name the file it will be kept in: whoever verifies writes it), a test of what is pure rule (written before the code), a look or a command, with the figure or the words where there are any. Among them: every area's screen at phone size as pictures the owner can go through in one sitting (a look, kept in the evidence folder), and how it feels, which is the owner's to judge on those pictures (owner).${stage === 'after' ? '' : DRAWN_PLAN}

**Hardening** comes after it. List under "later", a line each, what makes the product safe to give to people (signing in through other services, deleting an account, one person unable to reach another's data, the phone itself, what the law asks, the app icon made as a picture in the colour the owner settled on, two or three for them to choose from), and anything in the request that is too uncertain or too large for the first pass, said as that. Give these no claims: they are planned when the first pass stands and has been looked at. ${Math.max(1, Math.min(maxMilestones, 6) - 1)} lines at most.

What holds for every milestone, this one and those planned later:
- **What is real.** ${REAL} Return under each milestone's "notReal" what it leaves not real yet, an entry each (empty when all of it is real), with "onPath" and "named" marked. Before any builder starts, the workflow looks for the words under "said" in the request and the answers; where they are not there, it builds nothing and asks the owner for what is needed. Each entry says so in one plain line on its screen, and the spec names it. The claim of the one thing is worded on real input and real data (the photograph a person takes, the prices as published), never on examples.
- If the owner had a case made for this service (\`sz-eyes worth show\` lists one: who it is for, what they use instead, the rows of the whole job), the spec is cut from it: the product is for the person and the moment of its \`who\` line; the first pass carries the row of kind \`edge\` furthest, and the first milestone after it delivers that row whole; the rows of kind \`stake\` (what two or more of the things people already use have in common) are all in a milestone or named in the spec as deliberately not built, with the reason; rows of kind \`more\` wait. Name in each milestone the rows it covers, by their ids. If there is no case, plan without one: making a case is done only when the owner asks for it.
- An app for the phone made with a toolkit that also runs in a browser (Expo and React Native do): it is built so that the same app runs in a browser, and until the last pass it is shown there, at phone size, where a look takes seconds. What only a phone has (what the app keeps when it is closed and opened again, coming back from another app after signing in, the camera, health data, notifications, the keyboard over a button) gets a plain fallback in the browser, and is named in the line "on the phone" under "later": that milestone makes the native build and shows those things, and the main path once, on a simulator. (A first native build took four hours before one screen was seen, and most of what it found was its own toolchain.) Only when the toolkit cannot run in a browser does the first pass begin with the empty app running on a simulator, before any screen of the product is written.
- Every milestone leaves the product working. A later milestone never depends on something a milestone before it left broken.
- **The order.** A line is the default: each milestone after the one before it, and you leave "after" out. Put milestones side by side (give them the same "after") only when every one of these is true of each of them: it does not change the shape of what is stored and does not touch accounts or who may do what (such a milestone is "alone": true and has nothing beside it); it adds screens, routes and modules of its own, and where it changes a file the others also change, it adds to a list there (a route table, a menu, an export) and does not rewrite the same lines; none of its claims needs what another of the group builds. Say under "touches" what each of them changes. The first milestone always has nothing beside it. Three side by side at most. When in doubt, a line: milestones built side by side are each proven in a folder of their own, and are shown again together only after they are brought into one, which costs a look each time and a repair when the guess was wrong.
- A product people use is more than a screen: where it keeps what a person enters, what happens when there is nothing yet, when something fails, the second time someone comes. Each milestone after the first pass carries these for its own area; they are not left for the end.
- A product that lives is looked after: from the first milestone it writes down what failed (a log the owner can read) and counts the one thing it is for (started, finished), and \`.sz/map.md\` says where. Without that nobody can tell later whether it works for people.
- A product is made to be put where people reach it. Choose what it stands on with \`sz:backend\` and say in the spec which and why, in two lines. From the first milestone: its settings come from the environment (no secret and no address of this machine in the code), \`/healthz\` answers with the commit it was built from, and every flow runs against the address in \`SZ_URL\` when given one and starts a server of its own only when not. If people have accounts in it, one milestone's claims say that one person cannot read or change what another stored, and neither can someone not signed in, shown by a flow with two people.
- A claim does not state as true a fact about the world that nobody has read from its source. Where the request gives one (a limit, a price, a rule of somebody else's service), the claim says that the product follows the source and shows it with the day it was read, and the spec keeps the request's figure as what the owner wrote. A claim that repeats such a figure cannot be made true if the source says otherwise, and the work stops on it.
- A claim about every screen (nothing cut off, nothing that scrolls sideways, nothing to press smaller than 44px) is a claim at the product's limits, and says so: the spec states each limit (the longest name, the longest sentence a person may write, the largest figure), and the claim is shown by a flow that fills every field with its longest value and measures every screen in every state, named like any other flow. Pictures of the usual case do not show it, and stated without its limits it can be shown false for ever by a longer input. (Four first passes each went a second round on such a claim: a name cut off, mended, and the same name cut off on another screen.)
- A milestone after the first pass has 3 to 7 claims. A claim is something true of the running product that can be shown: with the figure, the words on the screen, the state. Each says how it is shown: a flow (name the file it will be kept in, in the project's own format: whoever verifies writes it), a test of what is pure rule (written before the code), a look at a named screen in a named state, or a command. One claim says what the milestone must not break. What only a person can judge is one claim shown by "owner".
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
const DESIGN_GROUND = 'You are working in the project\'s folder, on a new product whose screens are drawn and put before its owner before anything of it is built. The command `sz-eyes` is on your PATH (the sz plugin\'s). Read `.sz/owner.md` if it is there (what the owner has said they want of this product: it comes before your own taste). What an earlier run of this stage left under `.sz/plan/` and `.sz/design/` is taken up where it stopped, not started again.'
const SWEEP = 'sz-eyes web sweep "file://$PWD/.sz/design/prototype.html" --from .sz/design/sweep.txt --size phone --out .sz/design/shots'
const WAITS = 'the prototype waits for the owner: nothing is built until they have seen it and said. Open .sz/design/prototype.html for them (at a phone\'s width each screen is shown alone at prototype.html#<id>; the pictures are in .sz/design/shots/), and record what they say, in their words: sz-eyes contract judged design feel --verdict yes|no --said "<their words>". Their verdict is theirs: nobody gives it for them. Then run this workflow again: on yes it plans the first pass and builds it to the drawing, on no it draws again what they said.'
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
    sandbox: { type: 'string', description: 'empty unless the session\'s command sandbox stopped the browser and the call outside it was refused: then the exact refusal' },
  },
  required: ['screens', 'hold', 'findings'],
}
// What the last measurement of the prototype showed, for the session the run returns to.
let designed = null
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
2. \`${SWEEP}\`. It opens one browser, measures every screen in it, prints for each what it found and then a summary line, and keeps a picture of each.
3. A screen the prototype does not have shows the overview, and the sweep counts it as holding. Pictures that are the same byte for byte (\`shasum .sz/design/shots/*-phone.png\`) show the same thing: open those, and a screen of the plan that is not shown alone at its address does not hold.
4. ${
      again
        ? `Contract \`design\` is there: record on it. \`sz-eyes contract claim design screens --status proven|refuted --note "<the sweep's summary line>"\`: proven only when every screen of the plan is there and holds. When it is, the drawing is the owner's to judge again: \`sz-eyes contract claim design feel --status unchecked --note "<in the owner's language: what they said last time, and what was changed for it>"\`, as an owner's claim that waits for them is marked. While a screen does not hold, leave **feel** as it is.`
        : `If there is no contract \`design\` yet (\`sz-eyes contract show design\`), record it, its words in the owner's language, then \`sz-eyes contract freeze design\`, with no files:
\`sz-eyes contract new design --lane M --request "<the product in a sentence, in the owner's language>" --claim "screens|<every screen of the plan is in the prototype and none is cut off, at phone size and at its limits>|command:<the sweep command as you ran it>" --claim "feel|<the owner's own judgement: this is the product, build it as drawn>|owner:.sz/design/prototype.html"\`
Then \`sz-eyes contract claim design screens --status proven|refuted --note "<the sweep's summary line>"\`: proven only when every screen of the plan is there and holds. Leave **feel** to the owner.`
    }

Change nothing in the prototype or the plan. Return how many screens the plan has, how many of them hold, how many drawings the sweep measured (its summary line counts every drawing, a screen's states and limits too, and calls each a screen), and every screen that does not hold (a drawing at its limits too) with what was found.`,
    { label: 'sweep:design', phase: 'Design', schema: SWEPT, ...effort('close') },
  )
const holds = (swept) => Number(swept.screens) > 0 && Number(swept.hold) >= Number(swept.screens) && (swept.findings || []).length === 0

// Draws a new product's screens, or draws them again from what the owner said, and measures them. Returns why
// the run stops short of putting them before the owner, or null when every screen holds.
async function drawScreens(state, said) {
  phase('Design')
  if (state === 'again') {
    log(`the owner said no to the prototype: it is drawn again from what they said, and put before them again`)
    const redrawn = await agent(
      `You are the designer of a new product, and its owner has looked at the prototype of its screens and said no. ${DESIGN_GROUND}${SAND} Load the \`sz:design\` skill: it is how the prototype was made, and how you change it.

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

A designer starts drawing the moment \`.sz/plan/frame.md\` exists, and takes each screen as its file appears. So write the frame whole and as soon as you can, before any screen; then the screens in order, without going back to change one that is written. (Planned whole first and drawn after, 25 screens took 19 minutes to plan before the drawing could start.) What the request and the answers leave open is decided in the frame and marked as decided there.

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

Load the \`sz:design\` skill and do its step 1 ("Look at how shipped products do these screens"), and only that: a designer beside you does the rest, and waits for your board. Do not wait for the plan of the screens, which is being written at the same time: name the kinds of screen this product stands on from the request, and start with the house library. Before you write the board, read \`.sz/plan/frame.md\` (wait for it if it is not there yet: \`until [ -e .sz/plan/frame.md ]; do sleep 10; done\`) and check your kinds against its one thing and its list of screens; change a kind it shows to be wrong. Write \`.sz/design/refs.md\` last, whole, under another name and renamed when it is: the designer starts the moment it exists. (Made alone, a board took 10 minutes.)

Return the primary reference and the kinds of screen the board covers.`,
          { label: 'refs', phase: 'Design', schema: BOARD, ...effort('build'), ...model('design') },
        ),
      () =>
        agent(
          `You are the designer of a new product: you draw every screen of it in its final look, as one clickable prototype, before anything of it is built. ${DESIGN_GROUND}${SAND}

The owner's request:
${request}

Load the \`sz:design\` skill and follow it, the whole stage, by yourself: start no other agent (one hand, one file, one set of parts is what makes the screens read as one product). Two others started with you: one writes the plan of the screens (\`.sz/plan/frame.md\` first, then a file a screen), one the reference board (\`.sz/design/refs.md\`). Wait for both before you decide anything:
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
      `You are the designer of a new product's prototype, mending what a measurement found. ${DESIGN_GROUND}${SAND} Load the \`sz:design\` skill: its parts, its words and its look hold here as when it was drawn.

Someone who did not draw it measured \`.sz/design/prototype.html\` at phone size (\`${SWEEP}\`, the screens listed in \`.sz/design/sweep.txt\`), and these do not hold:
${findings}

Mend the part, not the screen: a name cut off in one row is cut off in every row made from that part, so the cause is mended where the part is defined, and every screen made from it has the mend. A screen of the plan that the prototype does not have is drawn now, from its file under \`.sz/plan/screens/\`, of the same parts. Then run the same sweep yourself until it reports nothing (a third run means a part is wrong, not a screen). Change nothing in the plan, and start no other agent. Return what you changed.`,
      { label: `fix:design:${round}`, phase: 'Design', ...effort('build'), ...model('design'), schema: { type: 'object', properties: { changed: { type: 'string' } }, required: ['changed'] } },
    )
    swept = await sweepDesign(state === 'again')
  }
  if (swept) designed = { prototype: '.sz/design/prototype.html', screens: swept.screens, hold: swept.hold, findings: swept.findings || [], summary: swept.summary || '' }
  if (!swept) return 'the prototype was drawn and could not be measured (nobody answered)'
  if ((swept.sandbox || '').trim() !== '') return `the prototype was drawn and could not be measured: the session's command sandbox stopped the browser and the call outside it was refused (${swept.sandbox.trim().slice(0, 200)}). The owner chooses one: run sessions in auto mode, approve the unsandboxed command when asked, or turn the sandbox off for this project (/sandbox); then ask to continue.`
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
  return { mode: plan.mode || null, summary: plan.summary || '', decided: plan.decided || [], spec: '.sz/spec.md', design: designed, milestones: [], joins: [], forOwner: [], notBuilt: [...milestones.filter((m) => m.state !== 'closed').map((m) => m.title), ...(more ? later : [])], needed, stopped }
}

let plan = await planIt('start')
if (!plan) return { error: 'no plan came back' }
if (plan.sandboxed === true) SAND = IN_SANDBOX
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
  if (plan.sandboxed === true) SAND = IN_SANDBOX
  design = DESIGNS.includes(plan.design) ? plan.design : 'none'
}
if (design === 'waiting' || design === 'needed' || design === 'again') return stopAtDesign(WAITS)
if (!Array.isArray(plan.milestones) || plan.milestones.length === 0) return { error: 'no plan came back' }
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
  log(`${whose}; the whole product can be looked at when the first pass closes`)
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
const DRAWN_BUILD = `, and it is settled: every screen was drawn before this build (\`.sz/design/prototype.html\`), and that drawing is what is built, so do not settle it again. \`.sz/design/direction.md\` ends with what you need (빌더에게: the tokens, the parts, each screen's parts and its address in the prototype). Carry the prototype's tokens and parts: for a web product its markup and CSS as they are; for a phone app the tokens, the parts and each screen's order, written again in the toolkit. Each screen is built as drawn: the same content in the same order, made of the same parts, in the same tokens. \`sz:taste\` is for what the design leaves open.`
const AS_DRAWN = ` Every screen of this product was drawn before it was built (\`.sz/design/prototype.html\`, a picture of each under \`.sz/design/shots/\`), and the first pass was built to that drawing. For the claim that every screen is built as drawn, where it is yours: take a picture of each built screen the way \`sz-eyes web sweep\` does (one browser, every screen at phone size, \`--out\` a folder under the contract's evidence folder) and set it beside its drawing. A difference in content, order, parts or tokens is that claim shown false, with the screen named.`
const FIRST = `This milestone is the product's first pass: all of it, in one stretch, by you. Work in this order. The look first${toDrawing ? DRAWN_BUILD : ' (load `sz:taste`: colour, type and spacing settled once, as names every screen uses).'} The frame: how a person gets from one area to another, and the shapes of everything that will be stored. Then the one thing the product is for, to the quality it will be used at. When that path works: start the product, write the command that starts it into \`.sz/map.md\`, put a picture of each of its screens at phone size into the contract's evidence folder under \`early/\`, and commit with a message that begins \"look:\". The owner may open it from then on, before anything else exists. Then every other area, each to its claims. Work down the claims, and run each flow as you finish what it shows. Before you return, fill every field with the longest value the spec allows and look at every screen at phone size (\`sz-eyes web look <address> --size phone\` says what is cut off, what scrolls sideways and what is too small to press): mend it wherever the same thing is shown, not on the one screen where you saw it. Do not stop to report in between: you are done when every claim's own check passes and the product has run in front of you.
`
// What a claim costs to show, in tests' worth: a flow is written and run against the product, a look is pictures
// set beside drawings, and one that says something of every screen is the longest of all.
const EVERY_SCREEN = /every screen|all (the )?screens|each screen|모든 화면|화면마다|화면 \d+개|\d+개 화면/i
const weightOf = (c) => (c.kind === 'owner' ? 0 : c.kind === 'flow' || c.kind === 'look' ? (EVERY_SCREEN.test(String(c.says || '')) ? 6 : 3) : 1)
// The claims in the plan's order, cut where the running cost is nearest to an even share: null when one verifier
// is enough (about four flows' worth), five shares at most.
const sharesOf = (claims) => {
  const cost = claims.map(weightOf)
  const total = cost.reduce((a, b) => a + b, 0)
  if (total <= 12) return null
  const shares = Math.min(5, Math.ceil(total / 10))
  const parts = []
  let from = 0
  let sum = 0
  for (let k = 1; k < shares && from < claims.length; k++) {
    const aim = (total * k) / shares
    let to = from
    while (to < claims.length && (to === from || Math.abs(sum + cost[to] - aim) <= Math.abs(sum - aim))) sum += cost[to++]
    parts.push(claims.slice(from, to).map((c) => c.id))
    from = to
  }
  if (from < claims.length) parts.push(claims.slice(from).map((c) => c.id))
  return parts.length > 1 ? parts : null
}
async function milestone(m, n, before, where) {
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
  const resumed = Boolean(m.state === 'built' && m.contractId && m.launch)
  const started = !resumed
    ? null
    : await agent(
        `A milestone of this product was built by an earlier run and has not been verified to the end. Before anyone looks at it, start it. ${GROUND}${SAND} ${TOOLS}${PLACE}

Milestone "${m.title}" (${m.id}), contract \`${m.contractId}\` (read it: \`sz-eyes contract show ${m.contractId}\`). It is said to be launched like this: ${m.launch}

1. Commit what the earlier run left uncommitted, if it belongs to this milestone.
2. Start the product that way and see it running: its first screen in a browser, or for a phone app the build installed and opened on a simulator of your own (\`sz:verify\` says how, and what a first build of a phone app needs).
3. If it does not start, the cause is yours to find and to fix in the product. Do not edit the contract or the flows and tests it froze, and record no verdicts. Commit the fix, and correct \`.sz/map.md\` if how it is launched has changed.
4. If it cannot be started for a reason outside the product (a download that does not arrive, a tool that is not on this machine), do not wait on it: a download or a build that shows nothing new for a minute is stopped, and you say what stopped it under "blocked", with the figure.

Stop what you started, and return the exact command that starts it now.`,
        { label: `start:${m.id}`, phase: 'Build', schema: STARTED, ...effort('build'), ...model('build') },
      )
  const built = resumed ? (started ? { contractId: m.contractId, summary: started.summary || 'built in an earlier run', launch: started.launch || m.launch, blocked: started.blocked || '', disputes: m.disputes || [] } : null) : await agent(
    `You are building milestone ${n} of ${milestones.length} of a product, with nobody watching. ${GROUND}${SAND} ${TOOLS}${PLACE}

Milestone "${m.title}" (${m.id}): ${m.builds}
${m.first ? FIRST : ''}Milestones before it:
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
${FIRST_STEPS(m, replaces)}${m.first ? '' : ' If a claim is wrong about what was asked, build what you can and say so in "blocked".'}
4. ${m.first && toDrawing ? 'Build the milestone, each screen as drawn (`sz:taste` only for what the drawing leaves open).' : 'Build the milestone. For anything a person looks at, load `sz:taste` first; and where the product\'s screens were drawn before it was built (`.sz/design/direction.md` is there), the look is the one drawn: a new or changed screen is made of that file\'s tokens and parts (its last section, 빌더에게, lists them), and `sz:taste` is for what it leaves open.'} If it changes the shape of what is stored, it carries over what is already there (on start, or by a command the map names): data written by the version before must still open. Run the project's checks (type check, tests, the flows of earlier milestones) as you go and leave them passing.
5. Start the product yourself with one command and see it running before you return: its first screen in a browser, or for a phone app the build installed and opened on a simulator of your own (\`sz:verify\` says how, and what a first build of a phone app needs). Say exactly which command, and where it is seen. Then say that it stands: \`sz-eyes contract built ${m.id} --launch "<that command, and where it is seen>"\` (from then on the owner can be shown the product while it is verified). A milestone that has never run is not built: what stops it from starting is yours to fix here, not the verifier's to find. If it cannot be started for a reason outside the product (a download that does not arrive, a tool that is not on this machine), do not wait on it (a download or a build that shows nothing new for a minute is stopped) and say what stopped it under "blocked". ${where ? 'If this milestone changed how it is launched, say so in "summary" (the map is corrected when the milestones are brought together).' : 'If this milestone changed how it is launched, correct \`.sz/map.md\`.'}
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

  // A frozen check the builder says is itself wrong goes to someone who neither built nor judges: the arbiter
  // corrects how it checks, never what it checks, and writes the correction into the contract. (The first real
  // run stopped here for good: a check its builder had written with a quoting error could be fixed by nobody.)
  for (const dispute of built.disputes || []) {
    await agent(
      `Settle a dispute about a frozen check, met while building contract \`${built.contractId}\` in the project in ${here}.${PLACE} The file: \`${dispute.file}\`. It was frozen by that contract or by an earlier one that is closed: the contracts under \`.sz/contracts/\` say which, and a correction is recorded on the contract that froze it. What the builder says is wrong with it: ${dispute.problem}. The product is launched like this: ${built.launch}. Decide which it is (the check, the product, the claim, or a claim that what the owner asked later has replaced), act as your instructions say for that case, and return what you decided.`,
      { label: `arbiter:${m.id}`, phase: 'Build', agentType: 'sz:arbiter', ...effort('verify'), schema: { type: 'object', properties: { which: { type: 'string', enum: ['check', 'product', 'claim', 'replaced'] }, changed: { type: 'string' }, now: { type: 'string' } }, required: ['which', 'now'] } },
    )
  }

  const claimIds = new Set(m.claims.map((c) => c.id))
  const record = `\`sz-eyes standing record <contract>/<claim> --status holds|broken|unchecked --during ${built.contractId} --note "<what was run and what it showed>"\``
  // again: null for the first look, or what was shown false and has been worked on since.
  const verify = (again, share) =>
    agent(
      `Verify contract \`${built.contractId}\` of the project in ${here}.${PLACE}${SAND} The product is launched like this: ${built.launch}. ${
        again
          ? `This is a second look, after a fix. ${again.claims.length > 0 ? `These claims of the contract were shown false before: ${again.claims.join(', ')}. Check each from the start, on the product as it is now, and record it with \`sz-eyes contract claim\`. ` : ''}${again.standing.length > 0 ? `These promises of earlier work were found broken: ${again.standing.join(', ')}. Show each again and record it with ${record}. ` : ''}A fix can break a neighbour: show again this contract's other claims and what stood before (\`sz-eyes standing\`) by the project's whole check command run once where it has one, and a flow, test or command by itself only where that run failed or says nothing of a claim; flows that would get in each other's way on one copy (one moves the clock, one restarts the backend, one fills the database to its limits) run each on a copy of the product of its own (\`sz-eyes copy\`), at the same time and not one after another; report whatever fails now (a claim of this contract under "refuted", recorded with \`sz-eyes contract claim\`; a promise of earlier work under "broken", recorded as above). Claims you did not look at again keep their verdict: leave them out. A claim about every screen at the product's limits is judged by its flow, at the limits the spec states: an input the product does not accept shows nothing about it. Before the fix, this was noticed outside the claims: ${again.noticed.length > 0 ? again.noticed.map((n) => `[${n}]`).join(' ') : '(nothing)'}. Under "noticed" return each of those that is still so on the product as it is now (drop one the fix has ended) and whatever you notice that is new.`
          : `Give every claim a verdict and record each with \`sz-eyes contract claim\`. Then show again what stood before this work (\`sz-eyes standing\`) and record each with ${record}.`
      }${share ? ` You are one of ${share.of} verifiers looking at this contract at the same time. Yours are these claims: ${share.part.join(', ')}. Give a verdict to these and to no other. ${share.k === 0 ? 'You are also the one who shows again what stood before this work.' : 'Do not show again what stood before this work: another verifier does.'} Start a copy of the product of your own, on a port of your own and with a place of its own for what it stores (\`sz-eyes copy <a folder outside the project>\` makes one from what is committed: its files, its installed dependencies, a stack name of its own, and \`--with <path>\` what the map says is built and not in git; the map says how it is launched; never the same database file or folder as another copy) and, if it runs on a simulator, a simulator of your own (\`sz-eyes ios spare --name sz-${m.id}-${share.k + 1}\`), and stop what you started when you are done.` : ''}${again ? '' : WRITE_FLOWS(built.contractId)}${m.first && !again && toDrawing ? AS_DRAWN : ''}${REAL_LOOK(m)} I am telling you nothing about whether any claim is true. Record what you notice that no claim covers with \`sz-eyes contract notice\`, stop any server you start, and return the verdicts: under "broken" every promise of earlier work that does not hold now, under "held" every one you showed again that holds.`,
      { label: `verify:${m.id}${again ? ':again' : share ? `:${share.k + 1}of${share.of}` : ''}`, phase: 'Verify', agentType: 'sz:verifier', schema: VERDICT, ...effort('verify') },
    )
  // A milestone with much to show, its flows still to be written, is looked at by up to five verifiers at once,
  // each with claims of its own and a copy of the product of its own. The fix waits for the slowest of them, so
  // the shares go by what the claims cost to show and keep the plan's order (claims of one area stay with one
  // verifier). (2026-11-17: twenty claims cut in three by their count gave one verifier seven flows and 74
  // minutes and the others 45 and 61; one verifier alone had taken 17 minutes over 19 claims with flows written.)
  const lookTogether = async () => {
    const parts = sharesOf(m.claims)
    if (!parts) return verify(null)
    const looks = await beside(parts.map((part, k) => () => verify(null, { part, k, of: parts.length })))
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
  let verdict = await lookTogether()
  // A claim can be false because its own words are wrong: it repeats a fact about the world that the source
  // gives otherwise. No fix makes it true, and only the owner may change what was agreed. It is set aside for
  // them by someone who built nothing, with where the fact is read, and the work goes on. (Two of four runs on
  // one request stopped for the night on one such claim each; one of them had tried to fix the product twice.)
  const setAside = []
  const rule = async (said) => {
    const open = verdict.refuted
    if (open.length === 0) return
    const ruled = await agent(
      `Claims of contract \`${built.contractId}\` of the project in ${here} were shown false on the running product by someone who did not build it.${PLACE}${SAND} ${TOOLS} The product is launched like this: ${built.launch}.

The claims shown false, each with what happened instead:
${open.map((r) => `- ${r.id}: ${r.fact}`).join('\n')}
${said ? `What the one who was fixing them said could not be made true without changing what was asked:\n${said}` : ''}

For each, decide which it is. You built nothing and you take nobody's word: read the contract (\`sz-eyes contract show ${built.contractId}\`), look at the product, and open the source yourself.
- **The product is wrong.** It can do what the claim says and does not. Leave the claim as it is: this is the common case, and when in doubt it is this one.
- **The claim's own words are wrong.** They state as true a fact about the world (a limit, a price, a rule of somebody else's service) that its own source gives otherwise, or something that cannot be true together with another claim, and the product follows the source. Then record it, and change nothing else: \`sz-eyes contract dispute ${built.contractId} <claim id> --ruling "<what the claim says; what is so; where that is read: the address and the sentence>"\`. The claim's words stay as they were agreed, and the owner decides.

Change no product code, no flow, no test and no claim. Return what you decided for each.`,
      { label: `rule:${m.id}${said ? '' : ':last'}`, phase: 'Verify', agentType: 'sz:arbiter', ...effort('verify'), schema: { type: 'object', properties: { disputed: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, ruling: { type: 'string', description: 'what the claim says, what is so, and where that is read' } }, required: ['id', 'ruling'] } }, productWrong: { type: 'array', items: { type: 'string' } } }, required: ['disputed'] } },
    )
    const aside = ((ruled && ruled.disputed) || []).filter((d) => open.some((r) => r.id === d.id))
    if (aside.length === 0) return
    setAside.push(...aside)
    verdict = { ...verdict, refuted: verdict.refuted.filter((r) => !aside.some((d) => d.id === r.id)) }
    for (const d of aside) log(`${m.title}: claim "${d.id}" is set aside for the owner (its words are wrong, not the product): ${d.ruling.slice(0, 200)}`)
  }
  for (let round = 1; round <= 2 && verdict && verdict.refuted.length + (verdict.broken || []).length > 0; round++) {
    const wrong = verdict.refuted.map((r) => `- ${r.id}: ${r.fact}`).join('\n') || '(none)'
    const broke = (verdict.broken || []).map((b) => `- ${b.key}: ${b.fact}`).join('\n')
    const mended = await agent(
      `You are fixing a product so that claims shown false on it become true. ${GROUND}${SAND} ${TOOLS}${PLACE}

Contract \`${built.contractId}\` (read it: \`sz-eyes contract show ${built.contractId}\`). The product is launched like this: ${built.launch}.
Someone who did not build it operated the product and found these claims false:
${wrong}
${broke ? `And these were true before this work and are not now (each is a promise of earlier work: \`sz-eyes standing\` shows how it is checked):\n${broke}` : ''}

Find the cause of each in the product and fix it there. Where a claim is shown by pictures kept in the evidence folder (a look the owner will go through), take those pictures again from the product as you leave it: a picture from before your fix shows the fault you mended, and the claim is false again for that alone. Where a claim says something of every screen (nothing cut off, nothing too small to press), mend the cause wherever the same thing is shown, not only in the place named, and run that claim's flow over the whole product until it reports nothing before you return. Do not edit the contract, the flows or the tests it names, or those of earlier work, and do not record verdicts. Run the check of each claim you were handed until it passes (its flow, its test, its command), and the project's quick checks (its type check and its tests of pure rule). Do not run the other flows, of this contract or of earlier work: whoever looks again runs all of them once, side by side on copies of their own, and run here one after another they are most of an hour in which nothing is learned. Commit the fix. If a claim cannot be made true without changing what was asked, change nothing for it and say why. Nothing is put in as an example to make a claim true: what cannot be made real with what is at hand goes under "notFixed", with what it needs.`,
      { label: `fix:${m.id}:${round}`, phase: 'Build', ...effort('build'), ...model('build'), schema: { type: 'object', properties: { fixed: { type: 'array', items: { type: 'string' } }, notFixed: { type: 'array', items: { type: 'string' } } }, required: ['fixed'] } },
    )
    // What the fixer says cannot be made true is ruled on before anyone looks again: a claim set aside is not looked at twice more.
    if (mended && Array.isArray(mended.notFixed) && mended.notFixed.length > 0) await rule(mended.notFixed.join('\n'))
    if (verdict.refuted.length + (verdict.broken || []).length === 0) break
    const again = await verify({ claims: verdict.refuted.map((r) => r.id), standing: (verdict.broken || []).map((b) => b.key), noticed: verdict.noticed || [] })
    if (!again) break
    // A claim keeps its earlier verdict unless this look gave it a new one: what was shown false and was not
    // looked at again is still false, and a promise found broken is mended only when it was shown to hold.
    const proven = new Set(again.proven.filter((id) => claimIds.has(id)))
    const refuted = new Set(again.refuted.map((r) => r.id))
    const unchecked = new Set(again.unchecked.map((u) => u.id))
    const looked = (id) => proven.has(id) || refuted.has(id) || unchecked.has(id)
    const held = new Set(again.held || [])
    const brokenNow = new Set((again.broken || []).map((b) => b.key))
    verdict = {
      proven: [...verdict.proven.filter((id) => !looked(id)), ...proven],
      refuted: [...verdict.refuted.filter((r) => !looked(r.id)), ...again.refuted],
      unchecked: [...verdict.unchecked.filter((u) => !looked(u.id)), ...again.unchecked],
      broken: [...(verdict.broken || []).filter((b) => !held.has(b.key) && !brokenNow.has(b.key)), ...(again.broken || [])],
      stood: again.stood === undefined ? verdict.stood : again.stood,
      // The second look was handed what the first noticed and returns what of it is still so, plus what is new.
      noticed: again.noticed === undefined ? verdict.noticed || [] : again.noticed,
    }
  }
  if (verdict && verdict.refuted.length > 0) await rule('')
  if (verdict && (verdict.sandbox || '').trim() !== '') {
    stopped = `milestone "${m.title}" was built and could not be looked at: the session's command sandbox stopped the browser and the call outside it was refused (${verdict.sandbox.trim().slice(0, 200)}). Nothing is known to be wrong with the product. The owner chooses one: run sessions in auto mode, approve the unsandboxed command when asked, or turn the sandbox off for this project (/sandbox); then ask to continue.`
    log(stopped)
    return { entry: { id: m.id, title: m.title, contractId: built.contractId, proven: verdict.proven, refuted: verdict.refuted, unchecked: m.claims.filter((c) => !verdict.proven.includes(c.id)).map((c) => ({ id: c.id, why: 'the command sandbox stopped the look' })), noticed: verdict.noticed || [], report: null }, stopped }
  }
  if (!verdict) {
    stopped = `milestone "${m.title}" was built and could not be verified (the verifier did not answer)`
    log(stopped)
    return { entry: { id: m.id, title: m.title, contractId: built.contractId, proven: [], refuted: [], unchecked: m.claims.map((c) => ({ id: c.id, why: 'the verifier did not answer' })), noticed: [], report: null }, stopped }
  }

  const closed = await agent(
    `Close milestone "${m.title}" of the project in ${here}. ${TOOLS}${PLACE}
1. \`sz-eyes evidence ${built.contractId}\` writes the evidence page; note its path.
2. ${verdict.refuted.length + (verdict.broken || []).length === 0 ? `\`sz-eyes contract close ${built.contractId}\` (it also writes what the verifier noticed and what could not be checked to \`.sz/backlog.md\`). It refuses when most of the claims were not looked at: then do not pass \`--accepted\` (that is the owner's to say), leave the contract open, and return "closed": false with what it said under "why".` : 'Leave the contract open: it has claims shown false, or broke what stood before it.'}
3. ${where ? 'If this milestone made a line of \`.sz/map.md\` or \`.sz/spec.md\` false (how it is launched, where it keeps things, what it does), do not edit them here: return under "corrections" each such line and what it should say now.' : 'If this milestone made a line of \`.sz/map.md\` or \`.sz/spec.md\` false (how it is launched, where it keeps things, what it does), correct that line.'} If the project has a case (\`sz-eyes worth show\`) and the contract is closed, mark each row of the whole job that a claim proven here covers: \`sz-eyes worth row <case> <row> --ours have --by ${built.contractId}/<claim>\`. Only rows a proven claim shows; the rest stay as they are.
4. Read \`sz-eyes backlog\`. For each open line that this milestone has ended (the thing it names is built or fixed now, and a claim proven here or a commit of this milestone shows it), run \`sz-eyes backlog done "<some words of the line>" --by "${built.contractId}/<claim>, or the commit"\`. Tick only what is shown to be ended; a line that is half done stays open.
5. Add one line to \`.sz/progress.md\` in the owner's language: the date, the milestone, how many claims are proven, refuted and unchecked, and each claim set aside for the owner with what they have to decide, how many promises of earlier work were shown again and whether any broke or was replaced, anything the verifier noticed that the owner should know, and what comes next. The figures are these, as the verifier returned them: ${verdict.proven.length} proven, ${verdict.refuted.length} refuted, ${verdict.unchecked.length} unchecked${verdict.stood === undefined ? '' : `; of what stood before this milestone, ${verdict.stood} hold`}, ${(verdict.broken || []).length} broken, ${(m.supersedes || []).length} replaced. Use them in the line and in the commit message; do not count again from \`sz-eyes standing\`, which after closing also counts this milestone's own claims.
6. Commit \`.sz/\` (the contract, the evidence, the standing record, the backlog, the progress line)${where ? ', on this folder\'s own branch' : ''}.
Change no product code.`,
    { label: `close:${m.id}`, phase: 'Close', schema: CLOSED, ...effort('close') },
  )
  const broken = verdict.broken || []
  const entry = { id: m.id, title: m.title, contractId: built.contractId, launch: built.launch, setAside, proven: verdict.proven.filter((id) => !setAside.some((d) => d.id === id)), refuted: verdict.refuted, unchecked: verdict.unchecked, broken, stood: verdict.stood === undefined ? null : verdict.stood, replaced: m.supersedes || [], noticed: verdict.noticed || [], report: closed ? closed.report : null, corrections: (closed && closed.corrections) || [] }
  log(`${m.title}: ${verdict.proven.length} proven, ${verdict.refuted.length} refuted, ${verdict.unchecked.length} unchecked${verdict.stood === undefined ? '' : `; of what stood before, ${verdict.stood} hold and ${broken.length} broke`}`)

  // Nothing is built on a milestone that is known to be broken: the owner is told where it stands instead. The
  // contract's own word decides, not what the agents reported: a contract that would not close is not done.
  if (verdict.refuted.length + broken.length === 0 && !(closed && closed.closed === true)) {
    stopped = `milestone "${m.title}" was verified and its contract did not close: ${closed ? closed.why || 'sz-eyes contract close refused' : 'the closer did not answer'}`
    log(stopped)
    return { entry, stopped }
  }
  if (verdict.refuted.length + broken.length > 0) {
    stopped = `milestone "${m.title}" still has ${verdict.refuted.length} claim(s) shown false and ${broken.length} promise(s) of earlier work broken after two fixes: ${[...verdict.refuted.map((r) => `${r.id} (${r.fact})`), ...broken.map((b) => `${b.key} (${b.fact})`)].join('; ')}`
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
Run nothing else and judge nothing.`,
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
    const record = `\`sz-eyes standing record <contract>/<claim> --status holds|broken|unchecked --during ${lastId} --note "<what was run and what it showed>"\``
    const look = (again) =>
      agent(
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
      await agent(
        `You are fixing a product after milestones that were built side by side were brought into one. ${GROUND}${SAND} ${TOOLS}

Each was proven alone. Together, these promises do not hold (each is a standing claim: \`sz-eyes standing\` shows how it is checked):
${broke}

Find the cause in the product (usually two milestones that each changed the same thing their own way) and fix it there so that all of them hold. Do not edit a contract or the flows and tests one names, and do not record verdicts. Run the project's checks. Commit the fix.`,
        { label: `mend:${group.map((m) => m.id).join('+')}:${round}`, phase: 'Build', ...effort('build'), ...model('build'), schema: { type: 'object', properties: { fixed: { type: 'array', items: { type: 'string' } }, notFixed: { type: 'array', items: { type: 'string' } } }, required: ['fixed'] } },
      )
      const again = await look(gate.broken.map((b) => b.key))
      if (!again) break
      gate = again
    }
  }
  joins.push({ ids: group.map((m) => m.id), merged: [...merged], notMerged: out.map((m) => m.id), stood: gate && gate.stood !== undefined ? gate.stood : null, broken: (gate && gate.broken) || [], noticed: (gate && gate.noticed) || [] })
  for (const m of group) if (merged.has(m.id)) closedIds.add(m.id)
  if (merged.size > 0 && !gate) return `milestones ${[...merged].join(', ')} were brought together and could not be shown together (the verifier did not answer)`
  if (gate && (gate.sandbox || '').trim() !== '') return `milestones ${[...merged].join(', ')} were brought together and could not be looked at: the session's command sandbox stopped the browser and the call outside it was refused (${gate.sandbox.trim().slice(0, 200)}). The owner chooses one: run sessions in auto mode, approve the unsandboxed command when asked, or turn the sandbox off for this project (/sandbox); then ask to continue.`
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
Return each id with the whole path of its folder (\`pwd\` inside it).`,
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
