import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { inspect } from 'node:util';

const ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz'; // Crockford base32, lowercase

/** Random, URL-safe, prefix-tagged identifier with 100 bits of entropy: `tsk_3f9k...`. */
export function newId(prefix: string): string {
  const bytes = randomBytes(20);
  let out = '';
  for (let i = 0; i < 20; i++) out += ALPHABET[bytes[i]! & 31];
  return `${prefix}_${out}`;
}

export function sha256Hex(input: string | Uint8Array): string {
  return createHash('sha256').update(input).digest('hex');
}

/** Constant-time string comparison that does not leak length through timing. */
export function safeEqual(a: string, b: string): boolean {
  return timingSafeEqual(createHash('sha256').update(a).digest(), createHash('sha256').update(b).digest());
}

/** Deterministic JSON: object keys sorted recursively. Two equal actions always hash the same. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === 'object') {
    const src = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(src).sort()) out[key] = sortKeys(src[key]);
    return out;
  }
  return value;
}

/**
 * A credential in memory. The value is reachable only through `expose()`, and every implicit conversion
 * (template strings, JSON.stringify, console.log, util.inspect, pino serializers) yields `[secret]`.
 * This turns "never log a key" from a convention into something the type system and runtime both enforce.
 */
export class Secret {
  readonly #value: string;

  constructor(value: string) {
    if (value.length === 0) throw new Error('empty secret');
    this.#value = value;
  }

  expose(): string {
    return this.#value;
  }

  toString(): string {
    return '[secret]';
  }

  toJSON(): string {
    return '[secret]';
  }

  [inspect.custom](): string {
    return '[secret]';
  }
}

export type Clock = () => number;
export const systemClock: Clock = () => Date.now();

/** The structural subset of pino's API the daemon uses, so tests can pass a silent logger. */
export interface Logger {
  debug(obj: object, msg?: string): void;
  info(obj: object, msg?: string): void;
  warn(obj: object, msg?: string): void;
  error(obj: object, msg?: string): void;
}

export const silentLogger: Logger = { debug() {}, info() {}, warn() {}, error() {} };

/** Head + tail excerpt of long text. Keeps both ends because build errors usually sit at the bottom. */
export function excerpt(text: string, max: number): string {
  if (text.length <= max) return text;
  const head = Math.floor(max * 0.4);
  const tail = max - head;
  return `${text.slice(0, head)}\n… [${text.length - max} characters omitted] …\n${text.slice(-tail)}`;
}

/**
 * A provider failure the owner can do something about, said plainly instead of as a status code and a JSON body.
 * Duck-typed on the shape SDK errors have, so this file does not load an SDK.
 */
function providerProblem(err: object): string | null {
  const status = (err as { status?: unknown }).status;
  const type = (err as { error?: { error?: { type?: unknown } } }).error?.error?.type;
  if (status === 401 || type === 'authentication_error') return '모델 제공자가 저장된 API 키를 받아들이지 않았습니다 (401). 설정의 자격 증명에서 키를 다시 저장해 주세요.';
  if (status === 403 || type === 'permission_error') return '이 API 키로는 요청한 모델을 쓸 수 없습니다 (403). 키의 권한과 워크스페이스를 확인해 주세요.';
  if (type === 'billing_error') return '모델 제공자 계정의 결제 상태 때문에 요청이 거절됐습니다. 크레딧이나 결제 수단을 확인해 주세요.';
  return null;
}

export function errorMessage(err: unknown): string {
  if (typeof err === 'object' && err !== null) {
    const problem = providerProblem(err);
    if (problem) return problem;
  }
  return err instanceof Error ? err.message : String(err);
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason as Error);
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(signal!.reason as Error);
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** Serialises async work per key. Used so one project's workspace is never mutated by two tasks at once. */
export class KeyedMutex {
  readonly #tails = new Map<string, Promise<unknown>>();

  async run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.#tails.get(key) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    const tail = next.catch(() => undefined);
    this.#tails.set(key, tail);
    try {
      return await next;
    } finally {
      if (this.#tails.get(key) === tail) this.#tails.delete(key);
    }
  }
}
