import { randomBytes } from 'node:crypto';
import type Anthropic from '@anthropic-ai/sdk';
import type { Logger as PinoLogger } from 'pino';
import { ConfidenceCalibration } from '../ax/Calibration.ts';
import type { AcpRequest, AcpResult } from '../bridge/acp.ts';
import { SteeringQueue } from '../ax/Steering.ts';
import { BridgeSessions } from '../bridge/BridgeSessions.ts';
import type { Config } from '../config.ts';
import { Store } from '../db/Store.ts';
import { EventLog } from '../events/EventLog.ts';
import { CliBridgeEngine } from '../harness/engines/CliBridgeEngine.ts';
import { NativeClaudeEngine } from '../harness/engines/NativeClaudeEngine.ts';
import { WorkspaceProvisioner } from '../harness/bootstrap.ts';
import { BuildMeter } from '../harness/BuildMeter.ts';
import { CompilerGate } from '../harness/CompilerGate.ts';
import { EvalRunner } from '../harness/EvalRunner.ts';
import { Harness } from '../harness/Harness.ts';
import { Ledger } from '../harness/Ledger.ts';
import { LessonBook } from '../harness/LessonBook.ts';
import { ReflectionAgent } from '../harness/ReflectionAgent.ts';
import { ReviewResumer } from '../harness/ReviewResumer.ts';
import { SandwichReviewer } from '../harness/SandwichReviewer.ts';
import { SelfHosting } from '../harness/SelfHosting.ts';
import { Toolbox } from '../harness/Toolbox.ts';
import { KirbyEngine } from '../kirby/KirbyEngine.ts';
import type { PdfRenderer } from '../knowledge/exportPdf.ts';
import { KnowledgeService } from '../knowledge/KnowledgeService.ts';
import { McpRegistry, type McpConnect } from '../mcp/McpRegistry.ts';
import { ClaudeClient, type KeyCheck } from '../llm/ClaudeClient.ts';
import { SessionBrain } from '../llm/SessionBrain.ts';
import { LlmGateway, type GatewayUpstreams } from '../llm/LlmGateway.ts';
import { ModelRouter } from '../llm/ModelRouter.ts';
import { ReviewDesk } from '../llm/ReviewDesk.ts';
import { PolicyEngine } from '../policy/PolicyEngine.ts';
import { PLAYWRIGHT_VERSION, QaBrowser } from '../qa/QaBrowser.ts';
import { ImageDesk, sipsConvert, type ImageConvert, type ImageMaker } from '../qa/ImageDesk.ts';
import { MockupRenderer } from '../qa/MockupRenderer.ts';
import { QaVisionBridge } from '../qa/QaVisionBridge.ts';
import { RefKit } from '../qa/RefKit.ts';
import { SmokeTester, type SmokeRunner } from '../qa/SmokeTester.ts';
import { VisualAuditor } from '../qa/VisualAuditor.ts';
import { TaskQueue } from '../queue/TaskQueue.ts';
import { NtfyRelay } from '../relay/NtfyRelay.ts';
import { SlackRelay, type SocketLike } from '../relay/SlackRelay.ts';
import { TelegramApi } from '../relay/telegramApi.ts';
import { TelegramRelay } from '../relay/TelegramRelay.ts';
import { openAiTranscriber } from '../relay/transcribe.ts';
import { OrbStackManager } from '../sandbox/OrbStackManager.ts';
import { PtyManager, type PtyOpen } from '../sandbox/PtyManager.ts';
import { SandboxFileService } from '../sandbox/SandboxFileService.ts';
import { ScratchService } from '../scratch/ScratchService.ts';
import { DaemonServer } from '../server/DaemonServer.ts';
import { createHandlers } from '../server/handlers.ts';
import { CaffeinateManager, type PowerSpawner } from '../util/CaffeinateManager.ts';
import { Secret, errorMessage, systemClock, type Clock } from '../util/core.ts';
import type { CommandRunner } from '../util/run.ts';
import { CredentialIds, KeychainVault } from '../vault/KeychainVault.ts';
import { ExternalApis } from './ExternalApis.ts';
import { ProjectNamer } from './ProjectNamer.ts';
import { QuotaTracker } from './QuotaTracker.ts';
import { Studio } from './Studio.ts';

export const VERSION = '0.1.0';

/** Seams for tests: everything that would otherwise touch Docker, the Keychain, or the network. */
export interface DaemonOverrides {
  clock?: Clock;
  /** Replaces `docker` and the vendor CLIs. */
  run?: CommandRunner;
  /** Replaces `/usr/bin/security`. */
  securityRun?: CommandRunner;
  fetch?: typeof fetch;
  openSocket?: (url: string) => SocketLike;
  anthropic?: Anthropic;
  gatewayUpstreams?: Partial<GatewayUpstreams>;
  /** Replaces what draws pictures for a product (the Codex CLI's image tool) and what resizes them (sips). */
  images?: { maker?: ImageMaker | null; convert?: ImageConvert };
  /** Replaces the browser container for PDF export. */
  renderPdf?: PdfRenderer;
  /** Replaces the MCP client. */
  mcpConnect?: McpConnect;
  /** Replaces the question "does the provider accept this key?" asked before an Anthropic key is stored. */
  checkKey?: KeyCheck;
  /** Replaces the ACP conversation with an agent CLI. */
  acp?: (req: AcpRequest) => Promise<AcpResult>;
  /** Replaces the engine API connection behind interactive terminals. */
  ptyOpen?: PtyOpen;
  /** Replaces the headless-browser smoke load. */
  smoke?: SmokeRunner;
  /** Replaces `/usr/bin/caffeinate`. */
  powerSpawn?: PowerSpawner;
  /** Replaces the platform check behind keeping the Mac awake. */
  platform?: NodeJS.Platform;
}

export interface Daemon {
  config: Config;
  store: Store;
  events: EventLog;
  policy: PolicyEngine;
  vault: KeychainVault;
  sandboxes: OrbStackManager;
  queue: TaskQueue;
  studio: Studio;
  server: DaemonServer;
  gateway: LlmGateway;
  clientToken: Secret;
  relay: TelegramRelay | null;
  slack: SlackRelay | null;
  ntfy: NtfyRelay | null;
  toolbox: Toolbox;
  bridgeSessions: BridgeSessions;
  lessons: LessonBook;
  evals: EvalRunner;
  scratch: ScratchService;
  knowledge: KnowledgeService;
  steering: SteeringQueue;
  provisioner: WorkspaceProvisioner;
  claude: ClaudeClient;
  router: ModelRouter;
  vision: QaVisionBridge;
  resumer: ReviewResumer;
  pty: PtyManager;
  files: SandboxFileService;
  ledger: Ledger;
  refkit: RefKit;
  mockups: MockupRenderer;
  reviewer: SandwichReviewer;
  power: CaffeinateManager;
  quota: QuotaTracker;
  selfHosting: SelfHosting;
  external: ExternalApis;
  start(): Promise<void>;
  stop(): Promise<void>;
}

/**
 * Composition root. Builds the object graph once, in dependency order, with no service locator and no globals:
 * reading this function top to bottom is reading the architecture.
 */
export async function createDaemon(config: Config, log: PinoLogger, overrides: DaemonOverrides = {}): Promise<Daemon> {
  const clock = overrides.clock ?? systemClock;
  const store = new Store(config.dbPath);
  store.ensureStudioProject(clock());
  const events = new EventLog(store, clock);
  const vault = new KeychainVault({ run: overrides.securityRun });
  const policy = new PolicyEngine({ store, events, config, clock });

  const sandboxes = new OrbStackManager({ config, store, clock, run: overrides.run });
  // The studio's own repository as a project: in and out of its sandbox as git objects, merged only by the owner.
  const selfHosting = new SelfHosting({ config, store, events, policy, sandboxes, run: overrides.run, log: log.child({ mod: 'selfhost' }) });
  // Outside APIs a project's own code calls: keys in the Keychain, stand-ins in the workspace, the swap in the gateway.
  const external = new ExternalApis({ config, store, vault, policy, clock });
  const provisioner = new WorkspaceProvisioner(sandboxes, selfHosting, external);
  const bridgeSessions = new BridgeSessions(clock);
  // What each subscription was seen to do: every call through a vendor CLI reports its outcome here.
  const quota = new QuotaTracker({ store, events, clock });
  // With no API key in the vault, the daemon's own model calls go through the owner's Claude subscription.
  const session = new SessionBrain({ config, sessions: bridgeSessions, clock, run: overrides.run, quota });
  const claude = new ClaudeClient({ vault, policy, store, events, clock, sdk: overrides.anthropic, checkKey: overrides.checkKey, session });
  const mcp = new McpRegistry({ store, vault, policy, clock, connect: overrides.mcpConnect });
  mcp.seed();
  const toolbox = new Toolbox({ sandboxes, policy, events, mcp });
  const steering = new SteeringQueue();
  const calibration = new ConfidenceCalibration(store, clock);

  const bridge = { config, sessions: bridgeSessions, store, events, policy, clock, steering, toolbox, run: overrides.run, quota };
  const codex = new CliBridgeEngine({ id: 'codex', ...bridge });
  const antigravity = new CliBridgeEngine({ id: 'antigravity', ...bridge, acp: overrides.acp });
  const cursor = new CliBridgeEngine({ id: 'cursor', ...bridge, acp: overrides.acp });
  const engines = [new NativeClaudeEngine({ claude, toolbox, events, config, steering }), new CliBridgeEngine({ id: 'claude-code', ...bridge }), codex, cursor, antigravity];
  const router = new ModelRouter(config, engines);
  toolbox.useImages(new ImageDesk({ sandboxes, events, claude, maker: overrides.images?.maker === undefined ? codex : overrides.images.maker, convert: overrides.images?.convert ?? sipsConvert(), clock }));

  // One browser container serves both the smoke load and the visual audit.
  const qaBrowser = new QaBrowser({ config, sandboxes });
  // The design reviewer travels the same two ways as the rest of the daemon's thinking: API key, or subscription CLI.
  // One desk carries every question put to a reviewer: the design review's, and a task's two cross-checks.
  const desk = new ReviewDesk({ claude, vendors: { codex, antigravity, cursor } });
  const vision = new QaVisionBridge({ config, claude, desk, log: log.child({ mod: 'vision' }) });
  const auditor = new VisualAuditor({ config, store, events, browser: qaBrowser, vision, clock, log: log.child({ mod: 'audit' }) });
  const evals = new EvalRunner({ config, store, events, sandboxes, auditor, clock });
  const compiler = new CompilerGate({ sandboxes });
  const smoke = overrides.smoke ?? new SmokeTester({ config, sandboxes, browser: qaBrowser });
  const lessons = new LessonBook({ store, events, policy, config, clock });
  const reflection = new ReflectionAgent({ claude, store, events, lessons, evals });
  const refkit = new RefKit({ config, store, events, policy, browser: qaBrowser, clock, log: log.child({ mod: 'refkit' }) });
  const reviewer = new SandwichReviewer({ desk, router, events, log: log.child({ mod: 'review' }) });
  const ledger = new Ledger({ config, store, events, clock, log: log.child({ mod: 'ledger' }) });
  const mockups = new MockupRenderer({ config, store, sandboxes, browser: qaBrowser, auditor, clock, log: log.child({ mod: 'mockups' }) });
  toolbox.useMockups(mockups);
  const harness = new Harness({ config, store, events, policy, sandboxes, provisioner, router, claude, evals, compiler, smoke, lessons, reflection, refkit, reviewer, ledger, build: new BuildMeter({ sandboxes }), mockups, selfHosting, clock, log: log.child({ mod: 'harness' }) });
  const queue = new TaskQueue({ store, events, execute: (task, signal) => harness.run(task, signal), clock, log: log.child({ mod: 'queue' }) });
  // Tasks suspended for want of a design reviewer are queued again when one answers.
  const resumer = new ReviewResumer({ store, vision, queue, log: log.child({ mod: 'resumer' }) });
  const kirby = new KirbyEngine({ config, store, events, sandboxes, claude, clock, log: log.child({ mod: 'kirby' }) });

  const scratch = new ScratchService({ store, events, claude, calibration, clock, log: log.child({ mod: 'scratch' }) });
  // PDFs are printed by the same browser container the visual audit uses: scripts off, network off.
  const renderPdf: PdfRenderer =
    overrides.renderPdf ??
    (async (html) => {
      const { chromium } = await import('playwright-core');
      const endpoint = await sandboxes.ensureQaBrowser(PLAYWRIGHT_VERSION, config.audit.browserImage);
      let lastError: unknown;
      for (let attempt = 0; attempt < 30; attempt++) {
        try {
          const browser = await chromium.connect(endpoint, { timeout: 10_000 });
          try {
            const context = await browser.newContext({ javaScriptEnabled: false, offline: true });
            const page = await context.newPage();
            await page.setContent(html, { waitUntil: 'load' });
            return await page.pdf({ format: 'A4', printBackground: true, preferCSSPageSize: true });
          } finally {
            await browser.close().catch(() => undefined);
          }
        } catch (err) {
          lastError = err;
          await new Promise((resolve) => setTimeout(resolve, 2000));
        }
      }
      throw new Error(`the browser for PDF export did not become ready: ${errorMessage(lastError)}`);
    });
  const knowledge = new KnowledgeService({ config, store, events, claude, renderPdf, onResult: (scratchId, blocks) => scratch.appendResult(scratchId, blocks), clock, log: log.child({ mod: 'knowledge' }) });

  let relay: TelegramRelay | null = null;
  let slack: SlackRelay | null = null;
  let ntfy: NtfyRelay | null = null;
  const relayStates = (): { id: 'telegram' | 'slack' | 'ntfy'; state: 'disabled' | 'connected' | 'degraded' }[] => [
    { id: 'telegram', state: relay ? (relay.state === 'polling' ? 'connected' : 'degraded') : 'disabled' },
    { id: 'slack', state: slack?.state ?? 'disabled' },
    { id: 'ntfy', state: ntfy?.state ?? 'disabled' },
  ];
  const files = new SandboxFileService({ sandboxes });
  const pty = new PtyManager({ sandboxes, log: log.child({ mod: 'pty' }), open: overrides.ptyOpen });
  const namer = new ProjectNamer({ claude, log: log.child({ mod: 'namer' }) });
  // Holds one caffeinate process while the owner wants the Mac awake. A change, from either side, is announced.
  const power: CaffeinateManager = new CaffeinateManager({ log: log.child({ mod: 'power' }), spawn: overrides.powerSpawn, platform: overrides.platform, onChange: (mode) => studio.announcePower(mode) });
  // "Gemini" is reached through Antigravity's CLI, the Google agent this daemon already knows how to confine.
  const advisors = { codex, gemini: antigravity };
  const studio: Studio = new Studio({ config, store, events, policy, sandboxes, provisioner, queue, vault, claude, router, auditor, evals, lessons, kirby, scratch, knowledge, calibration, steering, mcp, files, mockups, pty, namer, ledger, power, quota, selfHosting, external, advisors, relayStates, clock, log: log.child({ mod: 'studio' }), version: VERSION });

  // The token every owner client presents. Created on first boot and kept in the Keychain, where the desktop
  // client on this Mac reads it directly; a second machine is paired by copying it once (`sz token`).
  let clientToken = await vault.get(CredentialIds.clientToken);
  if (!clientToken) {
    clientToken = new Secret(`szc_${randomBytes(32).toString('base64url')}`);
    await vault.set(CredentialIds.clientToken, clientToken);
    store.upsertCredential(CredentialIds.clientToken, clock());
  }

  const server = new DaemonServer({ config, handlers: createHandlers(studio), events, store, toolbox, bridgeSessions, terminals: pty, clientToken, version: VERSION, log });
  const gateway = new LlmGateway({ config, store, events, policy, vault, clock, log: log.child({ mod: 'gateway' }), upstreams: overrides.gatewayUpstreams, external });

  if (config.telegram.enabled) {
    const botToken = await vault.get(CredentialIds.telegramBotToken);
    if (!botToken) log.warn({}, `telegram is enabled but ${CredentialIds.telegramBotToken} is not in the vault; relay not started`);
    else if (config.telegram.allowedUserIds.length === 0) log.warn({}, 'telegram is enabled but telegram.allowedUserIds is empty; relay not started');
    else {
      const transcribe = openAiTranscriber({ apiKey: () => vault.get(CredentialIds.openaiApiKey), model: config.voice.model, fetch: overrides.fetch });
      relay = new TelegramRelay({ api: new TelegramApi({ apiBase: config.telegram.apiBase, token: botToken, fetch: overrides.fetch }), studio, store, events, config, log: log.child({ mod: 'telegram' }), transcribe });
    }
  }

  if (config.slack.enabled) {
    const [appToken, botToken] = await Promise.all([vault.get(CredentialIds.slackAppToken), vault.get(CredentialIds.slackBotToken)]);
    if (!appToken || !botToken) log.warn({}, `slack is enabled but ${CredentialIds.slackAppToken} and ${CredentialIds.slackBotToken} are not both in the vault; relay not started`);
    else if (config.slack.allowedUserIds.length === 0) log.warn({}, 'slack is enabled but slack.allowedUserIds is empty; relay not started');
    else slack = new SlackRelay({ appToken, botToken, allowedUserIds: config.slack.allowedUserIds, studio, store, events, log: log.child({ mod: 'slack' }), fetch: overrides.fetch, openSocket: overrides.openSocket });
  }

  if (config.ntfy.enabled) {
    // The key that signs button commands is the daemon's own; it is made on first use and never shown.
    let signingKey = await vault.get(CredentialIds.ntfySigningKey);
    if (!signingKey) {
      signingKey = new Secret(randomBytes(32).toString('base64url'));
      await vault.set(CredentialIds.ntfySigningKey, signingKey);
      store.upsertCredential(CredentialIds.ntfySigningKey, clock());
    }
    try {
      ntfy = new NtfyRelay({ ...config.ntfy, token: await vault.get(CredentialIds.ntfyToken), signingKey, studio, store, events, log: log.child({ mod: 'ntfy' }), fetch: overrides.fetch });
    } catch (err) {
      log.warn({ err: errorMessage(err) }, 'ntfy is enabled but misconfigured; relay not started');
    }
  }

  return {
    config,
    store,
    events,
    policy,
    vault,
    sandboxes,
    queue,
    studio,
    server,
    gateway,
    clientToken,
    relay,
    slack,
    ntfy,
    toolbox,
    bridgeSessions,
    lessons,
    evals,
    scratch,
    knowledge,
    steering,
    provisioner,
    claude,
    router,
    vision,
    resumer,
    pty,
    files,
    ledger,
    refkit,
    mockups,
    reviewer,
    power,
    quota,
    selfHosting,
    external,
    async start() {
      policy.start();
      await claude.refresh();
      // The pinned first project: the studio's own repository, when the daemon runs from a checkout of it.
      const core = await selfHosting.mount(clock());
      if (core) evals.seed(core);
      await studio.restorePower();
      store.failInterruptedKnowledgeJobs(clock());
      await server.listen();
      await gateway.listen();
      kirby.start();
      queue.start();
      resumer.start();
      // The relay is a convenience channel: if Telegram is unreachable at boot the daemon still comes up.
      await relay?.start().catch((err: unknown) => log.error({ err: errorMessage(err) }, 'telegram relay failed to start'));
      await slack?.start().catch((err: unknown) => log.error({ err: errorMessage(err) }, 'slack relay failed to start'));
      ntfy?.start();
    },
    async stop() {
      await relay?.stop();
      await slack?.stop();
      await ntfy?.stop();
      resumer.stop();
      power.stop();
      await queue.stop();
      await pty.stop();
      await mcp.stop();
      await Promise.race([Promise.all([scratch.idle(), knowledge.idle()]), new Promise((resolve) => setTimeout(resolve, 5000).unref())]);
      await studio.settle();
      await kirby.stop();
      policy.stop();
      await gateway.close();
      await server.close();
      store.close();
    },
  };
}
