import { spawn as spawnProcess } from 'node:child_process';
import type { PowerMode, PowerState } from '@studio-zero/protocol';
import { errorMessage, type Logger } from './core.ts';

const CAFFEINATE = '/usr/bin/caffeinate';

/**
 * What each mode asks of macOS. `system`: no idle sleep and no system sleep, while the display is free to turn
 * off (a long build overnight keeps running and the screen rests). `display`: the display stays on as well.
 *
 * "As well" is literal: `display` holds everything `system` holds, plus the display. `-d` by itself is only the
 * display's idle assertion. It does not hold the system-sleep assertion (`-s`, which is what keeps a Mac on AC
 * power running with its lid closed), so the mode that reads as the stronger one let a build be suspended in a
 * case the weaker one covered.
 */
export const CAFFEINATE_FLAGS: Record<Exclude<PowerMode, 'off'>, readonly string[]> = {
  system: ['-i', '-s'],
  display: ['-d', '-i', '-s'],
};

/** The little of a child process this needs, so a test can stand one in. */
export interface PowerProcess {
  kill(): void;
  /** Called once when the process ends, however it ends. */
  onExit(listener: () => void): void;
}
export type PowerSpawner = (file: string, args: readonly string[]) => PowerProcess;

const realSpawner: PowerSpawner = (file, args) => {
  const child = spawnProcess(file, [...args], { stdio: 'ignore' });
  let ended = false;
  const listeners: (() => void)[] = [];
  const end = (): void => {
    if (ended) return;
    ended = true;
    listeners.forEach((listener) => listener());
  };
  child.once('exit', end);
  child.once('error', end);
  return { kill: () => void child.kill('SIGTERM'), onExit: (listener) => void (ended ? listener() : listeners.push(listener)) };
};

/**
 * Keeps the Mac awake while the owner wants it awake, by holding one `caffeinate` process.
 *
 * There is exactly one such process or none. Changing the mode ends the old one before starting the new, and
 * the process is told to watch this daemon (`-w <pid>`): if the daemon dies without tidying up, the assertion
 * dies with it, so a crash can never leave the machine awake for good.
 */
export class CaffeinateManager {
  readonly #spawn: PowerSpawner;
  readonly #supported: boolean;
  readonly #pid: number;
  readonly #log: Logger;
  readonly #onChange: (mode: PowerMode) => void;
  #mode: PowerMode = 'off';
  #process: PowerProcess | null = null;

  constructor(deps: { log: Logger; spawn?: PowerSpawner; platform?: NodeJS.Platform; pid?: number; onChange?: (mode: PowerMode) => void }) {
    this.#spawn = deps.spawn ?? realSpawner;
    this.#supported = (deps.platform ?? process.platform) === 'darwin';
    this.#pid = deps.pid ?? process.pid;
    this.#log = deps.log;
    this.#onChange = deps.onChange ?? (() => undefined);
  }

  get state(): PowerState {
    return { mode: this.#mode, supported: this.#supported };
  }

  /** Switches mode. Asking for the mode already held does nothing; on anything but macOS only `off` is possible. */
  set(mode: PowerMode): PowerState {
    if (mode === this.#mode) return this.state;
    if (!this.#supported && mode !== 'off') throw new Error('keeping this machine awake needs macOS caffeinate, which is not here');
    this.#release();
    if (mode !== 'off') {
      let held: PowerProcess;
      try {
        held = this.#spawn(CAFFEINATE, [...CAFFEINATE_FLAGS[mode], '-w', String(this.#pid)]);
      } catch (err) {
        this.#setMode('off');
        throw new Error(`could not start caffeinate: ${errorMessage(err)}`);
      }
      this.#process = held;
      // Ended by something other than this class (killed from a terminal, say): the Mac may sleep again, so say so.
      held.onExit(() => {
        if (this.#process !== held) return;
        this.#process = null;
        this.#log.warn({ mode }, 'caffeinate ended by itself; the Mac is no longer kept awake');
        this.#setMode('off');
      });
    }
    this.#setMode(mode);
    return this.state;
  }

  /** Lets the Mac sleep again. Called when the daemon stops. */
  stop(): void {
    this.#release();
    this.#mode = 'off';
  }

  #release(): void {
    const held = this.#process;
    this.#process = null;
    held?.kill();
  }

  #setMode(mode: PowerMode): void {
    if (mode === this.#mode) return;
    this.#mode = mode;
    this.#onChange(mode);
  }
}
