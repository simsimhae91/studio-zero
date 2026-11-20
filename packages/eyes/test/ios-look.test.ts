// A look at a simulator's screen says where the app's parts are, which of them a person types into, where the
// keyboard is, and what of the app shows under the status bar or in the home bar's band. The trees and the rows
// of words here are real: three screens of a React Native app on an iPhone 17 simulator (iOS 26.4), read by
// Maestro and by macOS's text recognition on 2026-11-19. That night a verifier with only a picture and a list of
// words to go on wrote its own reader of pictures and its own measure of the tree: 85 minutes for the claim that
// every screen fits, and the claim stayed unchecked.
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { lookAt, lookText, measureScreen, ownRows, readRows, readTree, type SeenWords } from '../src/ios.ts';
import type { CommandRunner, RunResult } from '@studio-zero/daemon/src/util/run.ts';

const fixture = (name: string): string => readFileSync(fileURLToPath(new URL(`./fixtures/ios/${name}`, import.meta.url)), 'utf8');
const tree = (name: string) => readTree(JSON.parse(fixture(`${name}.tree.json`)));
const rows = (name: string): SeenWords[] => readRows(fixture(`${name}.rows.tsv`));

test('a screen\'s tree gives its size, where the status bar ends, the keyboard, and the app\'s own words and fields', () => {
  // RC-02: a weight being typed, the number pad up.
  const typing = tree('RC-02');
  assert.deepEqual(typing.size, { w: 402, h: 874 });
  assert.equal(typing.statusBar, 54, 'the status bar\'s own frame, as the tree has it');
  assert.equal(typing.homeBar, 34, 'a phone with no home button');
  assert.deepEqual(typing.keyboard, { x1: 0, y1: 566, x2: 402, y2: 874 });
  assert.ok(typing.texts.includes('저장') && typing.texts.includes('체중(kg)'));
  for (const notTheApps of ['1', 'Delete', 'Dictate', '오전 6:48', '배터리 전원 100%', '감량배틀', 'Horizontal scroll bar, 1 page']) assert.equal(typing.texts.includes(notTheApps), false, `${notTheApps} is the keyboard's, the status bar's, the window's name or a scroll bar`);
  assert.deepEqual(typing.ids, [], 'the status bar\'s own ids are not the app\'s');
  assert.deepEqual(typing.fields.map((f) => [f.text, f.value, f.hint, f.id, f.box]), [['체중(kg)', '76.6', '00.0', '', { x1: 108, y1: 288, x2: 258, y2: 353 }]]);
  assert.deepEqual(typing.behindKeyboard, [], 'the button a person presses next is above it');
  assert.equal(typing.parts.find((p) => p.text === '저장')!.box.y2 <= typing.keyboard!.y1, true);
  assert.equal(typing.system.length, 4, 'the time, the signal, the network and the battery');

  // ON-03: a field with a label beside it and no id.
  const naming = tree('ON-03');
  assert.equal(naming.keyboard, null);
  assert.deepEqual(naming.fields.map((f) => [f.text, f.hint, f.id]), [['닉네임', '2~10자', '']]);
  const said = lookText({ screen: naming, seen: null, findings: [], shot: null });
  assert.match(said, /fields \(1\), as far as the tree knows one \(by the hint it shows while empty\):\n  "닉네임", hint "2~10자": it has no id, so a flow presses it by its place, 46%,44% \(by its words Maestro may press the label beside it/);

  // A part the keyboard is in front of is named.
  const covered = JSON.parse(fixture('RC-02.tree.json'));
  const move = (node: any): void => {
    if (node.attributes?.accessibilityText === '저장') node.attributes.bounds = '[16,600][386,656]';
    for (const child of node.children ?? []) move(child);
  };
  move(covered);
  assert.deepEqual(readTree(covered).behindKeyboard, ['저장']);
});

test('what shows under the status bar or in the home bar\'s band is measured on the picture, not on the tree', () => {
  // BT-03: rows of the list lie behind a fixed bar at the foot. The tree has them in the home bar's band; a
  // person sees none of them, and the picture has none there.
  const battle = tree('BT-03');
  const inBand = battle.parts.filter((p) => p.text !== '' && p.box.y2 > 874 - 34 && p.box.y1 < 874).map((p) => p.text);
  assert.deepEqual([...new Set(inBand)], ['민지', '콕 찌르기', '오늘 아직 안 쟀어요'], 'the tree alone would call these found');
  assert.deepEqual(measureScreen(battle, rows('BT-03')), []);
  assert.deepEqual(measureScreen(tree('RC-02'), rows('RC-02')), [], 'the keys of the keyboard and the time are not the app\'s');
  assert.deepEqual(measureScreen(tree('ON-03'), rows('ON-03')), []);

  // Words a person sees there are found, with where they are.
  const low: SeenWords = { text: '인증 올리기', box: { x1: 150, y1: 846, x2: 255, y2: 866 } };
  const high: SeenWords = { text: '민지와 배틀', box: { x1: 120, y1: 30, x2: 250, y2: 50 } };
  const edge: SeenWords = { text: '다음', box: { x1: 180, y1: 820, x2: 222, y2: 841 } };
  assert.deepEqual(measureScreen(battle, [...rows('BT-03'), low, high, edge]), [
    'in the home bar\'s band, the last 34 points: "인증 올리기" (from 846 to 866 of 874 points down)',
    'under the status bar, which ends at 54: "민지와 배틀" (from 30 to 50 of 874 points down)',
  ]);
  // The time is the status bar's own, wherever the reading puts its edges.
  assert.deepEqual(ownRows(battle, rows('BT-03')).some((row) => row.text === '6:50'), false);
  // With the keyboard up, what is read where the keyboard is belongs to the keyboard.
  const typing = tree('RC-02');
  assert.equal(ownRows(typing, rows('RC-02')).some((row) => ['1', 'GHI', 'WXYZ'].includes(row.text)), false);
  assert.equal(ownRows(typing, rows('RC-02')).some((row) => row.text === '저장'), true);

  assert.deepEqual(measureScreen(battle, null, 'no such tool'), ['the picture could not be read (no such tool): what shows under the status bar and in the home bar\'s band was not measured']);
  assert.deepEqual(measureScreen({ ...battle, size: null }, []), ['the screen\'s size is not in its tree: nothing was measured']);
  assert.deepEqual(readRows('54\t24\t94\t42\t6:48\nnot a row\n-2\t840\t10\t880\ta\tb\n'), [{ text: '6:48', box: { x1: 54, y1: 24, x2: 94, y2: 42 } }, { text: 'a\tb', box: { x1: -2, y1: 840, x2: 10, y2: 880 } }]);
});

test('a look takes a picture, reads the tree and the picture, and says what it measured', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'sz-ios-look-'));
  try {
    const done = (stdout = '', exitCode = 0, stderr = ''): RunResult => ({ exitCode, stdout, stderr, truncated: false, timedOut: false, durationMs: 1 });
    const asked: string[][] = [];
    const answers = (reader: RunResult): CommandRunner => async (file, args) => {
      asked.push([file, ...args]);
      if (file === 'xcrun' && args[0] === 'simctl') {
        writeFileSync(args.at(-1)!, 'png');
        return done();
      }
      if (file === 'maestro') return done(`Running on a simulator\n${fixture('BT-03.tree.json')}`);
      if (file === 'xcrun' && args[0] === 'swift') return reader;
      return done('', 1, 'unexpected');
    };

    const shot = join(folder, 'BT-03.png');
    const look = await lookAt('UDID-1', { shot, run: answers(done(`${fixture('BT-03.rows.tsv')}150\t846\t255\t866\t인증 올리기\n`)) });
    assert.deepEqual(asked.map((call) => call.slice(0, 2).join(' ')), ['xcrun simctl', 'maestro --driver-host-port', 'xcrun swift'], 'the picture first, then the tree, then the picture read');
    const reader = asked[2]!;
    assert.match(reader[2]!, /ios-read\.swift$/);
    assert.equal(existsSync(reader[2]!), true, 'the reader is shipped beside the eyes');
    assert.deepEqual(reader.slice(3), [shot, '402', '874'], 'the picture is read at the screen\'s own size in points');
    assert.equal(look.shot, shot);
    assert.equal(existsSync(shot), true);
    assert.deepEqual(look.findings, ['in the home bar\'s band, the last 34 points: "인증 올리기" (from 846 to 866 of 874 points down)']);
    assert.equal(look.seen!.some((row) => row.text === '6:50'), false, 'only the app\'s rows are kept');
    const said = lookText(look);
    assert.match(said, new RegExp(`^screenshot: ${shot}\\nscreen: 402 by 874 points, the status bar ends at 54, the home bar's band is the last 34\\n`));
    assert.match(said, /words in its tree \(28; what is behind a fixed bar or scrolled out of sight is among them\): "뒤로"/);
    assert.match(said, /words read in the picture, the app's \(\d+ rows\): "<" "민지와 배틀"/);
    assert.match(said, /measured \(1\):\n  in the home bar's band/);

    // No picture asked for: one is taken to measure on, and not left behind.
    asked.length = 0;
    const plain = await lookAt('UDID-1', { run: answers(done(fixture('BT-03.rows.tsv'))) });
    assert.equal(plain.shot, null);
    assert.equal(existsSync(asked[0]!.at(-1)!), false);
    assert.match(lookText(plain), /measured on the picture: none of the app's words under the status bar or in the home bar's band$/);

    // The picture cannot be read (no toolchain): the tree is still given, and it is said what was not measured.
    const blind = await lookAt('UDID-1', { run: answers(done('', 1, 'xcrun: error: unable to find utility "swift"')) });
    assert.equal(blind.seen, null);
    assert.deepEqual(blind.findings, ['the picture could not be read (xcrun: error: unable to find utility "swift"): what shows under the status bar and in the home bar\'s band was not measured']);
    assert.equal(blind.screen.texts.includes('인증 올리기'), true);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});
