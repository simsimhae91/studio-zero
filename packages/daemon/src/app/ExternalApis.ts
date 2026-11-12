import { randomBytes } from 'node:crypto';
import type { ExternalApi, Project } from '@studio-zero/protocol';
import type { Config } from '../config.ts';
import type { Store } from '../db/Store.ts';
import type { Actor } from '../policy/actions.ts';
import { parseApiOrigin, type PolicyEngine } from '../policy/PolicyEngine.ts';
import { Secret, type Clock } from '../util/core.ts';
import type { KeychainVault } from '../vault/KeychainVault.ts';
import { ConflictError, NotFoundError } from './errors.ts';

/** The file in a workspace that lists the connected APIs: base URLs and stand-ins, never keys. */
export const EXTERNAL_ENV_FILE = '.studio-zero/external.env';

/** A stand-in as it appears anywhere in a request. Long and random, so it cannot be guessed or occur by accident. */
export const PLACEHOLDER = /szs_[A-Za-z0-9_-]{32}/g;
const newPlaceholder = (): string => `szs_${randomBytes(24).toString('base64url')}`;

/** Where a variable's real value is kept. One Keychain item per project, API and variable. */
export function externalCredentialId(project: Pick<Project, 'slug'>, name: string, variable: string): string {
  return `ext/${project.slug}/${name}/${variable.toLowerCase().replaceAll('_', '-')}`;
}

/** `kis` + `APP_KEY` → `KIS_APP_KEY`: the name the project's code reads, here and in production. */
export const envName = (api: string, variable: string): string => `${api.toUpperCase().replaceAll('-', '_')}_${variable}`;

/** What a set of stand-ins found in one request resolves to: one API of one project, and the real value of each. */
export interface ResolvedCall {
  projectId: string;
  name: string;
  origin: string;
  host: string;
  /** Stand-in → real value. */
  values: Map<string, Secret>;
}

/**
 * Outside APIs with keys, for the code a project is made of.
 *
 * A product that calls a broker's, a shop's or a payment provider's API needs that provider's key while it is
 * being built and run in its sandbox. Putting the key in the sandbox (an env var, a `.env` file) hands it to
 * the agent working there, and to whatever text has steered that agent. So it is done the way model keys are:
 * the key stays in the Keychain, the sandbox gets a stand-in, and the swap happens on the host.
 *
 *   connect   at the desk, the owner names the API, gives its https origin, and each key as a variable. The
 *             values go to the Keychain. A random stand-in is made per variable and kept in the database.
 *   use       the workspace gets `.studio-zero/external.env`: `<API>_BASE_URL` pointing at the gateway and
 *             `<API>_<VARIABLE>` holding the stand-in. The project's code reads those names and sends the
 *             "key" wherever the provider wants it: a header, the query string, a JSON or form body.
 *   swap      the gateway finds the stand-ins in the request, checks that they all belong to that API of one
 *             project, puts the real values in their place and forwards to the stored origin. The answer comes
 *             back with any echo of a real value blacked out.
 *
 * A stand-in is the caller's proof as well as its placeholder: only the sandbox of that project has been given
 * it, and it works for nothing except reaching that one origin through this Mac's loopback gateway. In
 * production the same variable names hold the real base URL and the real key, and no gateway is involved.
 */
export class ExternalApis {
  readonly #config: Config;
  readonly #store: Store;
  readonly #vault: KeychainVault;
  readonly #policy: PolicyEngine;
  readonly #clock: Clock;

  constructor(deps: { config: Config; store: Store; vault: KeychainVault; policy: PolicyEngine; clock: Clock }) {
    this.#config = deps.config;
    this.#store = deps.store;
    this.#vault = deps.vault;
    this.#policy = deps.policy;
    this.#clock = deps.clock;
  }

  list(projectId: string): ExternalApi[] {
    return this.#store.listExternalApis(projectId).map((api) => ({ projectId: api.projectId, name: api.name, origin: api.origin, variables: api.variables.map((v) => v.variable), createdAt: api.createdAt }));
  }

  /** Connects an API to a project, or replaces its keys. Every value is written to the Keychain before anything is recorded. */
  async set(actor: Actor, project: Project, p: { name: string; origin: string; variables: readonly { name: string; secret: Secret }[] }): Promise<ExternalApi> {
    const where = parseApiOrigin(p.origin);
    if (!where.ok) throw new ConflictError(`연결할 수 없는 주소입니다: ${where.reason}`);
    const names = p.variables.map((v) => v.name);
    if (new Set(names).size !== names.length) throw new ConflictError('같은 이름의 변수가 두 번 들어 있습니다.');
    if (names.includes('BASE_URL')) throw new ConflictError('BASE_URL은 게이트웨이 주소가 들어가는 이름이라 변수로 쓸 수 없습니다.');
    for (const v of p.variables) if (/\s/.test(v.secret.expose())) throw new ConflictError(`${v.name} 값에 공백이나 줄바꿈이 들어 있습니다. 키만 붙여 넣어 주세요.`);
    await this.#policy.authorize(actor, { kind: 'external.configure', projectId: project.id, name: p.name, op: 'set' });

    await this.#forget(project, p.name);
    const now = this.#clock();
    for (const v of p.variables) {
      const id = externalCredentialId(project, p.name, v.name);
      await this.#vault.set(id, v.secret);
      this.#store.upsertCredential(id, now);
    }
    this.#store.putExternalApi({ projectId: project.id, name: p.name, origin: where.origin, createdAt: now }, p.variables.map((v) => ({ variable: v.name, placeholder: newPlaceholder() })));
    return this.list(project.id).find((api) => api.name === p.name)!;
  }

  async remove(actor: Actor, project: Project, name: string): Promise<void> {
    if (!this.#store.listExternalApis(project.id).some((api) => api.name === name)) throw new NotFoundError(`outside API "${name}"`);
    await this.#policy.authorize(actor, { kind: 'external.configure', projectId: project.id, name, op: 'remove' });
    await this.#forget(project, name);
  }

  /** Disconnects every API of a project and deletes their keys. Called when the project itself goes. */
  async forgetProject(project: Project): Promise<void> {
    for (const api of this.#store.listExternalApis(project.id)) await this.#forget(project, api.name);
  }

  async #forget(project: Project, name: string): Promise<void> {
    const api = this.#store.listExternalApis(project.id).find((a) => a.name === name);
    if (!api) return;
    for (const v of api.variables) {
      const id = externalCredentialId(project, name, v.variable);
      await this.#vault.delete(id);
      this.#store.deleteCredential(id);
    }
    this.#store.deleteExternalApi(project.id, name);
  }

  /**
   * The file a workspace keeps, or null when the project has no API connected. Stand-ins and a loopback
   * address only: safe to commit, and useless anywhere but in a sandbox on this Mac.
   */
  envFile(projectId: string): string | null {
    const apis = this.#store.listExternalApis(projectId);
    if (apis.length === 0) return null;
    const gateway = `http://host.docker.internal:${this.#config.gateway.port}`;
    const blocks = apis.map((api) => [`# ${api.name}: calls go to ${api.origin}`, `${envName(api.name, 'BASE_URL')}=${gateway}/ext/${api.name}`, ...api.variables.map((v) => `${envName(api.name, v.variable)}=${v.placeholder}`)].join('\n'));
    return `# Written by Studio Zero. Do not edit: it is rewritten when the owner connects or disconnects an API.
# These are not keys. Each value below stands in for a key kept in the macOS Keychain, and only works in a call
# made through the base URL beside it, from this project's sandbox. In production, set the same names to the
# provider's real base URL and the real keys.

${blocks.join('\n\n')}
`;
  }

  /**
   * What the stand-ins found in one request to `/ext/<name>` are good for. They must all be this API's, of one
   * project, and there must be at least one: a request that carries none proves nothing about who sent it.
   */
  async resolve(name: string, placeholders: readonly string[]): Promise<ResolvedCall | { refused: string }> {
    if (placeholders.length === 0) return { refused: 'the request carries no stand-in for a key of this API' };
    const found = placeholders.map((p) => ({ placeholder: p, at: this.#store.findExternalPlaceholder(p) }));
    const first = found[0]!.at;
    if (!first || found.some((f) => !f.at || f.at.projectId !== first.projectId || f.at.name !== name)) return { refused: 'a stand-in in the request does not belong to this API' };
    const project = this.#store.getProject(first.projectId);
    if (!project) return { refused: 'the project this stand-in belongs to no longer exists' };
    const values = new Map<string, Secret>();
    for (const f of found) {
      const secret = await this.#vault.get(externalCredentialId(project, name, f.at!.variable));
      if (!secret) return { refused: `the key for ${f.at!.variable} is not in the Keychain any more; connect the API again` };
      values.set(f.placeholder, secret);
    }
    return { projectId: project.id, name, origin: first.origin, host: new URL(first.origin).host, values };
  }
}
