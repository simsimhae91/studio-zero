import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Lesson, Project } from '@studio-zero/protocol';
import type { Config } from '../config.ts';
import type { LessonEvidence, Store } from '../db/Store.ts';
import type { EventLog } from '../events/EventLog.ts';
import type { PolicyEngine } from '../policy/PolicyEngine.ts';
import { newId, type Clock } from '../util/core.ts';

export interface LessonDraft {
  scope: 'project' | 'global';
  kind: 'rule' | 'heuristic';
  title: string;
  trigger: string;
  guidance: string;
}

const LIMITS = { title: 100, trigger: 200, guidance: 500 };

/** Phrases a lesson may not contain. Lessons become standing guidance for future agents, so this is a write barrier. */
const FORBIDDEN: [RegExp, string][] = [
  [/https?:\/\/|\bwww\.|\b\d{1,3}(?:\.\d{1,3}){3}\b/i, 'contains a URL or address'],
  [/\b(?:curl|wget|nc|ncat|ssh|scp|ftp|telnet)\b/i, 'mentions a network transfer tool'],
  [/[A-Za-z0-9+/]{40,}={0,2}/, 'contains an encoded blob'],
  // "token" alone is allowed: design tokens are this product's daily vocabulary.
  [/\b(?:approv\w*|polic(?:y|ies)|permission\w*|credential\w*|secret\w*|(?:api|auth|access|bearer|session|refresh)[ _-]?tokens?|api[ _-]?keys?|password\w*|vault|keychain)\b/i, 'refers to approvals, policy or credentials'],
  [/\b(?:ignore|disregard|override|forget)\b.{0,40}\b(?:instruction|previous|prior|above|system|rule)s?\b/i, 'reads as an instruction override'],
  [/\b(?:skip|disable|bypass|remove|delete|weaken|comment out)\b.{0,40}\b(?:evals?|tests?|lint\w*|audit\w*|verif\w*|checks?|type ?check\w*)\b|--no-verify|\bsz-allow\b/i, 'tells agents to weaken verification'],
  [/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f​-‏‪-‮⁠-⁤﻿]/, 'contains control or invisible characters'],
];

/** Deterministic acceptance test for a lesson's text. Returns the reason for rejection, or null when acceptable. */
export function lintLesson(draft: LessonDraft): string | null {
  for (const field of ['title', 'trigger', 'guidance'] as const) {
    const value = draft[field];
    if (value.trim().length < 8) return `${field} is too short to be actionable`;
    if (value.length > LIMITS[field]) return `${field} is longer than ${LIMITS[field]} characters`;
    for (const [pattern, reason] of FORBIDDEN) if (pattern.test(value)) return `${field} ${reason}`;
  }
  return null;
}

/**
 * The harness's long-term memory: what earlier runs taught about this project (rules) and about building
 * software in general (heuristics).
 *
 * Memory written by a model from traces that contain untrusted content is a persistence vector for prompt
 * injection, so the write path is deliberately narrow:
 *   1. the text must pass `lintLesson` (no URLs, no mention of approvals/credentials, nothing that weakens checks);
 *   2. it must cite events that really exist in the originating task's trace (checked by the caller);
 *   3. it starts as a `candidate`, which is stored and shown to the owner but never shown to an agent;
 *   4. it becomes `active` through the PolicyEngine: owner action, or two independent tasks deriving it with no
 *      harm recorded (project scope only; global lessons always need the owner);
 *   5. two harm reports quarantine it.
 * Active lessons are advice in the user turn. They are never merged into a system prompt.
 */
export class LessonBook {
  readonly #store: Store;
  readonly #events: EventLog;
  readonly #policy: PolicyEngine;
  readonly #config: Config;
  readonly #clock: Clock;

  constructor(deps: { store: Store; events: EventLog; policy: PolicyEngine; config: Config; clock: Clock }) {
    this.#store = deps.store;
    this.#events = deps.events;
    this.#policy = deps.policy;
    this.#config = deps.config;
    this.#clock = deps.clock;
  }

  /** Active lessons that apply to a project, with the text block an engine receives. */
  forTask(projectId: string): { ids: string[]; text: string } {
    const active = this.#store.listLessons(projectId, 'active').slice(-40);
    if (active.length === 0) return { ids: [], text: '' };
    const lines = active.map((l) => `- [${l.id}] When ${l.trigger.replace(/\.$/, '')}: ${l.guidance}`);
    return {
      ids: active.map((l) => l.id),
      text: `Guidance learned from earlier work on this project. It is advisory: follow it where it applies, and say so in your final message if a point turned out to be wrong.\n${lines.join('\n')}`,
    };
  }

  /** Records a lesson a reflection derived. Returns what happened to it. */
  propose(project: Project, draft: LessonDraft, evidence: LessonEvidence, confirmsLessonId: string | null): { lesson: Lesson; outcome: 'created' | 'confirmed' } {
    const now = this.#clock();
    const existing = confirmsLessonId ? this.#store.getLesson(confirmsLessonId) : null;
    const visible = existing && existing.state !== 'retired' && (existing.scope === 'global' || existing.projectId === project.id);
    if (existing && visible) {
      const lesson = this.#store.confirmLesson(existing.id, evidence, now)!;
      return { lesson: this.#maybeActivate(lesson), outcome: 'confirmed' };
    }
    const lesson: Lesson = {
      id: newId('les'),
      scope: draft.scope,
      projectId: draft.scope === 'project' ? project.id : null,
      kind: draft.kind,
      title: draft.title.trim(),
      trigger: draft.trigger.trim(),
      guidance: draft.guidance.trim(),
      state: 'candidate',
      confirmations: 1,
      harms: 0,
      originTaskId: evidence.taskId,
      createdAt: now,
      updatedAt: now,
    };
    this.#store.insertLesson(lesson, [evidence]);
    this.#events.emit({ projectId: project.id, taskId: evidence.taskId }, { type: 'lesson.changed', lessonId: lesson.id, state: lesson.state, title: lesson.title });
    return { lesson, outcome: 'created' };
  }

  /** A reflection judged that an applied lesson made a run worse. Two such reports quarantine it. */
  reportHarm(lessonId: string, taskId: string): void {
    const lesson = this.#store.harmLesson(lessonId, this.#clock());
    if (lesson && lesson.harms >= 2 && lesson.state === 'active') this.#setState(lesson, 'quarantined', taskId);
  }

  /** Owner-driven state change (the caller has already authorised it as an owner action). */
  setState(lessonId: string, state: 'active' | 'retired' | 'quarantined'): Lesson | null {
    const lesson = this.#store.getLesson(lessonId);
    return lesson ? this.#setState(lesson, state, null) : null;
  }

  #maybeActivate(lesson: Lesson): Lesson {
    if (lesson.state !== 'candidate') return lesson;
    const decision = this.#policy.evaluate({ type: 'system' }, { kind: 'lesson.activate', lessonId: lesson.id, scope: lesson.scope, projectId: lesson.projectId });
    return decision.effect === 'allow' ? this.#setState(lesson, 'active', null) : lesson;
  }

  #setState(lesson: Lesson, state: Lesson['state'], taskId: string | null): Lesson {
    const updated = this.#store.setLessonState(lesson.id, state, this.#clock())!;
    this.#events.emit({ projectId: lesson.projectId, taskId }, { type: 'lesson.changed', lessonId: lesson.id, state, title: lesson.title });
    return updated;
  }

  /**
   * Renders the memory as files: `projects/<slug>/project_rules.md` and `system_heuristics.json` under the
   * daemon's home. They live on the host, outside every workspace, so an agent can read its guidance (through
   * the prompt) but cannot edit it. The database is the source of truth; these are for people and for diffing.
   */
  async render(project: Project): Promise<void> {
    const mine = this.#store.listLessons(project.id, undefined).filter((l) => l.scope === 'project');
    const section = (title: string, state: Lesson['state']): string => {
      const rows = mine.filter((l) => l.state === state);
      return rows.length === 0 ? '' : `## ${title}\n\n${rows.map((l) => `### ${l.title}\n\n- When: ${l.trigger}\n- Do: ${l.guidance}\n- Evidence: ${l.confirmations} task(s), ${l.harms} harm report(s) · \`${l.id}\`\n`).join('\n')}\n`;
    };
    const markdown = [`# Project rules: ${project.name}\n\nGenerated by Studio Zero from task reflections. Edit through the app, not this file.\n`, section('Active', 'active'), section('Candidates (not shown to agents yet)', 'candidate'), section('Quarantined', 'quarantined')]
      .filter(Boolean)
      .join('\n');
    const dir = join(this.#config.home, 'projects', project.slug);
    await mkdir(dir, { recursive: true, mode: 0o700 });
    await writeFile(join(dir, 'project_rules.md'), markdown, { mode: 0o600 });

    const heuristics = this.#store
      .listLessons(undefined, undefined)
      .filter((l) => l.scope === 'global' && l.state !== 'retired')
      .map(({ id, kind, title, trigger, guidance, state, confirmations, harms, updatedAt }) => ({ id, kind, title, trigger, guidance, state, confirmations, harms, updatedAt }));
    await writeFile(join(this.#config.home, 'system_heuristics.json'), `${JSON.stringify({ version: 1, heuristics }, null, 2)}\n`, { mode: 0o600 });
  }
}
