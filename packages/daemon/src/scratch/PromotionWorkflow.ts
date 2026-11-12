import type { DocumentKind, KnowledgeJob, Origin, Project, PromotionResult, Task, Template } from '@studio-zero/protocol';
import { ConflictError } from '../app/errors.ts';
import type { Actor } from '../policy/actions.ts';
import type { PolicyEngine } from '../policy/PolicyEngine.ts';
import type { OrbStackManager } from '../sandbox/OrbStackManager.ts';
import type { ScratchService } from './ScratchService.ts';

export const SPEC_FILE = 'docs/spec.md';
export const DECISION_LOG_FILE = 'docs/decision_log.md';

/** What promotion needs from the rest of the daemon. Implemented by `Studio`. */
export interface PromotionHost {
  createProjectAndProvision(actor: Actor, p: { name: string; slug: string; template: Template }): Promise<Project>;
  submitTask(actor: Actor, p: { projectId: string; kind: 'build'; prompt: string }, origin: Origin): Promise<Task>;
  compileDocument(actor: Actor, p: { title: string; kind: DocumentKind; brief: string; scratchId: string }, origin: Origin): Promise<KnowledgeJob>;
}

/**
 * Tier 2: turning a scratchpad into the real thing.
 *
 *   exploring ──(spec complete, a decision on record, no open question)──▶ ready ──promote──▶ promoted
 *
 * Promotion to a build creates the project and its sandbox, writes the spec and the decision log into the
 * workspace as files, commits them, and starts the first build task with both documents in its request. The
 * builder gets everything that was decided, and everything that was rejected and why, without having been in
 * the conversation. Promotion to a document hands the same two texts to the document compiler.
 *
 * The readiness check is the daemon's (see `readiness`), so an agent cannot talk its way into a build.
 */
export class PromotionWorkflow {
  readonly #scratch: ScratchService;
  readonly #policy: PolicyEngine;
  readonly #sandboxes: OrbStackManager;
  readonly #host: PromotionHost;

  constructor(deps: { scratch: ScratchService; policy: PolicyEngine; sandboxes: OrbStackManager; host: PromotionHost }) {
    this.#scratch = deps.scratch;
    this.#policy = deps.policy;
    this.#sandboxes = deps.sandboxes;
    this.#host = deps.host;
  }

  async promote(actor: Actor, scratchId: string, target: 'build' | 'document', opts: { template?: Template; documentKind?: DocumentKind }, origin: Origin): Promise<PromotionResult> {
    const view = this.#scratch.view(scratchId);
    const pad = view.scratchpad;
    if (pad.state === 'promoted' || pad.state === 'archived') throw new ConflictError(`this scratchpad is already ${pad.state}`);
    if (view.thinking) throw new ConflictError('the agent is still working on this scratchpad');
    if (!view.readiness.ready) throw new ConflictError(`not ready to promote. Still needed: ${view.readiness.missing.join(', ')}`);
    await this.#policy.authorize(actor, { kind: 'scratch.promote', scratchId, target });

    if (target === 'document') {
      const job = await this.#host.compileDocument(actor, { title: pad.title, kind: opts.documentKind ?? 'prd', brief: `${view.spec}\n\n${view.decisionLog}`, scratchId }, origin);
      return { scratchpad: this.#scratch.markPromoted(scratchId, null), project: null, task: null, job };
    }

    const project = await this.#host.createProjectAndProvision(actor, { name: pad.title, slug: slugFor(pad.title, pad.id), template: opts.template ?? 'web-vite-react' });
    await this.#sandboxes.writeFile(project, SPEC_FILE, view.spec);
    await this.#sandboxes.writeFile(project, DECISION_LOG_FILE, view.decisionLog);
    await this.#sandboxes.commitAll(project, `docs: spec and decision log from scratchpad ${pad.id}`);
    const task = await this.#host.submitTask(actor, { projectId: project.id, kind: 'build', prompt: buildPrompt(view.spec, view.decisionLog) }, origin);
    return { scratchpad: this.#scratch.markPromoted(scratchId, project.id), project, task, job: null };
  }
}

/** The first task of a promoted project. Both documents are in the request itself and in the repository. */
export function buildPrompt(spec: string, decisionLog: string): string {
  return `Build the product specified below. The same two documents are in the repository as ${SPEC_FILE} and ${DECISION_LOG_FILE}; keep them there.

The decision log records what was decided before any code existed, including the alternatives that were considered and rejected and why. Treat rejected alternatives as closed: do not reintroduce one because it looks convenient. If the spec leaves something undecided that you need, make the choice the spec's goals imply and name it in your final message.

<spec>
${spec.trim()}
</spec>

<decision_log>
${decisionLog.trim()}
</decision_log>`;
}

function slugFor(title: string, id: string): string {
  const ascii = title.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32);
  return /^[a-z][a-z0-9-]{1,30}[a-z0-9]$/.test(ascii) ? ascii : `note-${id.slice(-8)}`;
}
