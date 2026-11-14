#!/usr/bin/env node
import { DEFAULT_DAEMON_PORT, RpcCallError, RpcClient, Template, type EventEnvelope, type Project, type TaskKind } from '@studio-zero/protocol';
import { CredentialIds, KeychainVault } from './vault/KeychainVault.ts';

const USAGE = `sz — Studio Zero command line

  sz status
  sz project list
  sz project create <slug> <name> [${Template.options.join('|')}]
  sz project rm <slug> [--delete-workspace]
  sz task <project-slug> <build|refactor|inline_edit|ideate> [--draft] [--from <branch>] <prompt...>   submit and follow a task (--draft: the fast track; --from: start from that branch, e.g. a failed task's)
  sz events [project-slug]                                                   follow the event stream
  sz approvals                                                               list pending approvals
  sz approve <approval-id> | sz deny <approval-id>
  sz merge <project-slug> <branch>
  sz kirby <project-slug> <https://github.com/owner/repo>
  sz vault list | sz vault set <credential-id> | sz vault rm <credential-id>   (set reads the secret from stdin)
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
        // --from <branch>: the work starts from that branch and not from the default one. For going on from a task that failed.
        const fromAt = args.indexOf('--from');
        const from = fromAt >= 2 ? args[fromAt + 1] : undefined;
        const words = args.slice(2).filter((word, i) => word !== '--draft' && i + 2 !== fromAt && i + 2 !== fromAt + 1);
        const task = await client.call('tasks.submit', { projectId: project.id, kind: args[1] as Exclude<TaskKind, 'kirby_materialize'>, prompt: words.join(' '), ...(draft ? { track: 'fast' as const } : {}), ...(from ? { baseBranch: from } : {}) });
        process.stdout.write(`task ${task.id}\n`);
        return await new Promise<number>((resolve) => {
          client.subscribe({ taskId: task.id }, (e) => {
            printEvent(e);
            if (e.body.type === 'task.state' && ['succeeded', 'failed', 'cancelled'].includes(e.body.state)) resolve(e.body.state === 'succeeded' ? 0 : 1);
          }, 0);
        });
      }
      case 'events': {
        const filter = args[0] ? { projectId: (await projectBySlug(client, args[0])).id } : {};
        client.subscribe(filter, printEvent);
        return await new Promise<number>(() => undefined);
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
        const merged = await client.call('git.merge', { projectId: project.id, branch: args[1] ?? '' });
        process.stdout.write(`merged into ${merged.into} at ${merged.commit.slice(0, 12)}\n`);
        return 0;
      }
      case 'kirby': {
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
