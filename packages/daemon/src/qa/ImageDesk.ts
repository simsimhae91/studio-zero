import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Project } from '@studio-zero/protocol';
import type { EventLog } from '../events/EventLog.ts';
import type { ClaudeClient } from '../llm/ClaudeClient.ts';
import type { OrbStackManager } from '../sandbox/OrbStackManager.ts';
import { UnavailableError } from '../app/errors.ts';
import { runCommand, type CommandRunner } from '../util/run.ts';
import type { Clock } from '../util/core.ts';

/** Every picture made for a project, with what was asked for and why: kept in the repository beside them. */
export const IMAGE_LOG_FILE = '.studio-zero/images.json';
/** Longest side of what is written into a workspace. Larger than any screen column needs at 2x; smaller than what the tool returns. */
const MAX_SIDE = 1600;

/** Whatever can draw: today, the Codex CLI on the owner's subscription. */
export interface ImageMaker {
  availability(): Promise<{ available: boolean; reason: string }>;
  generateImage(req: { description: string; shape: 'landscape' | 'portrait' | 'square'; signal?: AbortSignal }): Promise<{ png: Uint8Array; inputTokens: number; outputTokens: number; cachedTokens: number }>;
}

/** Turns the PNG that came back into what the product ships: a JPEG or a PNG no larger than `maxSide`. */
export type ImageConvert = (png: Uint8Array, to: 'png' | 'jpeg', maxSide: number) => Promise<Uint8Array>;

/** The size of a PNG or a JPEG, read from its header. Null for anything else. */
export function imageSize(bytes: Uint8Array): { width: number; height: number; type: 'png' | 'jpeg' } | null {
  const b = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (b.length > 24 && b.readUInt32BE(0) === 0x89504e47 && b.readUInt32BE(4) === 0x0d0a1a0a) return { width: b.readUInt32BE(16), height: b.readUInt32BE(20), type: 'png' };
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
    // Walk the segments to the frame header, which carries the dimensions.
    for (let at = 2; at + 9 < b.length; ) {
      if (b[at] !== 0xff) return null;
      const marker = b[at + 1]!;
      const length = b.readUInt16BE(at + 2);
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return { width: b.readUInt16BE(at + 7), height: b.readUInt16BE(at + 5), type: 'jpeg' };
      at += 2 + length;
    }
  }
  return null;
}

/** macOS's own image tool. The daemon runs on a Mac; nothing is installed for this. */
export const sipsConvert = (run: CommandRunner = runCommand): ImageConvert => async (png, to, maxSide) => {
  const dir = await mkdtemp(join(tmpdir(), 'sz-sips-'));
  try {
    const from = join(dir, 'in.png');
    const out = join(dir, to === 'jpeg' ? 'out.jpg' : 'out.png');
    await writeFile(from, png, { mode: 0o600 });
    const res = await run('/usr/bin/sips', [...(to === 'jpeg' ? ['-s', 'format', 'jpeg', '-s', 'formatOptions', '85'] : []), '-Z', String(maxSide), from, '--out', out], { timeoutMs: 60_000 });
    if (res.exitCode !== 0) throw new Error(`sips exited ${res.exitCode}`);
    return new Uint8Array(await readFile(out));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
};

/**
 * Pictures for the product a project is making.
 *
 * A subscription that can draw is a material like a typeface is: used for what the product is about (the food,
 * the place, the thing for sale, the world of a game), not to fill a gap. An engine asks through one tool; the
 * picture is made on the host by the CLI with nothing but its image tool, checked to be a picture, brought down
 * to a size a product ships, and written into the workspace with a line in the image log saying what was asked
 * for and why. The call is metered against the task like any other on the subscription.
 */
export class ImageDesk {
  readonly #sandboxes: OrbStackManager;
  readonly #events: EventLog;
  readonly #claude: Pick<ClaudeClient, 'recordBridge'>;
  readonly #maker: ImageMaker | null;
  readonly #convert: ImageConvert;
  readonly #clock: Clock;

  constructor(deps: { sandboxes: OrbStackManager; events: EventLog; claude: Pick<ClaudeClient, 'recordBridge'>; maker: ImageMaker | null; convert?: ImageConvert; clock: Clock }) {
    this.#sandboxes = deps.sandboxes;
    this.#events = deps.events;
    this.#claude = deps.claude;
    this.#maker = deps.maker;
    this.#convert = deps.convert ?? sipsConvert();
    this.#clock = deps.clock;
  }

  /** The caller has already had the action decided by policy. `path` ends in .png, .jpg or .jpeg. */
  async make(ctx: { project: Project; taskId: string; signal?: AbortSignal }, req: { description: string; path: string; shape: 'landscape' | 'portrait' | 'square'; purpose: string }): Promise<{ path: string; width: number; height: number; bytes: number }> {
    const able = this.#maker ? await this.#maker.availability() : null;
    if (!this.#maker || !able?.available) throw new UnavailableError('no image generator is connected: the Codex CLI is not installed or not logged in on this Mac');
    const started = this.#clock();
    const made = await this.#maker.generateImage({ description: req.description, shape: req.shape, signal: ctx.signal });
    this.#claude.recordBridge({ projectId: ctx.project.id, taskId: ctx.taskId }, 'codex:image', { inputTokens: made.inputTokens, outputTokens: made.outputTokens, cachedTokens: made.cachedTokens });
    if (imageSize(made.png)?.type !== 'png') throw new Error('what came back from the image tool is not a PNG');

    const picture = await this.#convert(made.png, /\.jpe?g$/i.test(req.path) ? 'jpeg' : 'png', MAX_SIDE);
    const size = imageSize(picture);
    if (!size) throw new Error('the converted picture could not be read');
    await this.#sandboxes.writeFile(ctx.project, req.path, picture);

    const before = await this.#sandboxes.exec(ctx.project, `[ -f ${IMAGE_LOG_FILE} ] && head -c 400000 ${IMAGE_LOG_FILE}`, { timeoutSec: 20 });
    let log: unknown[] = [];
    try {
      const parsed: unknown = JSON.parse(before.stdout || '[]');
      if (Array.isArray(parsed)) log = parsed;
    } catch {
      // A log that no longer parses is started again; the pictures themselves are in the repository.
    }
    log.push({ path: req.path, purpose: req.purpose, description: req.description, shape: req.shape, width: size.width, height: size.height, via: 'codex', at: new Date(this.#clock()).toISOString() });
    await this.#sandboxes.writeFile(ctx.project, IMAGE_LOG_FILE, `${JSON.stringify(log.slice(-200), null, 2)}\n`);

    this.#events.emit({ projectId: ctx.project.id, taskId: ctx.taskId }, { type: 'image.generated', path: req.path, purpose: req.purpose.slice(0, 200), width: size.width, height: size.height, bytes: picture.length, durationMs: this.#clock() - started });
    return { path: req.path, width: size.width, height: size.height, bytes: picture.length };
  }
}
