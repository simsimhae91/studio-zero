// The tree asked of Maestro's driver directly is the tree `maestro hierarchy` prints: three real screens of an
// iPhone 17 simulator (iOS 26.4, Maestro 2.6.0), each read both ways in the same second on 2026-11-21.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { treeOfDriver } from '../src/ios-driver.ts';
import { readTree } from '../src/ios.ts';

const here = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'ios-driver');
const pair = (name: string): { driver: unknown; maestro: unknown } => ({ driver: JSON.parse(readFileSync(join(here, `${name}.driver.json`), 'utf8')), maestro: JSON.parse(readFileSync(join(here, `${name}.maestro.json`), 'utf8')) });
const SIZE = { w: 402, h: 874 };

test("what a held driver answers is read as Maestro reads it: the same tree, node for node", () => {
  // The product's own first screen (React Native); Settings with its search field and the keyboard up, whose list
  // runs far below the screen; the home screen, where the icons of other pages have no size.
  for (const name of ['app-on01', 'settings-search', 'home']) {
    const { driver, maestro } = pair(name);
    assert.deepEqual(treeOfDriver(driver, SIZE), maestro, name);
  }
});

test('a part with no size, or off the screen, is left out as Maestro leaves it out, and one it keeps is kept', () => {
  const node = (frame: [number, number, number, number], children: unknown[] = [], more: Record<string, unknown> = {}): unknown => ({ label: '', elementType: 1, identifier: '', title: '', enabled: true, hasFocus: false, selected: false, frame: { X: frame[0], Y: frame[1], Width: frame[2], Height: frame[3] }, children, ...more });
  const tree = treeOfDriver(
    {
      depth: 3,
      axElement: node([0, 0, 0, 0], [
        node([0, 0, 402, 874], [
          node([201, 478, 0, 0], [], { label: 'no size' }),
          node([402, 0, 402, 874], [], { label: 'the next page' }),
          node([20, 858, 362, 53], [node([351, 877, 11, 14], [], { label: 'below the edge' })], { label: 'a row cut by the edge' }),
          node([20, 911, 362, 53], [node([30, 920, 20, 20], [], { label: 'its icon' })], { label: 'a row below the edge' }),
          // A part with no width has no area to be a tenth of: Maestro keeps it, and so does this.
          node([10, 900, 0, 10], [], { label: 'no width' }),
          // Seen as a float, as the driver's numbers are read: 15.999999999999993 is 16, 119.67 is 119.
          node([15.999999999999993, 119.66666666666667, 59.00000000000001, 40.66666666666667], [], { label: '설정', title: '', value: null }),
          node([0, 100, 100, 40], [], { elementType: 40, value: '1', label: 'a switch that is on', placeholderValue: 'hint', identifier: 'sw' }),
          node([0, 150, 100, 40], [], { elementType: 9, value: '1', title: 'a title', label: 'not a switch' }),
        ]),
      ]),
    },
    SIZE,
  ) as { children: { children: { attributes: Record<string, string>; checked: boolean; children: unknown[] }[] }[] };
  const parts = tree.children[0]!.children;
  assert.deepEqual(parts.map((part) => part.attributes.accessibilityText), ['a row cut by the edge', 'no width', '설정', 'a switch that is on', 'not a switch']);
  assert.equal(parts[0]!.children.length, 0, 'the row stays, what of it lies below the edge goes');
  assert.equal(parts[2]!.attributes.bounds, '[16,119][75,160]');
  assert.deepEqual([parts[3]!.attributes.checked, parts[3]!.checked, parts[3]!.attributes.hintText, parts[3]!.attributes['resource-id'], parts[3]!.attributes.text], ['true', true, 'hint', 'sw', '1']);
  assert.deepEqual([parts[4]!.attributes.checked, parts[4]!.attributes.text, parts[4]!.attributes.value], ['false', 'a title', '1']);
});

test('the look reads the same screen from either tree', () => {
  for (const name of ['app-on01', 'settings-search', 'home']) {
    const { driver, maestro } = pair(name);
    assert.deepEqual(readTree(treeOfDriver(driver, SIZE)), readTree(maestro), name);
  }
  const on01 = readTree(treeOfDriver(pair('app-on01').driver, SIZE));
  assert.ok(on01.texts.includes('카카오로 시작하기') && on01.size?.w === 402 && on01.statusBar === 54);
});
