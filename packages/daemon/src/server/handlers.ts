import type { z } from 'zod';
import type { MethodName, ResultOf, methods } from '@studio-zero/protocol';
import { ConflictError, LocalOnlyError } from '../app/errors.ts';
import type { OwnerConfig } from '../app/OwnerConfig.ts';
import type { Studio } from '../app/Studio.ts';
import type { Actor } from '../policy/actions.ts';
import type { TerminalSink } from '../sandbox/PtyManager.ts';
import { Secret } from '../util/core.ts';

/** The connection a request arrived on. Only what is bound to a connection needs it: today, terminals. */
export interface ClientConnection {
  /** Unique per socket. Terminals are owned by it and die with it. */
  id: string;
  terminals: TerminalSink;
  /**
   * Whether the connection was opened on the daemon's own Mac, and not through whatever carries the listener
   * to another machine. Decided by the server when the socket opens (see `DaemonServer`); never by the client.
   */
  local: boolean;
}

/** What the handlers need beside the studio: the owner's settings, and how this process is brought down to be started again. */
export interface HandlerDeps {
  ownerConfig: OwnerConfig;
  /** Stops the process so that its supervisor restarts it. Null when nothing supervises it: then it would only stop. */
  restart: (() => void) | null;
  logFile: string | null;
}

/** Handler signature per method: validated params in, a value matching the result schema out. */
export type Handlers = { [M in MethodName]: (params: z.output<(typeof methods)[M]['params']>, conn: ClientConnection) => ResultOf<M> | Promise<ResultOf<M>> };

/** Everything arriving on the authenticated control socket acts as the owner at the desk. */
const OWNER: Actor = { type: 'owner', via: 'desktop' };

/** The RPC surface, mapped one-to-one onto `Studio`. No logic lives here; that is the point. */
export function createHandlers(studio: Studio, deps: HandlerDeps): Handlers {
  return {
    'system.status': () => studio.status(),
    'config.get': (_p, conn) => ({ settings: deps.ownerConfig.get(), writable: conn.local, restartRequired: deps.ownerConfig.restartRequired, supervised: deps.restart !== null, file: deps.ownerConfig.file, logFile: deps.logFile }),
    // These sections say who the owner is on other channels and what may be spent. Holding the token is enough
    // to run the studio; changing this takes being at the Mac, as editing the file always did.
    'config.set': (p, conn) => {
      if (!conn.local) throw new LocalOnlyError('설정 변경');
      const settings = deps.ownerConfig.set(p.settings);
      return { settings, restartRequired: deps.ownerConfig.restartRequired };
    },
    'system.restart': (_p, conn) => {
      if (!conn.local) throw new LocalOnlyError('데몬 다시 시작');
      if (deps.restart === null) throw new ConflictError('이 데몬은 다시 켜 줄 관리자(LaunchAgent) 없이 돌고 있어서 스스로 다시 시작할 수 없습니다. 데몬을 띄운 터미널에서 다시 시작해 주세요.');
      const busy = studio.inFlight();
      if (busy !== null) throw new ConflictError(`지금 다시 시작하면 끊기는 일이 있습니다: ${busy}. 끝나거나 멈춘 뒤에 다시 시작해 주세요.`);
      // After the answer has gone out: the socket this was asked on is about to close.
      setTimeout(deps.restart, 250).unref();
      return { accepted: true as const };
    },
    'engines.models': (p) => studio.engineCatalog(p.engine),

    'projects.create': (p) => studio.createProject(OWNER, p),
    'projects.list': () => studio.projectsOverview(),
    'projects.rename': (p) => studio.renameProject(OWNER, p.projectId, p.name),
    'projects.ignite': (p) => studio.igniteProject(OWNER, p, 'desktop'),
    'projects.delete': async (p) => {
      await studio.deleteProject(OWNER, p.projectId, p.deleteWorkspace);
      return { deleted: true as const };
    },

    'sessions.list': (p) => ({ sessions: studio.listSessions(p.projectId) }),
    'sessions.create': (p) => studio.createSession(p.projectId, p.name),
    'sessions.rename': (p) => studio.renameSession(p.sessionId, p.name),
    'sessions.delete': (p) => {
      studio.deleteSession(p.sessionId);
      return { deleted: true as const };
    },

    'files.list': (p) => studio.listFiles(p.projectId, p.path, p.depth),
    'files.read': (p) => studio.readFile(p.projectId, p.path),
    'mockups.page': async (p) => ({ html: await studio.mockupPage(p.projectId, p.file) }),
    'files.write': async (p) => {
      await studio.writeFile(OWNER, p.projectId, p.path, p.content);
      return { written: true };
    },

    'terminal.spawn': async (p, conn) => ({ terminalId: await studio.spawnTerminal(OWNER, p.projectId, { cols: p.cols, rows: p.rows }, conn.id, conn.terminals) }),
    'terminal.resize': async (p, conn) => {
      await studio.resizeTerminal(conn.id, p.terminalId, p.cols, p.rows);
      return { resized: true as const };
    },
    'terminal.kill': async (p, conn) => ({ killed: await studio.killTerminal(conn.id, p.terminalId) }),

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
    'tasks.resume': (p) => studio.resumeTask(p.taskId),

    'schedules.list': (p) => ({ schedules: studio.listSchedules(p.projectId) }),
    'schedules.create': (p) => studio.createSchedule(OWNER, p),
    'schedules.setEnabled': (p) => studio.setScheduleEnabled(OWNER, p.scheduleId, p.enabled),
    'schedules.delete': async (p) => {
      await studio.deleteSchedule(OWNER, p.scheduleId);
      return { deleted: true as const };
    },

    'plans.list': (p) => studio.listPlanVersions(p.taskId),
    'plans.resolve': (p) => studio.resolvePlanReview(OWNER, p),

    'approvals.list': (p) => ({ approvals: studio.listApprovals(p.state) }),
    'approvals.resolve': (p) => studio.resolveApproval(p.approvalId, p.decision, 'desktop'),

    'checkpoints.list': (p) => ({ checkpoints: studio.listCheckpoints(p.projectId) }),
    'checkpoints.rollback': (p) => studio.rollback(OWNER, p.projectId, p.checkpointId),
    'checkpoints.fork': async (p) => ({ branch: await studio.forkCheckpoint(OWNER, p.projectId, p.checkpointId) }),
    'git.merge': (p) => studio.merge(OWNER, p.projectId, p.branch),

    'audits.run': (p) => studio.runAudit(OWNER, p.projectId, p.routes),
    'audits.get': (p) => studio.getAudit(p.auditId),
    'audits.list': (p) => ({ audits: studio.listAudits(p.projectId, p.limit ?? 20) }),
    'audits.redesign': (p) => studio.redesignFromAudit(OWNER, p.auditId, 'desktop'),

    'ledger.list': (p) => ({ entries: studio.listLedger(p.projectId, p.limit ?? 50) }),

    'power.get': () => studio.powerState(),
    'power.set': (p) => studio.setPower(OWNER, p.mode),
    'quota.get': () => studio.quota(),
    'selfhost.status': () => studio.selfHostStatus(),
    'selfhost.merge': (p) => studio.selfHostMerge(OWNER, p.taskId),

    'lessons.list': (p) => ({ lessons: studio.listLessons(p.projectId, p.state) }),
    'lessons.setState': (p) => studio.setLessonState(OWNER, p.lessonId, p.state),
    'evals.list': (p) => ({ evals: studio.listEvals(p.projectId) }),
    'evals.setEnabled': (p) => studio.setEvalEnabled(OWNER, p.evalId, p.enabled),

    'kirby.ingest': (p) => studio.kirbyIngest(OWNER, p.projectId, p.repoUrl, p.maxProposals ?? 3),
    'kirby.proposals': (p) => ({ proposals: studio.kirbyProposals(p.projectId) }),
    'kirby.materialize': (p) => studio.kirbyMaterialize(OWNER, p.proposalId, 'desktop'),
    'kirby.reject': (p) => studio.kirbyReject(p.proposalId),

    'scratch.create': (p) => studio.createScratchpad(OWNER, p, 'desktop'),
    'scratch.list': (p) => ({ scratchpads: studio.listScratchpads(p.archived ?? false) }),
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
    'scratch.restore': (p) => studio.restoreScratchpad(p.scratchId),
    'scratch.rename': (p) => studio.renameScratchpad(p.scratchId, p.title),
    'scratch.delete': (p) => (studio.deleteScratchpad(p.scratchId), { deleted: true as const }),
    'scratch.stop': (p) => ({ stopped: studio.stopScratchpad(p.scratchId) }),

    'research.start': (p) => studio.startResearch(OWNER, p, 'desktop'),
    'documents.compile': (p) => studio.compileDocument(OWNER, p, 'desktop'),
    'knowledge.list': () => ({ jobs: studio.listKnowledge() }),
    'knowledge.cancel': (p) => (studio.cancelKnowledge(p.jobId), { accepted: true as const }),
    'knowledge.retry': (p) => studio.retryKnowledge(OWNER, p.jobId),
    'knowledge.get': (p) => studio.getKnowledge(p.jobId),
    'documents.export': async (p) => ({ artifactId: await studio.exportDocument(p.jobId) }),
    'ax.calibration': () => studio.calibration(),
    'advisor.ask': (p) => studio.askAdvisor(OWNER, p),

    'mcp.list': () => ({ servers: studio.mcpList() }),
    'mcp.add': (p) => studio.mcpAdd(OWNER, p),
    'mcp.remove': async (p) => {
      await studio.mcpRemove(OWNER, p.serverId);
      return { removed: true as const };
    },
    'mcp.revoke': async (p) => ({ revoked: await studio.mcpRevoke(OWNER, p.serverId, p.projectId) }),

    'external.list': (p) => ({ apis: studio.listExternalApis(p.projectId) }),
    'external.set': (p) => studio.setExternalApi(OWNER, { projectId: p.projectId, name: p.name, origin: p.origin, variables: p.variables.map((v) => ({ name: v.name, secret: new Secret(v.secret) })) }),
    'external.remove': async (p) => {
      await studio.removeExternalApi(OWNER, p.projectId, p.name);
      return { removed: true as const };
    },

    'vault.list': () => ({ credentials: studio.vaultList() }),
    'vault.set': (p) => studio.vaultSet(OWNER, p.id, new Secret(p.secret)),
    'vault.delete': async (p) => ({ deleted: await studio.vaultDelete(OWNER, p.id) }),

    'events.history': (p) => ({ events: studio.history({ projectId: p.projectId, taskId: p.taskId }, p.sinceSeq ?? 0, p.limit ?? 200) }),
  };
}
