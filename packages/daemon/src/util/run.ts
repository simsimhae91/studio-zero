import { spawn } from 'node:child_process';

export interface RunOptions {
  /** Written to the child's stdin, which is then closed. */
  stdin?: string | Uint8Array;
  timeoutMs?: number;
  /** Per-stream cap. Output beyond it is discarded and `truncated` is set; the child keeps running. */
  maxOutputBytes?: number;
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  signal?: AbortSignal;
  /** Called with stdout chunks as they arrive (after the cap is applied). */
  onStdout?: (chunk: string) => void;
}

export interface RunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  truncated: boolean;
  timedOut: boolean;
  durationMs: number;
}

/**
 * The single seam through which the daemon starts host processes (`docker`, `security`, vendor CLIs).
 * Always argv-based: nothing here ever passes through a host shell, so no value can be re-interpreted as syntax.
 */
export type CommandRunner = (file: string, args: readonly string[], opts?: RunOptions) => Promise<RunResult>;

export const runCommand: CommandRunner = (file, args, opts = {}) =>
  new Promise<RunResult>((resolve, reject) => {
    const started = Date.now();
    const max = opts.maxOutputBytes ?? 8 * 1024 * 1024;
    const child = spawn(file, args, { cwd: opts.cwd, env: opts.env, stdio: ['pipe', 'pipe', 'pipe'], signal: opts.signal });

    const out: Buffer[] = [];
    const err: Buffer[] = [];
    let outBytes = 0;
    let errBytes = 0;
    let truncated = false;
    let timedOut = false;

    const timer =
      opts.timeoutMs === undefined
        ? undefined
        : setTimeout(() => {
            timedOut = true;
            child.kill('SIGKILL');
          }, opts.timeoutMs);

    child.stdout.on('data', (chunk: Buffer) => {
      const room = max - outBytes;
      if (room <= 0) return void (truncated = true);
      const kept = chunk.length > room ? chunk.subarray(0, room) : chunk;
      if (kept.length < chunk.length) truncated = true;
      outBytes += kept.length;
      out.push(kept);
      opts.onStdout?.(kept.toString('utf8'));
    });
    child.stderr.on('data', (chunk: Buffer) => {
      const room = max - errBytes;
      if (room <= 0) return void (truncated = true);
      const kept = chunk.length > room ? chunk.subarray(0, room) : chunk;
      if (kept.length < chunk.length) truncated = true;
      errBytes += kept.length;
      err.push(kept);
    });

    child.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on('close', (code, sig) => {
      clearTimeout(timer);
      resolve({
        exitCode: code ?? (sig ? 128 : 1),
        stdout: Buffer.concat(out).toString('utf8'),
        stderr: Buffer.concat(err).toString('utf8'),
        truncated,
        timedOut,
        durationMs: Date.now() - started,
      });
    });

    // A child that exits before reading stdin raises EPIPE on the pipe; the exit code already tells the story.
    child.stdin.on('error', () => undefined);
    child.stdin.end(opts.stdin);
  });

/** Single-quotes a value for POSIX `sh`. Used only for scripts executed *inside* a sandbox container. */
export function shq(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}
