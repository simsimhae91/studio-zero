import { spawn } from 'node:child_process';
import { freePort } from './port.ts';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
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
  await pastSafariFirstRun(device.udid, run);
  return device.udid;
}

/**
 * On a simulator made or wiped just before, Safari shows a tip the first time it loads a page ("북마크, 공유 메뉴 및
 * 열린 탭 보기"), in front of the "열기" prompt of a link that opens an app: a tap on "열기" then does nothing
 * (2026-11-18: a builder and three rulings each stopped there). Whether the tip is shown is one entry among
 * Safari's onboarding states (iOS 26.4); with it written before Safari's first page, no tip comes. Added to what
 * Safari keeps, written every time the simulator is handed over (a simulator may have been wiped and booted by
 * other hands), and never a reason not to hand it over: on a system that keeps this elsewhere the tip is closed
 * by the flow, as `sz:verify` says.
 */
async function pastSafariFirstRun(udid: string, run: CommandRunner): Promise<void> {
  const home = await sh(run, 'xcrun', ['simctl', 'get_app_container', udid, 'com.apple.mobilesafari', 'data'], 30_000).catch(() => null);
  const folder = home && home.exitCode === 0 ? home.stdout.trim() : '';
  if (folder === '') return;
  await sh(run, 'xcrun', ['simctl', 'spawn', udid, 'defaults', 'write', `${folder}/Library/Preferences/com.apple.mobilesafari`, 'WBSOnboardingStatesDefaultsKeyV0.2', '-dict-add', 'TipForMoreButton', '-int', '3'], 30_000).catch(() => null);
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

export interface Box {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** One named part of a screen, as the screen's tree gives it: what it is called, and where it is laid out, in points. */
export interface ScreenPart {
  text: string;
  id: string;
  /** What a field shows while it is empty. */
  hint: string;
  value: string;
  box: Box;
}

/** A row of words read in a picture of the screen, in points. */
export interface SeenWords {
  text: string;
  box: Box;
}

export interface PhoneScreen {
  /** The words of the app's parts, in the tree's order: no key of the keyboard, nothing of the status bar. */
  texts: string[];
  ids: string[];
  /** In points; null when the tree does not say. */
  size: { w: number; h: number } | null;
  /** Where the status bar's own frame ends; 0 when the tree shows none. */
  statusBar: number;
  /** The height of the band at the foot of a phone with no home button, where the home bar is drawn; else 0. */
  homeBar: number;
  /** Where the keyboard is while it is up. */
  keyboard: Box | null;
  parts: ScreenPart[];
  /** The parts a person types into, as far as the tree tells: it knows a field by the hint it shows while empty. */
  fields: ScreenPart[];
  /** The app's parts the keyboard is in front of, by name. */
  behindKeyboard: string[];
  /** Where the status bar's own words are (the time, the battery): not the app's. */
  system: Box[];
}

type TreeNode = { attributes?: Record<string, string>; children?: TreeNode[] };
const boxOf = (node: TreeNode): Box | null => {
  const read = /^\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]$/.exec(node.attributes?.bounds ?? '');
  if (!read) return null;
  const [x1, y1, x2, y2] = read.slice(1).map(Number) as [number, number, number, number];
  return { x1, y1, x2, y2 };
};
const SCROLL_BAR = /scroll bar|스크롤 막대/i;
const KEYBOARD = /^(inputView|UIKeyboard)/;
/** A phone with no home button has a status bar of 44 points and more, and draws its home bar in the last 34. */
const HOME_BAR = 34;

/**
 * What Maestro's tree of an iOS screen says: the app's parts with their names and places, the keyboard, the
 * status bar. The tree is the app's first, with a window of its own for the keyboard, and the status bar's after
 * it. It says how a screen is laid out, not what of it shows: a part behind a fixed bar, or scrolled out of
 * sight, is in it like any other, and nothing in it tells the two apart (2026-11-19, 23 screens of one app: no
 * container that scrolls was marked as one). What a person sees is read from a picture (`measureScreen`).
 */
export function readTree(tree: unknown): PhoneScreen {
  const root = tree as TreeNode;
  const [app, ...rest] = root.children ?? [];
  const frame = app ? boxOf(app) : null;
  const size = frame && frame.x1 === 0 && frame.y1 === 0 && frame.x2 > 0 && frame.y2 > 0 ? { w: frame.x2, h: frame.y2 } : null;
  const texts: string[] = [];
  const ids: string[] = [];
  const parts: ScreenPart[] = [];
  const system: Box[] = [];
  let keyboard: Box | null = null;
  let statusBar = 0;

  const holds = (node: TreeNode, test: (node: TreeNode) => boolean): boolean => test(node) || (node.children ?? []).some((child) => holds(child, test));
  const isKeyboard = (node: TreeNode): boolean => KEYBOARD.test(node.attributes?.['resource-id'] ?? '');
  const whole = (box: Box): boolean => size !== null && box.x1 <= 0 && box.y1 <= 0 && box.x2 >= size.w && box.y2 >= size.h;
  const take = (node: TreeNode, skip: (box: Box | null) => boolean = () => false): void => {
    const a = node.attributes ?? {};
    const box = boxOf(node);
    if (skip(box)) {
      for (const child of node.children ?? []) take(child, skip);
      return;
    }
    const text = (a.accessibilityText || a.text || a.title || a.value || a.hintText || '').trim();
    const id = (a['resource-id'] ?? '').trim();
    // The frame of the whole screen carries the app's name, and a scroll bar its own: neither is the app's words.
    if (!(box && whole(box)) && !SCROLL_BAR.test(text) && (text !== '' || id !== '')) {
      for (const word of [a.text, a.accessibilityText, a.hintText]) if (word && word.trim() !== '' && !texts.includes(word.trim())) texts.push(word.trim());
      if (id !== '' && !ids.includes(id)) ids.push(id);
      // A part is one with a place: it can be pressed there, and measured.
      if (box && box.x2 > box.x1 && box.y2 > box.y1) {
        const part = { text, id, hint: (a.hintText ?? '').trim(), value: (a.value ?? '').trim(), box };
        if (!parts.some((p) => p.text === part.text && p.id === part.id && p.box.x1 === box.x1 && p.box.y1 === box.y1 && p.box.x2 === box.x2 && p.box.y2 === box.y2)) parts.push(part);
      }
    }
    for (const child of node.children ?? []) take(child, skip);
  };

  // The app's windows: its own first, then one for whatever is in front of it. The keyboard's is not the app's.
  const windows = app?.children ?? [];
  const own = windows.filter((window) => !holds(window, isKeyboard));
  for (const window of windows) {
    if (own.includes(window)) continue;
    const find = (node: TreeNode): void => {
      const box = boxOf(node);
      if (box && isKeyboard(node) && box.y2 > box.y1) keyboard = keyboard ? { x1: Math.min(keyboard.x1, box.x1), y1: Math.min(keyboard.y1, box.y1), x2: Math.max(keyboard.x2, box.x2), y2: Math.max(keyboard.y2, box.y2) } : box;
      for (const child of node.children ?? []) find(child);
    };
    find(window);
  }
  // The status bar's frame is the full width from the top, a strip; what is named inside it is the system's.
  const strip = (node: TreeNode): void => {
    const box = boxOf(node);
    if (box && size && box.x1 === 0 && box.y1 === 0 && box.x2 >= size.w && box.y2 > 0 && box.y2 <= 120) statusBar = Math.max(statusBar, box.y2);
    for (const child of node.children ?? []) strip(child);
  };
  for (const other of rest) strip(other);
  const outside = (node: TreeNode): void => {
    const a = node.attributes ?? {};
    const box = boxOf(node);
    const named = [a.accessibilityText, a.text, a.title, a.value].some((word) => (word ?? '').trim() !== '');
    if (box && named && box.y2 > box.y1 && box.y2 <= statusBar + 2) system.push(box);
    for (const child of node.children ?? []) outside(child);
  };
  for (const other of rest) outside(other);

  for (const window of own) take(window);
  // A tree that is not laid out as windows of one app is read as it stands.
  if (windows.length === 0) take(app ?? root);
  // What the system puts in front of the app (a sheet that asks for access) has words a flow presses too; what
  // the status bar shows is not listed.
  for (const other of rest) take(other, (box) => box !== null && box.y2 <= statusBar + 2);

  const up = keyboard as Box | null;
  const behindKeyboard = up ? [...new Set(parts.filter((part) => part.text !== '' && (part.box.y1 + part.box.y2) / 2 >= up.y1).map((part) => part.text))] : [];
  return { texts, ids, size, statusBar, homeBar: statusBar >= 44 ? HOME_BAR : 0, keyboard: up, parts, fields: parts.filter((part) => part.hint !== ''), behindKeyboard, system };
}

/**
 * What a person sees of the app where it does not belong: its words under the status bar, or in the band the home
 * bar is drawn in. Measured on the words read in a picture of the screen, placed by what the tree says of the
 * screen: where the status bar ends, where the keyboard is. `seen` is null when the picture could not be read.
 */
export function measureScreen(screen: PhoneScreen, seen: SeenWords[] | null, why = ''): string[] {
  if (!screen.size) return ["the screen's size is not in its tree: nothing was measured"];
  if (!seen) return [`the picture could not be read${why ? ` (${why})` : ''}: what shows under the status bar and in the home bar's band was not measured`];
  const { h } = screen.size;
  const findings: string[] = [];
  for (const row of ownRows(screen, seen)) {
    const said = `${JSON.stringify(row.text)} (from ${row.box.y1} to ${row.box.y2} of ${h} points down)`;
    // A row of words is read with a point or two of air around it.
    if (screen.statusBar > 0 && row.box.y1 < screen.statusBar - 2) findings.push(`under the status bar, which ends at ${screen.statusBar}: ${said}`);
    if (screen.homeBar > 0 && row.box.y2 > h - screen.homeBar + 2 && row.box.y1 < h) findings.push(`in the home bar's band, the last ${screen.homeBar} points: ${said}`);
  }
  return findings;
}

const over = (a: Box, b: Box): boolean => a.x1 < b.x2 && b.x1 < a.x2 && a.y1 < b.y2 && b.y1 < a.y2;

/** The rows read in a picture that are the app's: not the status bar's own words, not the keys of the keyboard. */
export function ownRows(screen: PhoneScreen, rows: SeenWords[]): SeenWords[] {
  return rows.filter((row) => !(screen.keyboard && (row.box.y1 + row.box.y2) / 2 >= screen.keyboard.y1) && !screen.system.some((box) => over(box, row.box)));
}

/** Parses what `ios-read.swift` prints. */
export function readRows(printed: string): SeenWords[] {
  const rows: SeenWords[] = [];
  for (const line of printed.split('\n')) {
    const read = /^(-?\d+)\t(-?\d+)\t(-?\d+)\t(-?\d+)\t(.+)$/.exec(line);
    if (read) rows.push({ text: read[5]!.trim(), box: { x1: Number(read[1]), y1: Number(read[2]), x2: Number(read[3]), y2: Number(read[4]) } });
  }
  return rows;
}

const READER = fileURLToPath(new URL('./ios-read.swift', import.meta.url));

export interface PhoneLook {
  screen: PhoneScreen;
  /** The words read in the picture, or null when it could not be read. */
  seen: SeenWords[] | null;
  findings: string[];
  /** The picture, when one was asked to be kept. */
  shot: string | null;
}

/**
 * A look at a simulator's screen: its tree as Maestro reads it (names, places, the keyboard), a picture, the
 * words read in the picture, and what of the app shows under the status bar or in the home bar's band.
 * (2026-11-19: with a picture and a list of words to go on, a verifier wrote its own reader of pictures and its
 * own measure of the tree, 85 minutes for the claim that every screen fits, and the claim stayed unchecked.)
 */
export async function lookAt(udid: string, opts: { shot?: string; run?: CommandRunner } = {}): Promise<PhoneLook> {
  const run = opts.run ?? runCommand;
  const kept = opts.shot ?? null;
  const picture = kept ?? join(tmpdir(), `sz-ios-look-${udid}-${process.pid}.png`);
  try {
    await screenshot(udid, picture, run);
    const res = await sh(run, 'maestro', [...(await ownDriver(udid)), 'hierarchy'], 120_000);
    const start = res.stdout.indexOf('{');
    if (res.exitCode !== 0 || start === -1) throw new EyesError(`the screen could not be read: ${(res.stderr || res.stdout).trim().slice(-300)}`);
    const screen = readTree(JSON.parse(res.stdout.slice(start)));
    let seen: SeenWords[] | null = null;
    let why = '';
    if (screen.size) {
      const read = await sh(run, 'xcrun', ['swift', READER, picture, String(screen.size.w), String(screen.size.h)], 120_000);
      if (read.exitCode === 0) seen = ownRows(screen, readRows(read.stdout));
      else why = (read.stderr || read.stdout).trim().split('\n').slice(-1)[0]?.slice(0, 200) ?? '';
    }
    return { screen, seen, findings: measureScreen(screen, seen, why), shot: kept };
  } finally {
    if (!kept) rmSync(picture, { force: true });
  }
}

/** The look as the command prints it. */
export function lookText(look: PhoneLook): string {
  const { screen, seen, findings } = look;
  const quoted = (words: string[], most = 80): string => words.slice(0, most).map((word) => JSON.stringify(word)).join(' ');
  const at = (box: Box): string => (screen.size ? `${Math.round(((box.x1 + box.x2) / 2 / screen.size.w) * 100)}%,${Math.round(((box.y1 + box.y2) / 2 / screen.size.h) * 100)}%` : `${Math.round((box.x1 + box.x2) / 2)},${Math.round((box.y1 + box.y2) / 2)}`);
  const lines: string[] = [];
  if (look.shot) lines.push(`screenshot: ${look.shot}`);
  if (screen.size) lines.push(`screen: ${screen.size.w} by ${screen.size.h} points${screen.statusBar > 0 ? `, the status bar ends at ${screen.statusBar}` : ''}${screen.homeBar > 0 ? `, the home bar's band is the last ${screen.homeBar}` : ''}${screen.keyboard ? `, the keyboard is up from ${screen.keyboard.y1}` : ''}`);
  lines.push(`words in its tree (${screen.texts.length}; what is behind a fixed bar or scrolled out of sight is among them): ${quoted(screen.texts)}`);
  if (seen) lines.push(`words read in the picture, the app's (${seen.length} rows): ${quoted(seen.map((row) => row.text))}`);
  lines.push(`ids on it (${screen.ids.length}): ${screen.ids.slice(0, 80).join(', ')}`);
  if (screen.fields.length > 0) {
    lines.push(`fields (${screen.fields.length}), as far as the tree knows one (by the hint it shows while empty):`);
    for (const field of screen.fields) lines.push(`  ${JSON.stringify(field.text)}${field.value && field.value !== field.text ? ` holds ${JSON.stringify(field.value)}` : ''}, hint ${JSON.stringify(field.hint)}: ${field.id ? `a flow presses it by its id, ${field.id}` : `it has no id, so a flow presses it by its place, ${at(field.box)} (by its words Maestro may press the label beside it, and what is typed goes nowhere)`}`);
  }
  if (screen.keyboard) lines.push(`behind the keyboard (${screen.behindKeyboard.length}): ${quoted(screen.behindKeyboard, 40)}`);
  lines.push(findings.length === 0 ? "measured on the picture: none of the app's words under the status bar or in the home bar's band" : `measured (${findings.length}):\n${findings.map((finding) => `  ${finding}`).join('\n')}`);
  return lines.join('\n');
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
