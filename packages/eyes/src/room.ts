/**
 * How much room the disk under a project has. Whoever plans a run asks once and the run judges each milestone by it
 * before anything is built: a disk that fills stops everything on the machine, not the run alone. (2026-11-21: a
 * build left 145 MB of 460 GB free an hour in; the machine's containers stopped, the owner's own seven among them.)
 */
import { statfsSync } from 'node:fs';

export interface Room {
  /** Whole gigabytes free, rounded down: what is asked is whether a thing fits. */
  freeGb: number;
  totalGb: number;
}

type Stat = (path: string) => { bavail: number | bigint; blocks: number | bigint; bsize: number | bigint };

export function diskRoom(dir: string, stat: Stat = statfsSync): Room {
  const s = stat(dir);
  const gb = (blocks: number | bigint): number => Math.floor((Number(blocks) * Number(s.bsize)) / 1024 ** 3);
  return { freeGb: gb(s.bavail), totalGb: gb(s.blocks) };
}

/** What a milestone has taken on the disk, measured on this harness's own runs: the run judges by the same figures (`plugin/workflows/build.js`). */
export const TAKES = { phone: 16, other: 3 } as const;

/** The number alone on the first line: whoever plans reads it there. */
export function roomText(room: Room): string {
  return `${room.freeGb}\n${room.freeGb} GB are free on the disk this folder is on (of ${room.totalGb}). A milestone that builds an app for a phone has taken about ${TAKES.phone} GB (what it builds, what it installs, its evidence), one that does not about ${TAKES.other}.`;
}
