// The eyes' own simulator is handed over with Safari past its first run. On a simulator wiped just before, Safari
// shows a tip the first time it loads a page ("북마크, 공유 메뉴 및 열린 탭 보기"), and it sits in front of the "열기"
// prompt of a link that opens the app: a tap on "열기" does nothing. On 2026-11-18 a builder and three rulings
// each stopped there. The state the tip is shown by is one entry in Safari's own preferences (iOS 26.4).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spareSimulator } from '../src/ios.ts';
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
