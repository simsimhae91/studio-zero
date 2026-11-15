export const meta = {
  name: 'build',
  description: 'Build a product or a large feature to the end, unattended: a spec, then milestone by milestone a frozen contract, the build, a verification by an agent that did not build it, fixes, and a page of evidence',
  whenToUse: 'A new product or a change of several features (lane L), after the owner has answered what only they can answer and has asked for it to run to the end without them.',
  phases: [
    { title: 'Plan', detail: 'the spec and its milestones, each with the claims that make it done' },
    { title: 'Build', detail: 'one milestone at a time: contract, oracle, code' },
    { title: 'Verify', detail: 'each claim shown on the running product by an agent that did not build it' },
    { title: 'Close', detail: 'evidence page, progress line, commit' },
  ],
}

// args: { request: string, answers?: string, maxMilestones?: number }
// `request` is the owner's words. `answers` is what they said to the questions asked before this run (or the
// conservative answers taken for them, marked as such). The run asks nobody anything: what is open is decided
// conservatively and written down.
const request = args && typeof args.request === 'string' ? args.request.trim() : ''
const answers = args && typeof args.answers === 'string' ? args.answers.trim() : ''
const maxMilestones = args && Number.isInteger(args.maxMilestones) ? args.maxMilestones : 6
if (request === '') return { error: 'give args: { request: "<what to build, in the owner\'s words>", answers?: "<what the owner answered>" }' }

const TOOLS = 'The command `sz-eyes` is on your PATH (the sz plugin\'s). Load the skills you need with the Skill tool: `sz:work` (how work is sized, contracted and closed), `sz:verify` (how a product is launched, looked at and operated, and what counts as evidence), `sz:taste` (how a screen is put together, for anything a person looks at in a product made here).'
const GROUND = 'You are working in the project\'s folder. Read `.sz/map.md` first (if there is none, load `sz:onboard` and write it), then `.sz/spec.md` and the last lines of `.sz/progress.md` if they exist. Follow the project\'s own rules as the map lists them. Never use the owner\'s own simulator, browser profile or dev-server ports: a headless browser, the eyes\' own simulator, and a port the map does not name. Stop every server you start.'

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
    summary: { type: 'string', description: 'two or three sentences: what the product is, for whom, and the shape you chose' },
    decided: { type: 'array', items: { type: 'string' }, description: 'what the request and the answers left open and how you decided it' },
    milestones: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'a short lowercase word with digits and dashes' },
          title: { type: 'string' },
          builds: { type: 'string', description: 'what is built in it, in two or three sentences' },
          claims: { type: 'array', items: CLAIM },
          notDoing: { type: 'array', items: { type: 'string' } },
          risks: { type: 'array', items: { type: 'string' } },
        },
        required: ['id', 'title', 'builds', 'claims'],
      },
    },
  },
  required: ['summary', 'milestones'],
}
const BUILT = {
  type: 'object',
  properties: {
    contractId: { type: 'string' },
    summary: { type: 'string', description: 'what was built, in three sentences at most' },
    launch: { type: 'string', description: 'the exact command that starts the product now, and the address or app it is seen at' },
    blocked: { type: 'string', description: 'empty unless the milestone could not be built: then what stopped it' },
  },
  required: ['contractId', 'summary', 'launch'],
}
const VERDICT = {
  type: 'object',
  properties: {
    proven: { type: 'array', items: { type: 'string' }, description: 'claim ids shown true' },
    refuted: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, fact: { type: 'string', description: 'what happened instead, with the figure' } }, required: ['id', 'fact'] } },
    unchecked: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, why: { type: 'string' } }, required: ['id', 'why'] } },
    noticed: { type: 'array', items: { type: 'string' }, description: 'what no claim covers and the owner would want to know' },
  },
  required: ['proven', 'refuted', 'unchecked'],
}
const CLOSED = {
  type: 'object',
  properties: { report: { type: 'string', description: 'path of the evidence page' }, commit: { type: 'string' }, line: { type: 'string', description: 'the line added to .sz/progress.md' } },
  required: ['report', 'line'],
}

// ------------------------------------------------------------------ Plan
phase('Plan')
const plan = await agent(
  `You are planning a product (or a large change to one) that will then be built milestone by milestone with nobody watching. ${GROUND} ${TOOLS}

The owner's request:
${request}

${answers ? `What the owner answered when asked beforehand:\n${answers}` : 'The owner was not asked anything beforehand. Where the request leaves something open that only they could say (who it is for, how it should feel, accounts, keys, money), take the conservative answer and list it under "decided".'}

Write \`.sz/spec.md\` in the owner's language: what the product is and for whom, the one thing it must do well, its features in the order they will be built, how it is launched and looked at, and what is deliberately not built. Then cut the work into ${Math.min(maxMilestones, 6)} milestones at most:
- The first milestone is the thinnest slice that runs end to end and can be launched and looked at: one real thing a person can do, saved or computed for real. Not scaffolding alone.
- Every milestone leaves the product working. A later milestone never depends on something a milestone before it left broken.
- A product people use is more than a screen: where it keeps what a person enters, what happens when there is nothing yet, when something fails, the second time someone comes. Put those in the milestones where they belong, not at the end.
- For each milestone give 3 to 7 claims. A claim is something true of the running product that can be shown: with the figure, the words on the screen, the state. Each says how it is shown: a flow file or test that will be written before the code (name the file, in the project's own format), a look at a named screen in a named state, or a command. One claim says what the milestone must not break. What only a person can judge is one claim shown by "owner".
- Do not write product code in this step. Add a line to \`.sz/progress.md\` saying the spec is written, and commit \`.sz/\`.

Return the plan.`,
  { label: 'plan', phase: 'Plan', schema: PLAN },
)
if (!plan || !Array.isArray(plan.milestones) || plan.milestones.length === 0) return { error: 'no plan came back' }
const milestones = plan.milestones.slice(0, maxMilestones)
log(`spec written: ${milestones.length} milestone(s): ${milestones.map((m) => m.title).join(' / ')}`)

// ------------------------------------------------------------------ milestone by milestone
// One at a time: they share one working tree, and each stands on the one before it.
const done = []
let stopped = null
for (let i = 0; i < milestones.length; i++) {
  const m = milestones[i]
  const before = done.map((d) => `- ${d.title}: ${d.refuted.length === 0 ? 'proven' : `left with ${d.refuted.length} claim(s) refuted`}`).join('\n') || '(this is the first)'
  const claims = m.claims.map((c) => `- ${c.id} | ${c.says} | ${c.kind}:${c.ref}`).join('\n')

  const built = await agent(
    `You are building milestone ${i + 1} of ${milestones.length} of a product, with nobody watching. ${GROUND} ${TOOLS}

Milestone "${m.title}" (${m.id}): ${m.builds}
Milestones before it:
${before}

Its claims, agreed before you start (id | what will be true | how it is shown):
${claims}
${m.notDoing && m.notDoing.length > 0 ? `Not done in this milestone: ${m.notDoing.join('; ')}` : ''}
${m.risks && m.risks.length > 0 ? `Risks named when it was planned: ${m.risks.join('; ')}` : ''}

Do this, in order:
1. Record the contract: \`sz-eyes contract new ${m.id} --lane M --request "<the milestone in a sentence, in the owner's language>" --target <web|ios|...> --claim "<id>|<says>|<kind>:<ref>" ...\` with exactly the claims above, plus \`--not\` and \`--risk\` for the lines above.
2. Write the oracle first: every flow or test file a claim points at, in the project's own format, before the code it checks. They must fail now for the right reason.
3. Freeze it: \`sz-eyes contract freeze ${m.id} --frozen <each of those files>\`. From here you edit neither the contract nor those files. If a claim turns out to be wrong about what was asked, do not bend it: build what you can and say so in "blocked".
4. Build the milestone. For anything a person looks at, load \`sz:taste\` first. Run the project's checks (type check, tests) as you go and leave them passing.
5. Make sure the product starts with one command and say exactly which, and where it is seen. If this milestone changed how it is launched, correct \`.sz/map.md\`.
6. Commit the work on the current branch with a message that says what the milestone built.

Do not judge your own claims and do not record verdicts: someone who did not build this will operate it. Do not leave a server running.`,
    { label: `build:${m.id}`, phase: 'Build', schema: BUILT },
  )
  if (!built || (built.blocked && built.blocked.trim() !== '')) {
    stopped = `milestone "${m.title}" could not be built: ${built ? built.blocked : 'the builder did not answer'}`
    log(stopped)
    break
  }

  const verify = (only) =>
    agent(
      `Verify contract \`${built.contractId}\` of the project in the current folder. The product is launched like this: ${built.launch}. ${only ? `Only these claims need a verdict now (the rest stand): ${only.join(', ')}. They were refuted before and the product has been changed since: check them from the start, on the product as it is now.` : 'Give every claim a verdict.'} I am telling you nothing about whether any claim is true. Record each verdict with \`sz-eyes contract claim\`, record what you notice that no claim covers with \`sz-eyes contract notice\`, stop any server you start, and return the verdicts.`,
      { label: `verify:${m.id}${only ? ':again' : ''}`, phase: 'Verify', agentType: 'sz:verifier', schema: VERDICT },
    )
  let verdict = await verify(null)
  for (let round = 1; round <= 2 && verdict && verdict.refuted.length > 0; round++) {
    const wrong = verdict.refuted.map((r) => `- ${r.id}: ${r.fact}`).join('\n')
    await agent(
      `You are fixing a product so that claims shown false on it become true. ${GROUND} ${TOOLS}

Contract \`${built.contractId}\` (read it: \`sz-eyes contract show ${built.contractId}\`). The product is launched like this: ${built.launch}.
Someone who did not build it operated the product and found these claims false:
${wrong}

Find the cause of each in the product and fix it there. Do not edit the contract, the flows or the tests it names, and do not record verdicts. Check that what was already true still is (run the project's checks). Commit the fix. If a claim cannot be made true without changing what was asked, change nothing for it and say why.`,
      { label: `fix:${m.id}:${round}`, phase: 'Build', schema: { type: 'object', properties: { fixed: { type: 'array', items: { type: 'string' } }, notFixed: { type: 'array', items: { type: 'string' } } }, required: ['fixed'] } },
    )
    const again = await verify(verdict.refuted.map((r) => r.id))
    if (!again) break
    // Claims proven the first time stand; the ones looked at again take their new verdict.
    const looked = new Set([...again.proven, ...again.refuted.map((r) => r.id), ...again.unchecked.map((u) => u.id)])
    verdict = {
      proven: [...verdict.proven.filter((id) => !looked.has(id)), ...again.proven],
      refuted: again.refuted,
      unchecked: [...verdict.unchecked.filter((u) => !looked.has(u.id)), ...again.unchecked],
      noticed: [...(verdict.noticed || []), ...(again.noticed || [])],
    }
  }
  if (!verdict) {
    stopped = `milestone "${m.title}" was built and could not be verified (the verifier did not answer)`
    log(stopped)
    done.push({ id: m.id, title: m.title, contractId: built.contractId, proven: [], refuted: [], unchecked: m.claims.map((c) => ({ id: c.id, why: 'the verifier did not answer' })), noticed: [], report: null })
    break
  }

  const closed = await agent(
    `Close milestone "${m.title}" of the project in the current folder. ${TOOLS}
1. \`sz-eyes evidence ${built.contractId}\` writes the evidence page; note its path.
2. ${verdict.refuted.length === 0 ? `\`sz-eyes contract close ${built.contractId}\`.` : 'Leave the contract open: it has claims shown false.'}
3. Add one line to \`.sz/progress.md\` in the owner's language: the date, the milestone, how many claims are proven, refuted and unchecked, anything the verifier noticed that the owner should know, and what comes next.
4. Commit \`.sz/\` (the contract, the evidence, the progress line).
Change no product code.`,
    { label: `close:${m.id}`, phase: 'Close', schema: CLOSED },
  )
  done.push({ id: m.id, title: m.title, contractId: built.contractId, proven: verdict.proven, refuted: verdict.refuted, unchecked: verdict.unchecked, noticed: verdict.noticed || [], report: closed ? closed.report : null })
  log(`${m.title}: ${verdict.proven.length} proven, ${verdict.refuted.length} refuted, ${verdict.unchecked.length} unchecked`)

  // Nothing is built on a milestone that is known to be broken: the owner is told where it stands instead.
  if (verdict.refuted.length > 0) {
    stopped = `milestone "${m.title}" still has ${verdict.refuted.length} claim(s) shown false after two fixes: ${verdict.refuted.map((r) => `${r.id} (${r.fact})`).join('; ')}`
    log(stopped)
    break
  }
}

return {
  summary: plan.summary,
  decided: plan.decided || [],
  spec: '.sz/spec.md',
  milestones: done,
  notBuilt: milestones.slice(done.length).map((m) => m.title),
  stopped,
}
