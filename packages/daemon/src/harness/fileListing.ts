/**
 * A project's files as a planner is shown them: every path while they fit in `limit` lines, and beyond that the
 * deepest folders folded into one line each with a count, a level at a time, until they do.
 *
 * The listing used to be the first four hundred paths in name order. On the studio's own repository that ended
 * part-way through `packages/daemon/test`, and the plan for its first task was written without knowing that
 * `packages/design`, `packages/protocol` or anything at the root existed. What is nearest the root is what tells
 * a reader how a project is laid out, so that is what is kept.
 */
export function foldListing(paths: readonly string[], limit = 600): string[] {
  let lines = new Map<string, { files: number; folder: boolean }>(paths.filter((path) => path !== '').map((path) => [path, { files: 1, folder: false }]));
  const deepest = Math.max(1, ...[...lines.keys()].map((path) => path.split('/').length));
  // `keep` is how many path segments survive a pass: whatever lies deeper goes into the folder at that depth.
  for (let keep = deepest - 1; lines.size > limit && keep >= 1; keep--) {
    const folded = new Map<string, { files: number; folder: boolean }>();
    for (const [line, entry] of lines) {
      const parts = line.split('/');
      if (parts.length <= keep) {
        folded.set(line, entry);
        continue;
      }
      const folder = parts.slice(0, keep).join('/');
      folded.set(folder, { files: (folded.get(folder)?.files ?? 0) + entry.files, folder: true });
    }
    lines = folded;
  }
  return [...lines].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([line, entry]) => (entry.folder ? `${line}/ (${entry.files} files)` : line));
}
