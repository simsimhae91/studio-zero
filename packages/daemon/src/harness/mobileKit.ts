import { readKit, type KitFile } from './kitSource.ts';

/** Where the mobile kit goes in a mobile project, beside the theme and the AX kit. */
export const MOBILE_KIT_DIR = '.studio-zero/mobile-kit';
export const MOBILE_KIT_ENTRY = `${MOBILE_KIT_DIR}/index.ts`;

/**
 * Every file of the mobile kit (`@studio-zero/mobile-kit`: the tokens and the React Native parts in
 * `packages/design/src/mobile`) as it should be written into a project, with paths relative to `MOBILE_KIT_DIR`.
 */
export function mobileKitFiles(): Promise<KitFile[]> {
  return readKit('mobile kit', [new URL('./mobile-kit/', import.meta.url), new URL('../../../design/src/mobile/', import.meta.url)]);
}
