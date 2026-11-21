/**
 * What Maestro's driver on a simulator answers when asked for the screen, read the way Maestro itself reads it.
 *
 * `maestro hierarchy` starts a Java process and a driver each time, eight seconds on a quiet Mac, and a check of
 * every screen asks fifty times (2026-11-21: one run of such a check took 26 minutes). A driver that is held up
 * answers the same question in a tenth of a second (`ios-hold.ts`). What it answers is the driver's own form;
 * this makes of it the tree the command prints, so that everything that reads a screen reads the same thing
 * whichever way it was asked. The two rules are Maestro's (2.6.0): `IOSDriver.mapViewHierarchy`, and
 * `TreeNode.filterOutOfBounds` with `UiElement.getVisiblePercentage`. Whoever holds a driver checks once, on a
 * live screen, that this still agrees with the command (`ios-hold.ts`): a Maestro that reads differently is
 * noticed there, and the command is used instead.
 */

/** A node of the tree as `maestro hierarchy` prints it. */
export interface MaestroNode {
  attributes: Record<string, string>;
  children: MaestroNode[];
  enabled: boolean;
  focused: boolean;
  checked: boolean;
  selected: boolean;
}

interface DriverElement {
  label?: string | null;
  elementType?: number;
  identifier?: string | null;
  title?: string | null;
  value?: string | null;
  placeholderValue?: string | null;
  enabled?: boolean;
  hasFocus?: boolean;
  selected?: boolean;
  frame?: { X?: number; Y?: number; Width?: number; Height?: number };
  children?: DriverElement[] | null;
}

// XCUIElementType: checkBox, switch, toggle.
const CHECKABLE = new Set([12, 40, 41]);

interface Placed {
  node: MaestroNode;
  x: number;
  y: number;
  w: number;
  h: number;
  children: Placed[];
}

function mapped(element: DriverElement): Placed {
  // The driver's numbers are read as 32-bit floats and cut to whole points, the right and bottom edges after the
  // sum: 15.999999999999993 is 16, and 119.67 + 40.67 is 160.
  const f = Math.fround;
  const left = f(element.frame?.X ?? 0);
  const top = f(element.frame?.Y ?? 0);
  const x = Math.trunc(left);
  const y = Math.trunc(top);
  const right = Math.trunc(f(left + f(element.frame?.Width ?? 0)));
  const bottom = Math.trunc(f(top + f(element.frame?.Height ?? 0)));
  const title = element.title ?? null;
  const value = element.value ?? null;
  const checked = CHECKABLE.has(element.elementType ?? -1) && value === '1';
  const enabled = element.enabled === true;
  const focused = element.hasFocus === true;
  const selected = element.selected === true;
  const children = (element.children ?? []).map(mapped);
  return {
    node: {
      attributes: {
        accessibilityText: element.label ?? '',
        title: title ?? '',
        value: value ?? '',
        text: title === null ? '' : title !== '' ? title : (value ?? ''),
        hintText: element.placeholderValue ?? '',
        'resource-id': element.identifier ?? '',
        bounds: `[${x},${y}][${right},${bottom}]`,
        enabled: String(enabled),
        focused: String(focused),
        selected: String(selected),
        checked: String(checked),
      },
      children: [],
      enabled,
      focused,
      checked,
      selected,
    },
    x,
    y,
    w: right - x,
    h: bottom - y,
    children,
  };
}

/** How much of a part is on the screen, as Maestro counts it: a part with one side of no length has no area, and its share is not a number. */
function visibleShare(part: Placed, size: { w: number; h: number }): number {
  if (part.w === 0 && part.h === 0) return 0;
  if (part.x <= 0 && part.y <= 0 && part.x + part.w >= size.w && part.y + part.h >= size.h) return 1;
  const across = Math.max(0, Math.min(part.x + part.w, size.w) - Math.max(part.x, 0));
  const down = Math.max(0, Math.min(part.y + part.h, size.h) - Math.max(part.y, 0));
  return (across * down) / (part.w * part.h);
}

/** A part is left out when under a tenth of it is on the screen and nothing under it stays. */
function kept(part: Placed, size: { w: number; h: number }): MaestroNode | null {
  const children = part.children.map((child) => kept(child, size)).filter((child): child is MaestroNode => child !== null);
  if (visibleShare(part, size) < 0.1 && children.length === 0) return null;
  return { ...part.node, children };
}

/** The tree `maestro hierarchy` would print for what the driver answered to `viewHierarchy`, on a screen of that size in points. */
export function treeOfDriver(answer: unknown, size: { w: number; h: number }): MaestroNode {
  const root = (answer as { axElement?: DriverElement }).axElement;
  if (!root || typeof root !== 'object') throw new Error("the driver's answer holds no screen (no axElement)");
  const whole = mapped(root);
  const unkept = (part: Placed): MaestroNode => ({ ...part.node, children: part.children.map(unkept) });
  // Maestro prints the tree as it came when nothing of it would be left.
  return kept(whole, size) ?? unkept(whole);
}
