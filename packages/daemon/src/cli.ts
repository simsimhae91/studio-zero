#!/usr/bin/env node
import { DEFAULT_DAEMON_PORT, RpcCallError, RpcClient, Template, type EventEnvelope, type Project, type TaskKind } from '@studio-zero/protocol';
import { CredentialIds, KeychainVault } from './vault/KeychainVault.ts';

const USAGE = `sz — Studio Zero command line

  sz status
  sz project list
  sz project create <slug> <name> [${Template.options.join('|')}]
  sz project rm <slug> [--delete-workspace]
  sz task <project-slug> <build|refactor|inline_edit|ideate> [--draft] [--plan] [--from <branch>] <prompt...>
                                                                             submit and follow a task (--draft: the fast track; --plan: stop after planning until the plan
                                                                             is approved; --from: start from that branch, e.g. a failed task's)
  sz cancel <task-id>                                                        stop a task that is queued, running or waiting; its work stays on its branch
  sz plan <task-id>                                                          the plan a task is waiting with, and the other model's notes on it
  sz plan approve <task-id> | sz plan change <task-id> <what to change...>   approve it (the build starts), or send it back to be drafted again
  sz schedule add <project-slug> <build|refactor|inline_edit|ideate> <prompt...> [--every <n>h|<n>m] [--at 2026-11-15T07:00]
                                                                             submit the prompt as a task every n hours or minutes (at least 1h), once at that local time,
                                                                             or with both from that time on: --every 24h --at 2026-11-15T07:00 is every day at seven
  sz schedule list [project-slug] | sz schedule pause|resume|rm <schedule-id>
  sz events [project-slug]                                                   follow the event stream
  sz approvals                                                               list pending approvals
  sz approve <approval-id> | sz deny <approval-id>
  sz merge <project-slug> <branch>                                           on studio-zero-core: a task's exported feature/ branch, into this checkout (fast-forward only)
  sz kirby <project-slug> <https://github.com/owner/repo>                     read a repository for what it does and propose what this project lacks
  sz kirby list <project-slug>                                               the proposals, newest first
  sz kirby build <proposal-id> [--plan] | sz kirby reject <proposal-id>      build a proposal on its own branch, or put it aside (--plan, on studio-zero-core: wait for the plan to be approved first)
  sz vault list | sz vault set <credential-id> | sz vault rm <credential-id>   (set reads the secret from stdin)
                                                                             Kakao and Google sign-in: login/{kakao,google}/client-{id,secret} (how to get them: docs/guides/studio-zero/shared-login-apps.html)
  sz token                                                                   print the client token, to pair another machine

Environment: SZ_URL (default ws://127.0.0.1:${DEFAULT_DAEMON_PORT}/v1/ws), SZ_TOKEN (default: read from the Keychain)`;

async function connect(): Promise<RpcClient> {
  const token = process.env.SZ_TOKEN ?? (await new KeychainVault().get(CredentialIds.clientToken))?.expose();
  if (!token) throw new Error('no client token: start the daemon once on this Mac, or set SZ_TOKEN to pair with a remote daemon');
  const url = process.env.SZ_URL ?? `ws://127.0.0.1:${DEFAULT_DAEMON_PORT}/v1/ws`;
  const client = new RpcClient({ url, token, client: 'sz-cli' });
  try {
    await client.connect();
  } catch (err) {
    // A refused connection reaches us as a bare close code. Say what it almost always means and what to do.
    if (err instanceof RpcCallError && err.code === 'disconnected') {
      const local = process.env.SZ_URL === undefined;
      throw new Error(`cannot reach the daemon at ${url}. ${local ? 'It is not running: start it in another terminal with `pnpm daemon` (or `pnpm build && pnpm start`), leave it running, then run this command again.' : 'Check that the daemon is running on that machine and that the address is right.'}`);
    }
    throw err;
  }
  return client;
}

async function projectBySlug(client: RpcClient, slug: string | undefined): Promise<Project> {
  const { projects } = await client.call('projects.list', {});
  const project = projects.find((p) => p.slug === slug);
  if (!project) throw new Error(`no project "${slug ?? ''}". Known: ${projects.map((p) => p.slug).join(', ') || '(none)'}`);
  return project;
}

function printEvent(e: EventEnvelope): void {
  const b = e.body;
  const time = new Date(e.at).toISOString().slice(11, 19);
  const text = ((): string => {
    switch (b.type) {
      case 'task.state':
        return `task ${b.state}${b.error ? `: ${b.error}` : ''}`;
      case 'task.phase':
        return `phase ${b.phase}${b.round ? ` (round ${b.round})` : ''}`;
      case 'route.decided':
        return `engine ${b.engine} / ${b.model} (${b.effort})`;
      case 'plan.created':
        return `plan: ${b.summary}`;
      case 'plan.review_requested':
        return `PLAN ${b.version} WAITS for you: sz plan ${e.taskId ?? '<task-id>'}`;
      case 'plan.review_resolved':
        return b.outcome === 'timeout' ? `plan ${b.version}: nobody answered in time` : `plan ${b.version}: ${b.outcome === 'approve' ? 'approved' : 'sent back for changes'}`;
      case 'tool.call':
        return `$ ${b.tool} ${b.input.split('\n')[0]!.slice(0, 140)}`;
      case 'tool.result':
        return `  ${b.ok ? 'ok' : 'FAILED'}${b.exitCode === null ? '' : ` exit ${b.exitCode}`} (${b.durationMs}ms)`;
      case 'agent.text':
        return b.text;
      case 'eval.result':
        return `eval ${b.name}: ${b.passed ? 'passed' : 'FAILED'}`;
      case 'audit.completed':
        // An audit no reviewer saw has not failed: it was measured, and its score is capped for that reason alone.
        return `visual audit ${b.visionReviewed === false ? 'measured only, no design review' : `${b.score}/100 ${b.passed ? 'passed' : 'FAILED'}`} (blockers ${b.blockers}, majors ${b.majors}, minors ${b.minors})`;
      case 'approval.requested':
        return `APPROVAL NEEDED ${b.approvalId}: ${b.summary}`;
      case 'approval.resolved':
        return `approval ${b.approvalId} ${b.state}`;
      case 'policy.decision':
        return `policy ${b.effect} ${b.actionKind}: ${b.reason}`;
      case 'usage':
        return `usage ${b.model}: ${b.inputTokens} in / ${b.outputTokens} out`;
      case 'notice':
        return `${b.level}: ${b.message}`;
      default:
        return JSON.stringify(b);
    }
  })();
  process.stdout.write(`${time} ${text}\n`);
}

/** `24h` or `90m`, in minutes. Nothing finer than a minute and no calendar: a schedule is an interval or a time. */
function everyMinutes(text: string): number {
  const m = /^(\d+)(h|m)$/.exec(text.trim());
  if (!m) throw new Error(`--every takes hours or minutes, like 24h or 90m (got "${text}")`);
  return Number(m[1]) * (m[2] === 'h' ? 60 : 1);
}

/** `2026-11-15T07:00`, read on this machine's clock. A zone or an offset is not taken: the time is local. */
function localTime(text: string): number {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(text)) throw new Error(`--at takes a local time like 2026-11-15T07:00 (got "${text}")`);
  const at = new Date(text).getTime();
  if (Number.isNaN(at)) throw new Error(`--at: "${text}" is not a time`);
  return at;
}

async function readSecret(): Promise<string> {
  const stdin = process.stdin;
  if (!stdin.isTTY) {
    let data = '';
    for await (const chunk of stdin) data += chunk;
    return data.replace(/\r?\n$/, '');
  }
  process.stderr.write('secret (input hidden): ');
  stdin.setRawMode(true);
  stdin.resume();
  let value = '';
  return new Promise((resolve, reject) => {
    stdin.on('data', (chunk: Buffer) => {
      for (const ch of chunk.toString('utf8')) {
        if (ch === '\r' || ch === '\n') {
          stdin.setRawMode(false);
          stdin.pause();
          process.stderr.write('\n');
          return resolve(value);
        }
        if (ch === '\u0003') {
          stdin.setRawMode(false);
          return reject(new Error('cancelled'));
        }
        if (ch === '\u007f') value = value.slice(0, -1);
        else value += ch;
      }
    });
  });
}

async function main(argv: string[]): Promise<number> {
  const [command, ...args] = argv;
  if (!command || command === 'help' || command === '--help') {
    process.stdout.write(`${USAGE}\n`);
    return 0;
  }
  if (command === 'token') {
    const token = await new KeychainVault().get(CredentialIds.clientToken);
    if (!token) throw new Error('no client token yet: start the daemon once');
    process.stdout.write(`${token.expose()}\n`);
    return 0;
  }

  const client = await connect();
  try {
    switch (command) {
      case 'status': {
        const s = await client.call('system.status', {});
        process.stdout.write(
          [
            `Studio Zero ${s.version} (protocol ${s.protocol}), up ${s.uptimeSec}s`,
            `runtime   ${s.runtime.context}: ${s.runtime.reachable ? `ok (${s.runtime.detail})` : `unreachable (${s.runtime.detail})`}`,
            `relays    ${s.relays.map((r) => `${r.id} ${r.state}`).join(', ')}`,
            `queue     ${s.queue.running} running, ${s.queue.queued} queued`,
            `brain     ${s.brain === 'api' ? 'Anthropic API key' : s.brain === 'session' ? 'Claude subscription (Claude Code, tools off)' : 'none: sign in to Claude Code or store an API key'}`,
            ...s.engines.map((e) => `engine    ${e.id}: ${e.available ? 'available' : 'unavailable'} (${e.reason})`),
          ].join('\n') + '\n',
        );
        return 0;
      }
      case 'project': {
        if (args[0] === 'create') {
          const [, slug = '', name = slug, template = 'web-vite-react'] = args;
          const project = await client.call('projects.create', { slug, name, template: Template.parse(template) });
          process.stdout.write(`created ${project.slug} (${project.id})\n`);
        } else if (args[0] === 'rm') {
          const project = await projectBySlug(client, args[1]);
          await client.call('projects.delete', { projectId: project.id, deleteWorkspace: args.includes('--delete-workspace') });
          process.stdout.write(`deleted ${project.slug}\n`);
        } else {
          for (const p of (await client.call('projects.list', {})).projects) process.stdout.write(`${p.slug.padEnd(24)} ${p.template.padEnd(16)} ${p.name}\n`);
        }
        return 0;
      }
      case 'task': {
        const project = await projectBySlug(client, args[0]);
        // --draft: the fast track (Draft 0), as the desktop client's composer offers it.
        const draft = args.includes('--draft');
        // --plan: the task stops after planning, and goes on when the plan is approved (sz plan approve).
        const reviewPlan = args.includes('--plan');
        // --from <branch>: the work starts from that branch and not from the default one. For going on from a task that failed.
        const fromAt = args.indexOf('--from');
        const from = fromAt >= 2 ? args[fromAt + 1] : undefined;
        const words = args.slice(2).filter((word, i) => word !== '--draft' && word !== '--plan' && i + 2 !== fromAt && i + 2 !== fromAt + 1);
        const task = await client.call('tasks.submit', { projectId: project.id, kind: args[1] as Exclude<TaskKind, 'kirby_materialize'>, prompt: words.join(' '), ...(draft ? { track: 'fast' as const } : {}), ...(from ? { baseBranch: from } : {}), ...(reviewPlan ? { reviewPlan: true } : {}) });
        if (reviewPlan && !task.reviewPlan) process.stdout.write('--plan was not taken: only a build or a refactor on the full track drafts a plan to show\n');
        process.stdout.write(`task ${task.id}\n`);
        return await new Promise<number>((resolve) => {
          client.subscribe({ taskId: task.id }, (e) => {
            printEvent(e);
            if (e.body.type === 'task.state' && ['succeeded', 'failed', 'cancelled'].includes(e.body.state)) resolve(e.body.state === 'succeeded' ? 0 : 1);
          }, 0);
        });
      }
      case 'schedule': {
        if (args[0] === 'add') {
          const project = await projectBySlug(client, args[1]);
          const flag = (name: string): string | undefined => {
            const at = args.indexOf(name);
            return at >= 0 ? args[at + 1] : undefined;
          };
          const every = flag('--every');
          const at = flag('--at');
          const flagged = new Set(['--every', '--at'].flatMap((name) => (args.includes(name) ? [args.indexOf(name), args.indexOf(name) + 1] : [])));
          const prompt = args.slice(3).filter((_word, i) => !flagged.has(i + 3)).join(' ');
          const schedule = await client.call('schedules.create', { projectId: project.id, kind: args[2] as Exclude<TaskKind, 'kirby_materialize'>, prompt, ...(every !== undefined ? { everyMinutes: everyMinutes(every) } : {}), ...(at !== undefined ? { at: localTime(at) } : {}) });
          process.stdout.write(`schedule ${schedule.id}: first run ${new Date(schedule.nextDueAt!).toLocaleString()}
`);
          return 0;
        }
        if (args[0] === 'pause' || args[0] === 'resume') {
          const schedule = await client.call('schedules.setEnabled', { scheduleId: args[1] ?? '', enabled: args[0] === 'resume' });
          process.stdout.write(`${schedule.id} ${schedule.enabled ? `on, next run ${new Date(schedule.nextDueAt!).toLocaleString()}` : 'paused'}
`);
          return 0;
        }
        if (args[0] === 'rm') {
          await client.call('schedules.delete', { scheduleId: args[1] ?? '' });
          process.stdout.write('deleted\n');
          return 0;
        }
        if (args[0] === 'list' || args[0] === undefined) {
          const { projects } = await client.call('projects.list', {});
          const projectId = args[1] ? (await projectBySlug(client, args[1])).id : undefined;
          const { schedules } = await client.call('schedules.list', projectId ? { projectId } : {});
          for (const sc of schedules) {
            const slug = projects.find((p) => p.id === sc.projectId)?.slug ?? sc.projectId;
            const when = sc.mode === 'every' ? `every ${sc.intervalMinutes! % 60 === 0 ? `${sc.intervalMinutes! / 60}h` : `${sc.intervalMinutes}m`}` : 'once';
            const next = sc.nextDueAt === null ? '-' : new Date(sc.nextDueAt).toLocaleString();
            process.stdout.write(`${sc.id}  ${slug.padEnd(20)} ${sc.kind.padEnd(11)} ${when.padEnd(10)} next ${next.padEnd(24)} ${sc.enabled ? 'on    ' : 'paused'} last ${sc.lastTaskId ?? '-'}\n`);
          }
          if (schedules.length === 0) process.stdout.write('no schedules\n');
          return 0;
        }
        throw new Error(`unknown schedule command: ${args[0]}`);
      }
      case 'events': {
        const filter = args[0] ? { projectId: (await projectBySlug(client, args[0])).id } : {};
        client.subscribe(filter, printEvent);
        return await new Promise<number>(() => undefined);
      }
      case 'cancel': {
        const task = await client.call('tasks.cancel', { taskId: args[0] ?? '' });
        process.stdout.write(`task ${task.id} is ${task.state === 'cancelled' ? 'cancelled' : `${task.state}; it stops at its next step`}\n`);
        return 0;
      }
      case 'plan': {
        // The version a verdict is given on is the one read here: the daemon refuses it if the plan has moved on since.
        const verb = args[0] === 'approve' || args[0] === 'change' ? args[0] : null;
        const taskId = (verb ? args[1] : args[0]) ?? '';
        const { versions, revisionsLeft } = await client.call('plans.list', { taskId });
        const latest = versions.at(-1);
        if (!latest) throw new Error(`task ${taskId} has no plan to show (it was not submitted with --plan, or it has not planned yet)`);
        if (verb === null) {
          const state = latest.verdict === null ? `waiting for you; it can be sent back ${revisionsLeft} more time(s)` : latest.verdict === 'approve' ? 'approved' : 'sent back for changes';
          process.stdout.write(`plan ${latest.version} of task ${taskId} (${state})\n\n${latest.planMarkdown}${latest.reviewerNotes ? `\n--- the other model's notes\n${latest.reviewerNotes}\n` : ''}`);
          return 0;
        }
        const note = args.slice(2).join(' ').trim();
        if (verb === 'change' && note === '') throw new Error('say what to change: sz plan change <task-id> <what to change...>');
        const resolved = await client.call('plans.resolve', { taskId, version: latest.version, planHash: latest.sha256, verdict: verb === 'approve' ? 'approve' : 'changes', ...(verb === 'change' ? { feedback: [{ comment: note }] } : {}) });
        process.stdout.write(verb === 'approve' ? `plan ${resolved.version} approved: the build starts\n` : `plan ${resolved.version} sent back: a new one will wait for you (sz plan ${taskId})\n`);
        return 0;
      }
      case 'approvals': {
        for (const a of (await client.call('approvals.list', { state: 'pending' })).approvals) process.stdout.write(`${a.id}  ${a.summary}  (expires ${new Date(a.expiresAt).toLocaleTimeString()})\n`);
        return 0;
      }
      case 'approve':
      case 'deny': {
        const approval = await client.call('approvals.resolve', { approvalId: args[0] ?? '', decision: command });
        process.stdout.write(`${approval.id} ${approval.state}\n`);
        return 0;
      }
      case 'merge': {
        const project = await projectBySlug(client, args[0]);
        if (project.template === 'studio-core') {
          // The studio's own repository: what is merged is the branch a task's work was copied out as, into this
          // Mac's checkout. The daemon refuses anything but a fast-forward onto a clean checkout of the base branch.
          const { pending } = await client.call('selfhost.status', {});
          const exported = pending.find((p) => p.branch === args[1]);
          if (!exported) throw new Error(`no branch "${args[1] ?? ''}" is waiting to be merged. Waiting: ${pending.map((p) => p.branch).join(', ') || '(none)'}`);
          const moved = await client.call('selfhost.merge', { taskId: exported.taskId });
          process.stdout.write(`merged ${moved.branch} into ${moved.into} at ${moved.commit.slice(0, 12)}. The running daemon is unchanged until \`pnpm build && pnpm daemon:restart\`.\n`);
          return 0;
        }
        const merged = await client.call('git.merge', { projectId: project.id, branch: args[1] ?? '' });
        process.stdout.write(`merged into ${merged.into} at ${merged.commit.slice(0, 12)}\n`);
        return 0;
      }
      case 'kirby': {
        if (args[0] === 'list') {
          const project = await projectBySlug(client, args[1]);
          const { proposals } = await client.call('kirby.proposals', { projectId: project.id });
          for (const card of [...proposals].sort((x, y) => y.createdAt - x.createdAt)) process.stdout.write(`${card.id}  ${card.state.padEnd(13)} risk ${card.risk.padEnd(6)} ${card.title}\n${' '.repeat(26)}from ${card.sourceRepo.replace('https://', '')} (${card.practiceId})\n`);
          if (proposals.length === 0) process.stdout.write('no proposals yet\n');
          return 0;
        }
        if (args[0] === 'build') {
          const reviewPlan = args.includes('--plan');
          const task = await client.call('kirby.materialize', { proposalId: args.slice(1).find((word) => word !== '--plan') ?? '', ...(reviewPlan ? { reviewPlan: true } : {}) });
          process.stdout.write(`building on ${task.branch} as task ${task.id}${task.reviewPlan ? `: it stops for its plan to be approved (sz plan ${task.id})` : reviewPlan ? ' (--plan was not taken: this build is a draft and drafts no plan)' : ''}\n`);
          return 0;
        }
        if (args[0] === 'reject') {
          const card = await client.call('kirby.reject', { proposalId: args[1] ?? '' });
          process.stdout.write(`${card.id} is ${card.state}\n`);
          return 0;
        }
        const project = await projectBySlug(client, args[0]);
        const { ingestId } = await client.call('kirby.ingest', { projectId: project.id, repoUrl: args[1] ?? '' });
        process.stdout.write(`ingest ${ingestId} started; proposals arrive as events (sz events ${project.slug})\n`);
        return 0;
      }
      case 'vault': {
        if (args[0] === 'set') {
          const meta = await client.call('vault.set', { id: args[1] ?? '', secret: await readSecret() });
          process.stdout.write(`stored ${meta.id}\n`);
        } else if (args[0] === 'rm') {
          const { deleted } = await client.call('vault.delete', { id: args[1] ?? '' });
          process.stdout.write(deleted ? 'deleted\n' : 'not found\n');
        } else {
          for (const c of (await client.call('vault.list', {})).credentials) process.stdout.write(`${c.id.padEnd(36)} updated ${new Date(c.updatedAt).toISOString()}\n`);
        }
        return 0;
      }
      default:
        process.stderr.write(`unknown command: ${command}\n\n${USAGE}\n`);
        return 2;
    }
  } finally {
    client.close();
  }
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err: unknown) => {
    process.stderr.write(`sz: ${err instanceof RpcCallError ? `${err.code}: ${err.message}` : err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  },
);
