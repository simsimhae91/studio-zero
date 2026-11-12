import type { z } from 'zod';
import type { MethodName, ResultOf, methods } from '@studio-zero/protocol';
import type { Studio } from '../app/Studio.ts';
import type { Actor } from '../policy/actions.ts';
import { Secret } from '../util/core.ts';

/** Handler signature per method: validated params in, a value matching the result schema out. */
export type Handlers = { [M in MethodName]: (params: z.output<(typeof methods)[M]['params']>) => ResultOf<M> | Promise<ResultOf<M>> };

/** Everything arriving on the authenticated control socket acts as the owner at the desk. */
const OWNER: Actor = { type: 'owner', via: 'desktop' };

/** The RPC surface, mapped one-to-one onto `Studio`. No logic lives here; that is the point. */
export function createHandlers(studio: Studio): Handlers {
  return {
    'system.status': () => studio.status(),

    'projects.create': (p) => studio.createProject(OWNER, p),
    'projects.list': () => ({ projects: studio.listProjects() }),
    'projects.delete': async (p) => {
      await studio.deleteProject(OWNER, p.projectId, p.deleteWorkspace);
      return { deleted: true as const };
    },

    'sandbox.info': (p) => studio.sandboxInfo(p.projectId),
    'sandbox.start': (p) => studio.sandboxLifecycle(OWNER, p.projectId, 'start'),
    'sandbox.stop': (p) => studio.sandboxLifecycle(OWNER, p.projectId, 'stop'),
    'sandbox.recreate': (p) => studio.sandboxLifecycle(OWNER, p.projectId, 'recreate'),

    'preview.start': (p) => studio.startPreview(OWNER, p.projectId),
    'preview.stop': async (p) => {
      await studio.stopPreview(OWNER, p.projectId);
      return { stopped: true as const };
    },

    'tasks.submit': (p) => studio.submitTask(OWNER, p, 'desktop'),
    'tasks.steer': async (p) => {
      await studio.steerTask(OWNER, p.taskId, p.message);
      return { queued: true as const };
    },
    'tasks.get': (p) => studio.getTask(p.taskId),
    'tasks.list': (p) => ({ tasks: studio.listTasks(p.projectId, p.limit ?? 50) }),
    'tasks.cancel': (p) => studio.cancelTask(p.taskId),

    'approvals.list': (p) => ({ approvals: studio.listApprovals(p.state) }),
    'approvals.resolve': (p) => studio.resolveApproval(p.approvalId, p.decision, 'desktop'),

    'checkpoints.list': (p) => ({ checkpoints: studio.listCheckpoints(p.projectId) }),
    'checkpoints.rollback': (p) => studio.rollback(OWNER, p.projectId, p.checkpointId),
    'checkpoints.fork': async (p) => ({ branch: await studio.forkCheckpoint(OWNER, p.projectId, p.checkpointId) }),
    'git.merge': (p) => studio.merge(OWNER, p.projectId, p.branch),

    'audits.run': (p) => studio.runAudit(OWNER, p.projectId, p.routes),
    'audits.get': (p) => studio.getAudit(p.auditId),
    'audits.list': (p) => ({ audits: studio.listAudits(p.projectId, p.limit ?? 20) }),

    'lessons.list': (p) => ({ lessons: studio.listLessons(p.projectId, p.state) }),
    'lessons.setState': (p) => studio.setLessonState(OWNER, p.lessonId, p.state),
    'evals.list': (p) => ({ evals: studio.listEvals(p.projectId) }),
    'evals.setEnabled': (p) => studio.setEvalEnabled(OWNER, p.evalId, p.enabled),

    'kirby.ingest': (p) => studio.kirbyIngest(OWNER, p.projectId, p.repoUrl, p.maxProposals ?? 3),
    'kirby.proposals': (p) => ({ proposals: studio.kirbyProposals(p.projectId) }),
    'kirby.materialize': (p) => studio.kirbyMaterialize(OWNER, p.proposalId, 'desktop'),
    'kirby.reject': (p) => studio.kirbyReject(p.proposalId),

    'scratch.create': (p) => studio.createScratchpad(OWNER, p, 'desktop'),
    'scratch.list': () => ({ scratchpads: studio.listScratchpads() }),
    'scratch.get': (p) => studio.scratchView(p.scratchId),
    'scratch.say': (p) => {
      studio.scratchSay(p.scratchId, p.text);
      return { accepted: true as const };
    },
    'scratch.respond': (p) => {
      studio.scratchRespond(p.scratchId, p.response);
      return { accepted: true as const };
    },
    'scratch.move': (p) => {
      studio.scratchMove(p.scratchId, p.move);
      return { accepted: true as const };
    },
    'scratch.promote': (p) => studio.promoteScratchpad(OWNER, p, 'desktop'),
    'scratch.archive': (p) => studio.archiveScratchpad(p.scratchId),

    'research.start': (p) => studio.startResearch(OWNER, p, 'desktop'),
    'documents.compile': (p) => studio.compileDocument(OWNER, p, 'desktop'),
    'knowledge.list': () => ({ jobs: studio.listKnowledge() }),
    'knowledge.get': (p) => studio.getKnowledge(p.jobId),
    'documents.export': async (p) => ({ artifactId: await studio.exportDocument(p.jobId) }),
    'ax.calibration': () => studio.calibration(),

    'mcp.list': () => ({ servers: studio.mcpList() }),
    'mcp.add': (p) => studio.mcpAdd(OWNER, p),
    'mcp.remove': async (p) => {
      await studio.mcpRemove(OWNER, p.serverId);
      return { removed: true as const };
    },
    'mcp.revoke': async (p) => ({ revoked: await studio.mcpRevoke(OWNER, p.serverId, p.projectId) }),

    'vault.list': () => ({ credentials: studio.vaultList() }),
    'vault.set': (p) => studio.vaultSet(OWNER, p.id, new Secret(p.secret)),
    'vault.delete': async (p) => ({ deleted: await studio.vaultDelete(OWNER, p.id) }),

    'events.history': (p) => ({ events: studio.history({ projectId: p.projectId, taskId: p.taskId }, p.sinceSeq ?? 0, p.limit ?? 200) }),
  };
}
