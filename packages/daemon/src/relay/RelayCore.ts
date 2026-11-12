import type { EventEnvelope, Task } from '@studio-zero/protocol';
import type { Studio } from '../app/Studio.ts';
import type { Store } from '../db/Store.ts';
import type { EventLog } from '../events/EventLog.ts';
import type { Actor } from '../policy/actions.ts';
import { errorMessage } from '../util/core.ts';

/** A run of text with at most one emphasis. Channels render it in their own markup (HTML, mrkdwn, plain). */
export interface Span {
  text: string;
  style?: 'bold' | 'code';
}
export type Line = (string | Span)[];
export const bold = (text: string): Span => ({ text, style: 'bold' });
export const code = (text: string): Span => ({ text, style: 'code' });

export interface RelayButton {
  label: string;
  /** Compact action string, at most 64 bytes: `a:<approvalId>:y`, `m:<taskId>`, `p:<projectId>` … */
  action: string;
}

export interface OutMessage {
  lines: Line[];
  buttons?: RelayButton[][];
  /** Absolute path of a PNG to attach (a screenshot from the last audit). */
  imageFile?: string;
  /** How urgent this is for a channel that has the notion. */
  priority?: 'default' | 'high';
}

export interface RelayCoreDeps {
  /** Channel id as stored in `relay_chats` and used for the actor: `telegram`, `slack`, `ntfy`. */
  channel: 'telegram' | 'slack' | 'ntfy';
  studio: Studio;
  store: Store;
  events: EventLog;
  /** Delivers one message to one chat. Must not throw; delivery is the channel's own queue. */
  send: (chat: string, message: OutMessage) => void;
  /** Chats that receive unsolicited messages (approvals, results). Each belongs to an owner. */
  owners: () => readonly string[];
}

/**
 * What a mobile relay does, independent of which messenger carries it: turn an owner's messages and button taps
 * into `Studio` calls, and turn events into briefings with buttons.
 *
 * A channel adapter is responsible for exactly two things before it calls in here: establishing that the sender
 * is an owner (by the identity the transport provides, never by message content), and naming the chat.
 * Everything a relay can do still passes the PolicyEngine as a remote owner.
 */
export class RelayCore {
  readonly #d: RelayCoreDeps;
  readonly #actor: Actor;
  #unsubscribe: (() => void) | null = null;

  constructor(deps: RelayCoreDeps) {
    this.#d = deps;
    // A remote owner: enough standing to steer work and approve it, not enough to touch credentials or delete
    // projects (the `*.local-owner-only` rules ask for `via: 'desktop'`).
    this.#actor = { type: 'owner', via: deps.channel };
  }

  start(): void {
    this.#unsubscribe ??= this.#d.events.subscribe((e) => this.#onEvent(e));
  }

  stop(): void {
    this.#unsubscribe?.();
    this.#unsubscribe = null;
  }

  // ------------------------------------------------------------- inbound

  /** A text message from an owner: a command, or a prompt for the active project. */
  async text(chat: string, raw: string): Promise<void> {
    const text = raw.trim();
    if (text === '') return;
    const { studio, store, channel } = this.#d;
    const say = (...lines: Line[]): void => this.#d.send(chat, { lines });
    const [command = '', ...rest] = text.split(/\s+/);

    switch (command.toLowerCase().replace(/@.*$/, '')) {
      case '/start':
      case '/help':
        return say(
          [bold('Studio Zero'), ' 연결됨.'],
          [],
          ['/projects — 작업할 프로젝트 선택'],
          ['/status — 진행 중인 작업과 대기 중인 승인'],
          ['/approvals — 대기 중인 승인 다시 보기'],
          ['/checkpoints — 체크포인트로 롤백'],
          ['/cancel — 진행 중인 작업 취소'],
          [],
          ['그 외 메시지는 선택된 프로젝트의 작업 지시로 전달됩니다.'],
        );

      case '/projects': {
        const projects = studio.listProjects();
        if (projects.length === 0) return say(['프로젝트가 없습니다. 데스크톱에서 먼저 만들어주세요.']);
        return this.#d.send(chat, { lines: [['프로젝트를 선택하세요.']], buttons: projects.map((p) => [{ label: `${p.name} (${p.slug})`, action: `p:${p.id}` }]) });
      }

      case '/status': {
        const { activeProjectId } = store.getChat(channel, chat);
        const project = activeProjectId ? store.getProject(activeProjectId) : null;
        const tasks = studio.listTasks(project?.id, 50).filter((t) => t.state === 'running' || t.state === 'awaiting_approval' || t.state === 'queued');
        return say(
          ['프로젝트: ', bold(project ? project.name : '선택 안 됨')],
          [`대기 중인 승인: ${studio.listApprovals('pending').length}건`],
          [tasks.length === 0 ? '진행 중인 작업 없음' : '진행 중인 작업:'],
          ...tasks.map((t): Line => ['• ', code(t.id), ` ${t.state}${t.phase ? ` / ${t.phase}` : ''} — ${t.prompt.slice(0, 80)}`]),
        );
      }

      case '/approvals': {
        const pending = studio.listApprovals('pending');
        if (pending.length === 0) return say(['대기 중인 승인이 없습니다.']);
        for (const a of pending) this.#d.send(chat, approvalMessage(a.id, a.summary, a.expiresAt));
        return;
      }

      case '/checkpoints': {
        const projectId = this.#activeProject(chat);
        if (!projectId) return;
        const checkpoints = studio.listCheckpoints(projectId).slice(0, 6);
        if (checkpoints.length === 0) return say(['체크포인트가 없습니다.']);
        return this.#d.send(chat, {
          lines: [['되돌릴 체크포인트를 선택하세요. 현재 상태는 롤백 전에 자동 저장됩니다.']],
          buttons: checkpoints.map((c) => [{ label: `${new Date(c.createdAt).toISOString().slice(5, 16).replace('T', ' ')} · ${c.label.slice(0, 40)}`, action: `r:${c.id}` }]),
        });
      }

      case '/cancel': {
        const projectId = this.#activeProject(chat);
        if (!projectId) return;
        const running = studio.listTasks(projectId, 20).find((t) => t.state === 'running' || t.state === 'awaiting_approval' || t.state === 'queued');
        if (!running) return say(['취소할 작업이 없습니다.']);
        studio.cancelTask(running.id);
        return say(['작업 ', code(running.id), ' 취소를 요청했습니다.']);
      }
    }

    // Errands that are not about a project: research, answered with a one-page briefing.
    const asksResearch = command === '/research' || command === '/조사';
    const soundsLikeResearch = !command.startsWith('/') && /(조사해|리서치해|알아봐|찾아봐|브리핑|research (?:this|on|about|into))/i.test(text) && !/(만들어|구현해|고쳐|수정해|추가해)/.test(text);
    if (asksResearch || soundsLikeResearch) {
      const question = asksResearch ? rest.join(' ') : text;
      if (question.trim().length < 4) return say(['무엇을 조사할지 함께 적어 주세요. 예: /research 이번 주 AI 인프라 투자 소식']);
      try {
        const job = await studio.startResearch(this.#actor, { question, depth: 'brief' }, channel);
        return say(['자료 조사로 접수했습니다: ', code(job.id)], ['끝나면 브리핑을 여기로 보냅니다.']);
      } catch (err) {
        return say([`조사를 시작하지 못했습니다: ${errorMessage(err)}`]);
      }
    }

    if (command.startsWith('/')) return say([`알 수 없는 명령입니다: ${command}`]);

    // Prompt on the go: plain text is a task for the active project.
    const projectId = this.#activeProject(chat);
    if (!projectId) return;
    const { refineTaskId } = store.getChat(channel, chat);
    const previous = refineTaskId ? store.getTask(refineTaskId) : null;
    store.setChat(channel, chat, { refineTaskId: null });
    const prompt = previous
      ? `Follow-up to a previous task.\n\nPrevious request:\n${previous.prompt}\n\nPrevious result:\n${previous.summary ?? '(no summary)'}\n\nRequested change:\n${[command, ...rest].join(' ')}`
      : text;
    try {
      const task = await studio.submitTask(this.#actor, { projectId, kind: 'build', prompt }, channel);
      say(['작업 접수: ', code(task.id)]);
    } catch (err) {
      say([`작업을 시작하지 못했습니다: ${errorMessage(err)}`]);
    }
  }

  /**
   * A button tap from an owner. Returns the short confirmation to show and whether the button is now spent
   * (so the channel can remove it and a stale message cannot be tapped twice).
   */
  async action(chat: string, action: string): Promise<{ reply: string; spent: boolean }> {
    const { studio, store, channel } = this.#d;
    const [kind = '', id = '', arg = ''] = action.split(':');
    try {
      switch (kind) {
        case 'a': {
          const approval = studio.resolveApproval(id, arg === 'y' ? 'approve' : 'deny', channel);
          return { reply: approval.state === 'approved' ? '승인했습니다.' : '거절했습니다.', spent: true };
        }
        case 'p': {
          const project = studio.getProject(id);
          store.setChat(channel, chat, { activeProjectId: project.id, refineTaskId: null });
          return { reply: `${project.name} 선택됨`, spent: true };
        }
        case 'm': {
          const task = studio.getTask(id);
          if (!task.branch) throw new Error('이 작업에는 병합할 브랜치가 없습니다.');
          const merged = await studio.merge(this.#actor, task.projectId, task.branch);
          return { reply: `${merged.into}에 병합했습니다.`, spent: true };
        }
        case 'f': {
          const task = studio.getTask(id);
          store.setChat(channel, chat, { activeProjectId: task.projectId, refineTaskId: task.id });
          return { reply: '수정할 내용을 메시지로 보내주세요.', spent: false };
        }
        case 'v': {
          const task = studio.getTask(id);
          if (!task.baseCheckpointId) throw new Error('이 작업에는 시작 체크포인트가 없습니다.');
          await studio.rollback(this.#actor, task.projectId, task.baseCheckpointId);
          return { reply: '작업 시작 전 상태로 되돌렸습니다.', spent: true };
        }
        case 'r': {
          const projectId = store.getCheckpoint(id)?.projectId;
          if (!projectId) throw new Error('체크포인트를 찾을 수 없습니다.');
          await studio.rollback(this.#actor, projectId, id);
          return { reply: '체크포인트로 되돌렸습니다.', spent: true };
        }
        default:
          return { reply: '알 수 없는 버튼입니다.', spent: false };
      }
    } catch (err) {
      return { reply: `실패: ${errorMessage(err)}`, spent: false };
    }
  }

  #activeProject(chat: string): string | null {
    const { store, studio, channel } = this.#d;
    const { activeProjectId } = store.getChat(channel, chat);
    if (activeProjectId && store.getProject(activeProjectId)) return activeProjectId;
    const projects = studio.listProjects();
    if (projects.length === 1) {
      store.setChat(channel, chat, { activeProjectId: projects[0]!.id });
      return projects[0]!.id;
    }
    this.#d.send(chat, { lines: [['먼저 /projects 로 프로젝트를 선택해주세요.']] });
    return null;
  }

  // ------------------------------------------------------------ outbound

  #onEvent(e: EventEnvelope): void {
    const body = e.body;
    switch (body.type) {
      case 'approval.requested':
        return this.#broadcast({ ...approvalMessage(body.approvalId, body.summary, body.expiresAt), priority: 'high' });
      case 'task.state': {
        if (e.taskId === null || (body.state !== 'succeeded' && body.state !== 'failed')) return;
        const task = this.#d.store.getTask(e.taskId);
        if (task) this.#broadcast(this.#taskMessage(task));
        return;
      }
      case 'kirby.proposal':
        if (body.state === 'proposed') this.#broadcast({ lines: [[bold('Kirby 제안')], [body.title], [], ['데스크톱에서 내용을 확인하고 구현을 시작할 수 있습니다.']] });
        return;
      case 'knowledge.state': {
        // The briefing goes back to the channel the errand came from.
        if (body.state === 'running') return;
        const { job, markdown } = this.#d.studio.getKnowledge(body.jobId);
        if (job.origin !== this.#d.channel) return;
        if (body.state === 'failed') return this.#broadcast({ lines: [[bold(job.title)], [`조사를 마치지 못했습니다: ${(job.error ?? '').slice(0, 400)}`]], priority: 'high' });
        return this.#broadcast({ lines: markdown.slice(0, 3400).split('\n').map((line): Line => [line]) });
      }
      case 'git.merged':
        // Only merges nobody tapped for on this channel are news; a tap already got its own confirmation.
        return;
      case 'notice':
        if (body.level === 'error') this.#broadcast({ lines: [[`⚠️ ${body.message.slice(0, 600)}`]], priority: 'high' });
        return;
      default:
        return;
    }
  }

  #taskMessage(task: Task): OutMessage {
    const { store } = this.#d;
    const project = store.getProject(task.projectId);
    const title: Line = [bold(project?.name ?? task.projectId), ' · ', code(task.id)];
    if (task.state === 'failed') {
      return { lines: [title, [`작업 실패: ${(task.error ?? '알 수 없는 오류').slice(0, 500)}`], ['워크스페이스는 작업 전 브랜치로 돌아갔습니다.']], priority: 'high' };
    }
    const audit = store.listAudits(task.projectId, 10).find((a) => a.taskId === task.id);
    const report = audit ? store.getAudit(audit.id) : null;
    const shot = report?.screenshots.find((s) => s.viewport === 'iphone-15-pro' && s.fold === 0) ?? report?.screenshots[0];
    const lines: Line[] = [title, [(task.summary ?? '작업 완료').slice(0, 600)]];
    if (report) lines.push([`시각 품질 ${report.score.toFixed(0)}/100 (기준 ${report.threshold})`]);
    lines.push([`토큰 ${task.spentTokens.toLocaleString('en-US')}`]);
    return {
      lines,
      imageFile: shot ? store.getArtifact(shot.artifactId)?.file : undefined,
      buttons: [
        [
          { label: '승인 (Merge)', action: `m:${task.id}` },
          { label: '재수정 (Refactor)', action: `f:${task.id}` },
        ],
        [{ label: '롤백 (Revert)', action: `v:${task.id}` }],
      ],
    };
  }

  #broadcast(message: OutMessage): void {
    for (const chat of this.#d.owners()) this.#d.send(chat, message);
  }
}

export function approvalMessage(approvalId: string, summary: string, expiresAt: number): OutMessage {
  const minutes = Math.max(1, Math.round((expiresAt - Date.now()) / 60_000));
  return {
    lines: [[bold('승인 요청')], [summary], [], [`${minutes}분 안에 응답하지 않으면 자동으로 거절됩니다.`]],
    buttons: [
      [
        { label: '승인', action: `a:${approvalId}:y` },
        { label: '거절', action: `a:${approvalId}:n` },
      ],
    ],
  };
}

/** Plain-text rendering, for channels without markup and for logs. */
export function renderPlain(lines: readonly Line[]): string {
  return lines.map((line) => line.map((part) => (typeof part === 'string' ? part : part.text)).join('')).join('\n');
}
