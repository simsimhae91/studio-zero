import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { OwnerSettings } from '@studio-zero/protocol';
import { ConfigSchema, type Config } from '../config.ts';
import type { EventLog } from '../events/EventLog.ts';
import { ConflictError } from './errors.ts';

const TOPIC = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * The part of `config.json` an owner changes from the app: who is told and where (ntfy, Telegram, Slack),
 * how much a task and a day may spend, and how long an approval waits.
 *
 * Until this existed the file was the only way in. Turning notifications on meant writing JSON by hand and
 * restarting a background service from a terminal, and nothing in the app said either was needed.
 *
 * What it does not do is as deliberate. It writes the file and nothing else: the daemon goes on running with
 * what it read at boot, and says that a restart is owed (`restartRequired`), because a relay is started once
 * and a budget is read all over. It touches only its own sections and leaves every other key of the file as
 * the owner wrote it. And who may call `set` is decided by the server, not here: only a connection opened on
 * this Mac itself (see `DaemonServer`), since these sections say who counts as the owner on other channels.
 */
export class OwnerConfig {
  readonly #running: Config;
  readonly #events: EventLog;
  readonly file: string;

  constructor(deps: { config: Config; events: EventLog }) {
    this.#running = deps.config;
    this.#events = deps.events;
    this.file = join(deps.config.home, 'config.json');
  }

  /** The settings as the file has them now: what the daemon will run with after its next start. */
  get(): OwnerSettings {
    return pick(ConfigSchema.parse(this.#raw()));
  }

  /** Whether the file has moved on from what this process read when it started. */
  get restartRequired(): boolean {
    return !isDeepStrictEqual(this.get(), pick(this.#running));
  }

  /** Writes the owner's sections into the file. The rest of the file is kept as it is. */
  set(next: OwnerSettings): OwnerSettings {
    const problems = check(next);
    if (problems.length > 0) throw new ConflictError(problems.join(' '));
    const raw = this.#raw();
    const before = pick(ConfigSchema.parse(raw));
    const merged: Record<string, unknown> = { ...raw };
    for (const section of SECTIONS) merged[section] = { ...(isRecord(raw[section]) ? raw[section] : {}), ...next[section] };
    // The whole file has to hold, not only the sections written: a file the daemon cannot start from is worse than no change.
    ConfigSchema.parse(merged);
    const temp = `${this.file}.${process.pid}.tmp`;
    writeFileSync(temp, `${JSON.stringify(merged, null, 2)}\n`, { mode: 0o600 });
    renameSync(temp, this.file);
    const sections = SECTIONS.filter((section) => !isDeepStrictEqual(before[section], next[section]));
    if (sections.length > 0) this.#events.emit({ projectId: null, taskId: null }, { type: 'config.changed', sections });
    return this.get();
  }

  #raw(): Record<string, unknown> {
    if (!existsSync(this.file)) return {};
    const parsed: unknown = JSON.parse(readFileSync(this.file, 'utf8'));
    return isRecord(parsed) ? parsed : {};
  }
}

const SECTIONS = ['ntfy', 'telegram', 'slack', 'budgets', 'approvals'] as const;
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

function pick(config: Pick<Config, (typeof SECTIONS)[number]>): OwnerSettings {
  return OwnerSettings.parse({
    ntfy: { enabled: config.ntfy.enabled, server: config.ntfy.server, topic: config.ntfy.topic, commandTopic: config.ntfy.commandTopic },
    telegram: { enabled: config.telegram.enabled, allowedUserIds: config.telegram.allowedUserIds },
    slack: { enabled: config.slack.enabled, allowedUserIds: config.slack.allowedUserIds },
    budgets: { taskTokens: config.budgets.taskTokens, projectDailyTokens: config.budgets.projectDailyTokens },
    approvals: { ttlSec: config.approvals.ttlSec },
  });
}

/** What the shape alone cannot say: a channel that is switched on has to be able to work, and to know who its owner is. */
function check(s: OwnerSettings): string[] {
  const problems: string[] = [];
  if (s.ntfy.enabled) {
    if (!TOPIC.test(s.ntfy.topic) || !TOPIC.test(s.ntfy.commandTopic)) problems.push('ntfy를 켜려면 알림 토픽과 명령 토픽이 모두 있어야 합니다. 영문, 숫자, -, _만 쓰고 64자까지입니다.');
    else if (s.ntfy.topic === s.ntfy.commandTopic) problems.push('ntfy의 알림 토픽과 명령 토픽은 서로 달라야 합니다.');
  }
  if (s.telegram.enabled && s.telegram.allowedUserIds.length === 0) problems.push('Telegram을 켜려면 명령을 받을 사용자 ID가 하나 이상 있어야 합니다. 없으면 아무 말도 듣지 않습니다.');
  if (s.slack.enabled && s.slack.allowedUserIds.length === 0) problems.push('Slack을 켜려면 명령을 받을 멤버 ID가 하나 이상 있어야 합니다.');
  if (s.budgets.projectDailyTokens < s.budgets.taskTokens) problems.push('프로젝트 하루 예산이 작업 하나의 예산보다 작습니다. 그러면 작업 하나가 끝까지 가지 못합니다.');
  return problems;
}
