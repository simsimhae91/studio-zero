// The eyes' own simulator is handed over with Safari past its first run. On a simulator wiped just before, Safari
// shows a tip the first time it loads a page ("북마크, 공유 메뉴 및 열린 탭 보기"), and it sits in front of the "열기"
// prompt of a link that opens the app: a tap on "열기" does nothing. On 2026-11-18 a builder and three rulings
// each stopped there. The state the tip is shown by is one entry in Safari's own preferences (iOS 26.4).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { simulatorRoom, simulatorsHeld, spareSimulator } from '../src/ios.ts';
import type { CommandRunner, RunResult } from '@studio-zero/daemon/src/util/run.ts';

const UDID = '9FCE8F7E-0000-0000-0000-000000000001';
const HOME = `/sims/${UDID}/data/Containers/Data/Application/ABCD`;
const done = (stdout = '', exitCode = 0, stderr = ''): RunResult => ({ exitCode, stdout, stderr, truncated: false, timedOut: false, durationMs: 1 });

/** A simulator service that answers as the real one does, and keeps what it was asked. */
function simulators(state: 'Shutdown' | 'Booted' | 'none', opts: { safari?: boolean } = {}): { run: CommandRunner; asked: string[] } {
  const asked: string[] = [];
  const run: CommandRunner = async (file, args) => {
    const line = [file, ...args].join(' ');
    asked.push(line);
    if (line.includes('simctl list devices')) return done(JSON.stringify({ devices: { 'iOS-26-4': state === 'none' ? [] : [{ udid: UDID, name: 'sz-eyes', state }] } }));
    if (line.includes('simctl create')) return done(`${UDID}\n`);
    if (line.includes('get_app_container')) return opts.safari === false ? done('', 2, 'No such file or directory') : done(`${HOME}\n`);
    return done();
  };
  return { run, asked };
}

const WRITE = `xcrun simctl spawn ${UDID} defaults write ${HOME}/Library/Preferences/com.apple.mobilesafari WBSOnboardingStatesDefaultsKeyV0.2 -dict-add TipForMoreButton -int 3`;

test('a simulator the eyes boot has Safari past its first-run tip, written after the boot and added to what Safari keeps', async () => {
  const sim = simulators('Shutdown');
  assert.equal(await spareSimulator({ run: sim.run }), UDID);
  const booted = sim.asked.findIndex((line) => line.includes('simctl bootstatus'));
  const written = sim.asked.indexOf(WRITE);
  assert.ok(booted !== -1, 'it was booted');
  assert.ok(written > booted, `Safari's state is written once the simulator is up: ${sim.asked.join(' | ')}`);
  assert.ok(sim.asked.some((line) => line === `xcrun simctl get_app_container ${UDID} com.apple.mobilesafari data`), "into Safari's own folder, asked of the simulator");
});

test('one made just now, and one that was already up (wiped and booted by other hands), are handed over the same way', async () => {
  const made = simulators('none');
  assert.equal(await spareSimulator({ run: made.run }), UDID);
  assert.ok(made.asked.includes(WRITE));
  const up = simulators('Booted');
  assert.equal(await spareSimulator({ run: up.run }), UDID);
  assert.ok(!up.asked.some((line) => line.includes('simctl boot ')), 'not booted again');
  assert.ok(up.asked.includes(WRITE));
});

test('a simulator whose Safari cannot be reached is still handed over', async () => {
  const sim = simulators('Shutdown', { safari: false });
  assert.equal(await spareSimulator({ run: sim.run }), UDID);
  assert.ok(!sim.asked.some((line) => line.includes('defaults write')), 'nothing is written to a folder that was not found');
});

test('a simulator is not booted beside as many as the Mac holds: it is said which are up, or waited for', async () => {
  // (2026-11-21: three verifiers took four simulators on a Mac of 24 GB, each 3.8 GB, beside nine stacks. The
  // swap filled, a boot took four minutes, and the look took over an hour where one verifier had taken 37.)
  assert.deepEqual([[24, 10], [16, 8], [36, 12], [64, 16], [8, 8], [128, 10]].map(([gb, cores]) => simulatorsHeld(gb! * 2 ** 30, cores!)), [2, 1, 3, 4, 1, 2]);

  const devices = [
    { udid: 'A', name: 'sz-phone-1', state: 'Booted' },
    { udid: 'B', name: 'the owner\'s', state: 'Booted' },
    { udid: 'C', name: 'sz-phone-3', state: 'Shutdown' },
  ];
  const asked: string[] = [];
  const run: CommandRunner = async (file, args) => {
    const line = [file, ...args].join(' ');
    asked.push(line);
    if (line.includes('simctl list devices')) return done(JSON.stringify({ devices: { 'iOS-26-4': devices } }));
    if (line.includes('simctl boot ')) devices.find((d) => d.udid === args[2])!.state = 'Booted';
    if (line.includes('get_app_container')) return done('', 2, 'none');
    return done();
  };
  await assert.rejects(spareSimulator({ name: 'sz-phone-3', run, holds: 2 }), /this Mac holds 2 simulators at once and 2 are up: sz-phone-1 \(A\), the owner's \(B\)\. With one more the Mac swaps[^]*sz-eyes ios spare --name sz-phone-3 --wait 9 \(minutes\)\. Never boot one another way/);
  assert.equal(asked.some((line) => line.includes('simctl boot') || line.includes('simctl create')), false, 'nothing was booted or made');
  // One that is up already is handed over: it takes no more room.
  assert.equal(await spareSimulator({ name: 'sz-phone-1', run, holds: 2 }), 'A');
  // Waited for: when one is rested, this one boots.
  let looks = 0;
  const resting: CommandRunner = async (file, args) => {
    if ([file, ...args].join(' ').includes('simctl list devices') && ++looks === 3) devices[0]!.state = 'Shutdown';
    return run(file, args);
  };
  assert.equal(await spareSimulator({ name: 'sz-phone-3', run: resting, holds: 2, waitMs: 5_000, pauseMs: 5 }), 'C');
  assert.equal(devices[2]!.state, 'Booted');
  // A wait that ends with none rested says so, as when not waited.
  await assert.rejects(spareSimulator({ name: 'sz-phone-4', run, holds: 2, waitMs: 30, pauseMs: 5 }), /holds 2 simulators at once and 2 are up/);

  const room = await simulatorRoom({ run, memoryBytes: 24 * 2 ** 30, cores: 10 });
  assert.deepEqual([room.holds, room.memoryGb, room.cores, room.up!.map((d) => d.name)], [2, 24, 10, ['the owner\'s', 'sz-phone-3']]);
  const inSandbox = await simulatorRoom({ run: async () => done('', 1, 'CoreSimulatorService connection became invalid'), memoryBytes: 24 * 2 ** 30, cores: 10 });
  assert.deepEqual([inSandbox.holds, inSandbox.up], [2, null], 'what the Mac holds is known where the simulators cannot be asked');
});
