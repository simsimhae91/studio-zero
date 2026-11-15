import { realpath } from 'node:fs/promises';
import { basename } from 'node:path';
import { ProductRoot, type Template } from '@studio-zero/protocol';
import { ConflictError } from '../app/errors.ts';
import { assertBranchName } from '../sandbox/scripts.ts';
import { excerpt } from '../util/core.ts';
import type { CommandRunner, RunResult } from '../util/run.ts';

/** A checkout as adoption found it: what becomes the project's main, where its product is and what it is built with. */
export interface Inspected {
  /** The checkout's root, as the filesystem names it. */
  repo: string;
  base: string;
  commit: string;
  commits: number;
  /** The product's folder from the repository's root: '' for the root itself. */
  root: string;
  template: Template;
  /** The folder's own name: what the project is called unless the owner says otherwise. */
  name: string;
  /** Paths with changes that are not committed. They do not come along. */
  uncommitted: number;
}

/** How many folders are looked into for a product, one level down. */
const MAX_FOLDERS = 60;

/**
 * What a product is built with, read off its package.json: the three kinds of product the studio can run in a
 * sandbox, walk in a browser and measure. Anything else is null, and is not brought in.
 */
export function detectStack(pkg: unknown): Template | null {
  if (typeof pkg !== 'object' || pkg === null) return null;
  const of = (key: string): Record<string, unknown> => {
    const part = (pkg as Record<string, unknown>)[key];
    return typeof part === 'object' && part !== null ? (part as Record<string, unknown>) : {};
  };
  const deps = { ...of('devDependencies'), ...of('dependencies') };
  if ('expo' in deps) return 'mobile-expo';
  if ('next' in deps) return 'web-next';
  if ('vite' in deps && 'react' in deps) return 'web-vite-react';
  return null;
}

/** A project's slug from a folder's name: lowercase letters, digits and dashes, beginning with a letter. */
export function slugOf(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^[^a-z]+/, '').replace(/-+$/, '').slice(0, 36).replace(/-+$/, '');
  return slug.length >= 3 ? slug : `${slug || 'app'}-app`.slice(0, 36);
}

/**
 * Reads a checkout on this Mac for adoption, through git and from what is committed: nothing in the working
 * tree is opened and nothing anywhere is written. Throws `ConflictError` with the reason, in the owner's
 * language, when it cannot be brought in.
 */
export async function inspect(run: CommandRunner, path: string, opts: { dir?: string; base?: string } = {}): Promise<Inspected> {
  let repo: string;
  try {
    repo = await realpath(path);
  } catch {
    throw new ConflictError(`${path}: 그런 폴더가 없습니다.`);
  }
  const git = (args: string[]): Promise<RunResult> => run('git', ['-C', repo, ...args], { timeoutMs: 60_000, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_PAGER: 'cat' }, maxOutputBytes: 4 * 1024 * 1024 });
  const top = await git(['rev-parse', '--show-toplevel']);
  if (top.exitCode !== 0) throw new ConflictError(`${repo}: git 저장소가 아닙니다.`);
  if ((await realpath(top.stdout.trim()).catch(() => '')) !== repo) throw new ConflictError(`${repo}: 저장소의 루트가 아닙니다. 루트는 ${top.stdout.trim()} 입니다. 제품이 그 아래 폴더에 있으면 루트를 주고 --dir로 폴더를 말하세요.`);

  const has = async (branch: string): Promise<boolean> => (await git(['rev-parse', '-q', '--verify', `refs/heads/${branch}`])).exitCode === 0;
  const base = opts.base ?? ((await has('main')) ? 'main' : (await git(['symbolic-ref', '--quiet', '--short', 'HEAD'])).stdout.trim());
  try {
    assertBranchName(base);
  } catch {
    throw new ConflictError(base === '' ? '기준 브랜치를 알 수 없습니다(체크아웃이 브랜치에 서 있지 않습니다). --base로 말하세요.' : `${base}: 스튜디오가 쓸 수 없는 브랜치 이름입니다.`);
  }
  if (!(await has(base))) throw new ConflictError(`${repo}에 브랜치 ${base}이(가) 없습니다.`);
  const commit = (await git(['rev-parse', `refs/heads/${base}`])).stdout.trim();
  const commits = Number((await git(['rev-list', '--count', commit])).stdout.trim()) || 0;
  const uncommitted = (await git(['status', '--porcelain'])).stdout.split('\n').filter(Boolean).length;

  /** The stack of the product in a folder of the base branch, or null when there is none to see there. */
  const stackAt = async (folder: string): Promise<Template | null> => {
    const shown = await git(['show', `${commit}:${folder === '' ? '' : `${folder}/`}package.json`]);
    if (shown.exitCode !== 0) return null;
    try {
      return detectStack(JSON.parse(shown.stdout));
    } catch {
      return null;
    }
  };
  const foldersOf = async (under: string): Promise<string[]> => {
    const listed = await git(['ls-tree', '-d', '--name-only', under === '' ? commit : `${commit}:${under}`]);
    return listed.exitCode !== 0 ? [] : listed.stdout.split('\n').filter((name) => name !== '' && !name.startsWith('.') && name !== 'node_modules').slice(0, MAX_FOLDERS).map((name) => (under === '' ? name : `${under}/${name}`));
  };

  let root: string;
  let template: Template | null;
  if (opts.dir !== undefined && opts.dir !== '') {
    if (!ProductRoot.safeParse(opts.dir).success) throw new ConflictError(`${opts.dir}: 제품 폴더는 저장소 안의 폴더 이름이어야 합니다(글자, 숫자, 밑줄로 시작하고 공백 없이, 네 단계까지).`);
    root = opts.dir;
    template = await stackAt(root);
    if (template === null) throw new ConflictError(`${root}/package.json에서 Expo, Next, Vite(React) 가운데 어느 것도 찾지 못했습니다. 스튜디오가 걷고 잴 줄 아는 것은 이 셋입니다.`);
  } else {
    root = '';
    template = await stackAt('');
    if (template === null) {
      // One level down, then the folders of a workspace's `apps`: where a product usually is when it is not at the root.
      const found: { folder: string; template: Template }[] = [];
      for (const folder of [...(await foldersOf('')), ...(await foldersOf('apps'))]) {
        const stack = await stackAt(folder);
        if (stack !== null && ProductRoot.safeParse(folder).success) found.push({ folder, template: stack });
      }
      if (found.length === 0) throw new ConflictError(`${repo}의 ${base}에서 Expo, Next, Vite(React) 앱을 찾지 못했습니다(루트와 그 아래 한 단계, apps/ 아래를 봤습니다). 다른 곳에 있으면 --dir로 말하세요. 스튜디오가 걷고 잴 줄 아는 것은 이 셋입니다.`);
      if (found.length > 1) throw new ConflictError(`제품이 될 만한 폴더가 여럿입니다 (${found.map((f) => `${f.folder}: ${f.template}`).join(', ')}). --dir로 하나를 고르세요.`);
      ({ folder: root, template } = found[0]!);
    }
  }
  return { repo, base, commit, commits, root, template, name: basename(repo), uncommitted };
}

/**
 * Gives a checkout a git remote named `studio` that points at its project's repository on this Mac. The one
 * thing adoption writes into the owner's checkout: a line of its git config, and nothing in its working tree.
 * A remote of that name that is already there is left as it is.
 */
export async function linkCheckout(run: CommandRunner, repo: string, gate: string): Promise<'added' | 'kept' | 'differs'> {
  const env = { ...process.env, GIT_TERMINAL_PROMPT: '0' };
  const existing = await run('git', ['-C', repo, 'remote', 'get-url', 'studio'], { timeoutMs: 30_000, env });
  if (existing.exitCode === 0) return existing.stdout.trim() === gate ? 'kept' : 'differs';
  const added = await run('git', ['-C', repo, 'remote', 'add', 'studio', gate], { timeoutMs: 30_000, env });
  if (added.exitCode !== 0) throw new ConflictError(`체크아웃에 원격 studio를 달지 못했습니다: ${excerpt(added.stderr, 200)}`);
  return 'added';
}
