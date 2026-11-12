import { readKit, type KitFile } from './kitSource.ts';

export { forBundlers } from './kitSource.ts';

/** Where the kit goes in a project, beside the theme. */
export const AX_DIR = '.studio-zero/ax';
export const AX_ENTRY = `${AX_DIR}/index.ts`;

/** Every file of the AX kit as it should be written into a project, with paths relative to `AX_DIR`. */
export function kitFiles(): Promise<KitFile[]> {
  return readKit('AX kit', [new URL('./ax-kit/', import.meta.url), new URL('../../../ax/src/', import.meta.url)]);
}
