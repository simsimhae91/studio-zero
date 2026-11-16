import { spawn } from 'node:child_process';
import { freePort } from './port.ts';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from 'node:path';
import { stoppedBySandbox } from './web.ts';
import { runCommand, type CommandRunner, type RunResult } from '@studio-zero/daemon/src/util/run.ts';

/** The simulator the eyes use: their own, by this name, so that none of the owner's simulators is ever booted, wiped or installed on. */
export const SPARE_NAME = 'sz-eyes';
const DEFAULT_TYPE = 'iPhone 17';

export class EyesError extends Error {}

const sh = (run: CommandRunner, file: string, args: string[], timeoutMs = 120_000): Promise<RunResult> => run(file, args, { timeoutMs, maxOutputBytes: 16 * 1024 * 1024 });
const must = async (run: CommandRunner, what: string, file: string, args: string[], timeoutMs?: number): Promise<string> => {
  const res = await sh(run, file, args, timeoutMs);
  if (res.exitCode !== 0) {
    // Inside a session's command sandbox the simulator's service cannot be reached: said as that, not as a fault.
    const sandbox = stoppedBySandbox(new Error(`${res.stderr}\n${res.stdout}`), 'the simulator');
    if (sandbox) throw sandbox;
    throw new EyesError(`${what}: ${(res.stderr || res.stdout).trim().split('\n').slice(-3).join(' ').slice(0, 400)}`);
  }
  return res.stdout;
};

interface SimDevice {
  udid: string;
  name: string;
  state: string;
}

async function listDevices(run: CommandRunner): Promise<SimDevice[]> {
  const listed = JSON.parse(await must(run, 'could not list the simulators', 'xcrun', ['simctl', 'list', 'devices', 'available', '--json'])) as { devices: Record<string, SimDevice[]> };
  return Object.values(listed.devices).flat();
}

/**
 * The eyes' own simulator, made the first time it is asked for and booted with no window. Returns its id.
 * `type` is a device type as `xcrun simctl list devicetypes` names it ("iPhone 17").
 */
export async function spareSimulator(opts: { name?: string; type?: string; run?: CommandRunner } = {}): Promise<string> {
  const run = opts.run ?? runCommand;
  const name = opts.name ?? SPARE_NAME;
  let device = (await listDevices(run)).find((d) => d.name === name);
  if (!device) {
    const udid = (await must(run, `could not make a simulator of type ${opts.type ?? DEFAULT_TYPE}`, 'xcrun', ['simctl', 'create', name, opts.type ?? DEFAULT_TYPE])).trim();
    device = { udid, name, state: 'Shutdown' };
  }
  if (device.state !== 'Booted') {
    const booted = await sh(run, 'xcrun', ['simctl', 'boot', device.udid]);
    if (booted.exitCode !== 0 && !/current state: Booted/i.test(booted.stderr)) throw new EyesError(`the simulator did not boot: ${booted.stderr.trim().slice(0, 300)}`);
    await sh(run, 'xcrun', ['simctl', 'bootstatus', device.udid, '-b'], 180_000);
  }
  return device.udid;
}

/**
 * Puts a built app on a simulator, fresh: what was there under its bundle id is removed first, so the app starts
 * as a person who has just installed it. `metroPort` is for a React Native debug build, which loads its
 * JavaScript from a packager: it is told where (the owner's own packager, on its own port, is left alone).
 */
export async function installApp(udid: string, app: string, opts: { bundleId: string; metroPort?: number; run?: CommandRunner }): Promise<void> {
  const run = opts.run ?? runCommand;
  if (!existsSync(app)) throw new EyesError(`${app}: no such app. Build it first (an Expo app: npx expo run:ios; an Xcode project: xcodebuild -sdk iphonesimulator).`);
  await sh(run, 'xcrun', ['simctl', 'terminate', udid, opts.bundleId]);
  await sh(run, 'xcrun', ['simctl', 'uninstall', udid, opts.bundleId]);
  await must(run, 'the app could not be installed', 'xcrun', ['simctl', 'install', udid, app]);
  if (opts.metroPort !== undefined) {
    const data = (await must(run, 'the app has no data folder', 'xcrun', ['simctl', 'get_app_container', udid, opts.bundleId, 'data'])).trim();
    await must(run, 'could not point the app at its packager', 'xcrun', ['simctl', 'spawn', udid, 'defaults', 'write', `${data}/Library/Preferences/${opts.bundleId}`, 'RCT_jsLocation', `localhost:${opts.metroPort}`]);
  }
}

export async function screenshot(udid: string, file: string, run: CommandRunner = runCommand): Promise<string> {
  mkdirSync(dirname(file), { recursive: true });
  await must(run, 'no screenshot could be taken', 'xcrun', ['simctl', 'io', udid, 'screenshot', file]);
  return file;
}

/**
 * Maestro's driver on a simulator answers on a port of the Mac itself, 22087 unless told otherwise, whichever
 * simulator it runs on. With two simulators booted, a call for one was answered by the driver of the other: a
 * look at a spare simulator returned the words of the app another session was verifying. So every call brings a
 * port of its own, and the simulator named is the one that answers.
 */
async function ownDriver(udid: string): Promise<string[]> {
  return ['--driver-host-port', String(await freePort()), '--device', udid];
}

/** What is on the simulator's screen as Maestro reads it: the words, and what can be pressed, in reading order. */
export async function screenText(udid: string, run: CommandRunner = runCommand): Promise<{ texts: string[]; ids: string[] }> {
  const res = await sh(run, 'maestro', [...(await ownDriver(udid)), 'hierarchy'], 120_000);
  const start = res.stdout.indexOf('{');
  if (res.exitCode !== 0 || start === -1) throw new EyesError(`the screen could not be read: ${(res.stderr || res.stdout).trim().slice(-300)}`);
  const texts: string[] = [];
  const ids: string[] = [];
  const walk = (node: { attributes?: Record<string, string>; children?: unknown[] }): void => {
    const a = node.attributes ?? {};
    for (const text of [a.text, a.accessibilityText, a.hintText]) if (text && text.trim() !== '' && !texts.includes(text.trim())) texts.push(text.trim());
    if (a['resource-id'] && !ids.includes(a['resource-id'])) ids.push(a['resource-id']);
    for (const child of node.children ?? []) walk(child as never);
  };
  walk(JSON.parse(res.stdout.slice(start)) as never);
  return { texts, ids };
}

/**
 * A copy of a flow's folder in which nothing a flow writes can land outside `out`: a project's own flows may
 * name absolute paths for their screenshots, and running them as they are would write into the owner's
 * checkout (it did, once: 2026-11-15, eight screenshots overwritten in a project's scratch folder). Returns
 * where the copy of `flow` is.
 */
export function quarantineFlow(flow: string, out: string): string {
  const from = dirname(resolve(flow));
  const to = join(out, 'flows');
  const shots = join(out, 'shots');
  mkdirSync(shots, { recursive: true });
  const copy = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      const target = join(to, relative(from, path));
      if (statSync(path).isDirectory()) {
        if (entry !== 'node_modules' && !entry.startsWith('.')) copy(path);
      } else if (['.yaml', '.yml'].includes(extname(entry))) {
        mkdirSync(dirname(target), { recursive: true });
        // Any absolute path a step writes to (a screenshot, a recording) is moved under `out`, by its file name.
        const text = readFileSync(path, 'utf8').replace(/^(\s*(?:-\s*)?(?:takeScreenshot|startRecording|path)\s*:\s*)(["']?)(\/[^"'\n]+?)\2(\s*)$/gm, (_all, head: string, quote: string, target2: string, tail: string) => `${head}${quote}${join(shots, basename(target2))}${quote}${tail}`);
        writeFileSync(target, text);
      } else if (['.js', '.json'].includes(extname(entry))) {
        mkdirSync(dirname(target), { recursive: true });
        cpSync(path, target);
      }
    }
  };
  copy(from);
  return join(to, basename(flow));
}

export interface FlowResult {
  flow: string;
  passed: boolean;
  seconds: number;
  /** The steps Maestro reported, each with how it ended. */
  steps: { step: string; state: 'completed' | 'failed' | 'skipped' | 'warned' }[];
  /** The first step that failed, with what Maestro said of it. */
  failed: string | null;
  screenshots: string[];
  video: string | null;
  /** Frames of the video side by side, when one was made and ffmpeg is here. */
  filmstrip: string | null;
  log: string;
}

/**
 * Runs one Maestro flow on a simulator and keeps what it showed. The flow is the project's own or one written
 * for this check: Maestro's format, nothing of ours. It runs from a quarantined copy (see `quarantineFlow`),
 * and with `video` the screen is recorded while it runs.
 */
export async function runFlow(udid: string, flow: string, opts: { out: string; env?: Record<string, string>; video?: boolean; timeoutSec?: number; run?: CommandRunner }): Promise<FlowResult> {
  const run = opts.run ?? runCommand;
  if (!existsSync(flow)) throw new EyesError(`${flow}: no such flow`);
  if (!isAbsolute(opts.out)) throw new EyesError('the folder for what is seen must be an absolute path');
  mkdirSync(opts.out, { recursive: true });
  const name = basename(flow).replace(/\.ya?ml$/, '');
  const copy = quarantineFlow(flow, opts.out);
  const video = opts.video ? join(opts.out, `${name}.mp4`) : null;
  const recorder = video ? spawn('xcrun', ['simctl', 'io', udid, 'recordVideo', '--codec=h264', '--force', video], { stdio: 'ignore' }) : null;
  const started = Date.now();
  const res = await run('maestro', [...(await ownDriver(udid)), 'test', ...Object.entries(opts.env ?? {}).flatMap(([key, value]) => ['-e', `${key}=${value}`]), copy], { cwd: dirname(copy), timeoutMs: (opts.timeoutSec ?? 600) * 1000, maxOutputBytes: 8 * 1024 * 1024 });
  if (recorder) {
    // The recorder writes its file when it is interrupted, not when it is killed.
    recorder.kill('SIGINT');
    await new Promise<void>((done) => {
      recorder.once('exit', () => done());
      setTimeout(done, 15_000);
    });
  }
  const log = `${res.stdout}\n${res.stderr}`.split('\n').filter((line) => !/WARNING:|restricted method|java\.lang|enable-native-access/.test(line)).join('\n');
  const steps: FlowResult['steps'] = [];
  for (const line of log.split('\n')) {
    const read = /^\s*(.+?)\.\.\. (COMPLETED|FAILED|SKIPPED|WARNED)\s*$/.exec(line);
    if (read) steps.push({ step: read[1]!.trim(), state: read[2]!.toLowerCase() as FlowResult['steps'][number]['state'] });
  }
  const failedAt = steps.find((step) => step.state === 'failed');
  const why = /^(?:.*\n)*?((?:Assertion is false|Element not found|.*(?:Error|Exception)).*)$/m.exec(log)?.[1] ?? '';
  const shots = join(opts.out, 'shots');
  const screenshots = existsSync(shots) ? readdirSync(shots).filter((file) => file.endsWith('.png')).sort().map((file) => join(shots, file)) : [];
  let filmstrip: string | null = null;
  if (video && existsSync(video)) {
    const strip = join(opts.out, `${name}-film.png`);
    // Eight frames across the run, small: what happened, at a glance.
    const seconds = Math.max(1, (Date.now() - started) / 1000);
    const made = await run('ffmpeg', ['-y', '-loglevel', 'error', '-i', video, '-vf', `fps=${(8 / seconds).toFixed(4)},scale=240:-1,tile=8x1`, '-frames:v', '1', strip], { timeoutMs: 120_000 }).catch(() => null);
    if (made && made.exitCode === 0 && existsSync(strip)) filmstrip = strip;
  }
  const passed = res.exitCode === 0 && !res.timedOut && !failedAt;
  return { flow, passed, seconds: Math.round((Date.now() - started) / 1000), steps, failed: passed ? null : `${failedAt?.step ?? (res.timedOut ? 'the flow did not finish in time' : 'the flow did not pass')}${why ? `: ${why.trim().slice(0, 300)}` : ''}`, screenshots, video: video && existsSync(video) ? video : null, filmstrip, log: log.trim().split('\n').slice(-60).join('\n') };
}

/** Shuts the eyes' simulator down. With `erase` it is also wiped, so the next look starts from a factory state. */
export async function restSimulator(udid: string, opts: { erase?: boolean; run?: CommandRunner } = {}): Promise<void> {
  const run = opts.run ?? runCommand;
  await sh(run, 'xcrun', ['simctl', 'shutdown', udid]);
  if (opts.erase) await sh(run, 'xcrun', ['simctl', 'erase', udid]);
}
