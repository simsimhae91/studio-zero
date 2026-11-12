import { z } from 'zod';
import { Slug, type Template } from '@studio-zero/protocol';
import { STUDIO_PROJECT_ID } from '../db/Store.ts';
import { textBlock, type ClaudeClient } from '../llm/ClaudeClient.ts';
import { errorMessage, type Logger } from '../util/core.ts';

export interface ProjectIdentity {
  name: string;
  slug: string;
  template: Template;
  /** Where the name came from: the model, or the first words of the idea when no model answered in time. */
  source: 'model' | 'heuristic';
}

/** Fast and cheap on purpose: this is a label, and the owner is waiting on it. */
const NAMER_MODEL = 'claude-haiku-5-5';

export const NAMER_SYSTEM_PROMPT = `You name software projects. You are given the idea for a product as its owner wrote it, possibly at length. Answer with a title of two to four words that someone would recognise the product by in a list of projects: a name, not a description and not a sentence, in the language the idea is written in, with no quotation marks and no trailing punctuation. Add a slug for it: two or three lowercase English words joined by dashes that say what the product is (for example "invoice-tracker"), using only a-z, 0-9 and dashes. Say whether the product is primarily a mobile app (something used on a phone, installed from an app store) rather than a web app or site.`;

const Naming = z.object({
  name: z.string().describe('Two to four words. A name for the product.'),
  slug: z.string().describe('Two or three lowercase English words joined by dashes.'),
  mobile: z.boolean().describe('True when the product is primarily a phone app.'),
});

const MAX_NAME = 40;

/**
 * Turns a paragraph of an idea into what a project is called. A long first sentence makes a poor title, so a
 * small model distils one; if no model is set up, or it does not answer within the time allowed, the name
 * falls back to the idea's first words, because starting must never wait on a label.
 */
export class ProjectNamer {
  readonly #claude: ClaudeClient;
  readonly #log: Logger;
  readonly #timeoutMs: number;

  constructor(deps: { claude: ClaudeClient; log: Logger; timeoutMs?: number }) {
    this.#claude = deps.claude;
    this.#log = deps.log;
    this.#timeoutMs = deps.timeoutMs ?? 12_000;
  }

  /** `template`, when the owner chose one, is kept; otherwise it follows from what the idea describes. */
  async name(idea: string, template?: Template): Promise<ProjectIdentity> {
    const fallback = heuristicIdentity(idea, template);
    if (!this.#claude.isConfigured()) return fallback;
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(new Error('naming timed out')), this.#timeoutMs);
    try {
      const named = await Promise.race([
        this.#claude.structured({ scope: { projectId: STUDIO_PROJECT_ID, taskId: null }, model: NAMER_MODEL, effort: 'low', system: NAMER_SYSTEM_PROMPT, schema: Naming, maxTokens: 400, signal: timeout.signal, content: [textBlock(idea.slice(0, 6000))] }),
        // A provider call that does not honour the signal promptly must still not hold the owner up.
        new Promise<never>((_, reject) => timeout.signal.addEventListener('abort', () => reject(timeout.signal.reason as Error), { once: true })),
      ]);
      const name = cleanName(named.name);
      if (name === '') return fallback;
      const slug = cleanSlug(named.slug);
      return { name, slug: slug ?? fallback.slug, template: template ?? (named.mobile ? 'mobile-expo' : 'web-vite-react'), source: 'model' };
    } catch (err) {
      this.#log.info({ err: errorMessage(err) }, 'project naming fell back to the first words of the idea');
      return fallback;
    } finally {
      clearTimeout(timer);
    }
  }
}

function cleanName(raw: string): string {
  const name = raw.replace(/\s+/g, ' ').replace(/^["'“”‘’`]+|["'“”‘’`.!?。]+$/g, '').trim();
  return name.length <= MAX_NAME ? name : cutAtWord(name, MAX_NAME);
}

function cleanSlug(raw: string): string | null {
  const slug = raw.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32).replace(/-+$/, '');
  return Slug.safeParse(slug).success ? slug : null;
}

function cutAtWord(text: string, max: number): string {
  const cut = text.slice(0, max);
  const at = cut.lastIndexOf(' ');
  return (at > max / 2 ? cut.slice(0, at) : cut).replace(/[\s,.:;·]+$/, '');
}

const MOBILE = /모바일|아이폰|안드로이드|앱\s?스토어|폰에서|스마트폰|\bexpo\b|react native|\bios\b|\bandroid\b|\bmobile\b|\biphone\b/i;
const WEB = /웹\s?(앱|사이트|페이지)|홈페이지|대시보드|랜딩|\bweb\b|\bsite\b|\bdashboard\b|\blanding\b/i;

/** The name and stack an idea gets without asking a model: its first clause, and the platform it names. */
export function heuristicIdentity(idea: string, template?: Template): ProjectIdentity {
  const firstLine = idea.trim().split('\n')[0]!.trim();
  // The first clause is usually the subject; what follows a comma or a full stop is elaboration.
  const clause = firstLine.split(/[,.!?。:;]|\s[-–—]\s/)[0]!.trim() || firstLine;
  const name = clause.length <= 24 ? clause : cutAtWord(clause, 24);
  const ascii = cleanSlug(name);
  const random = Math.random().toString(36).slice(2, 8).padEnd(6, '0');
  const guessed: Template = !WEB.test(idea) && (MOBILE.test(idea) || /(^|\s)앱(을|이|은|\s|$)/.test(idea)) ? 'mobile-expo' : 'web-vite-react';
  return { name: name || 'New project', slug: ascii ?? `project-${random}`, template: template ?? guessed, source: 'heuristic' };
}
