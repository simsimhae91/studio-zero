import { useMemo } from 'react';

interface Node {
  id: string;
  label: string;
  rank: number;
  order: number;
}

const NODE = /^([A-Za-z0-9_]+)(?:\[\s*"?([^\]"]+)"?\s*\]|\(\(\s*([^)]+?)\s*\)\)|\(\s*"?([^)"]+)"?\s*\)|\{\s*"?([^}"]+)"?\s*\})?$/;
const EDGE = /\s*(?:-->|---|-\.->|==>)\s*(?:\|([^|]*)\|\s*)?/;

/** Parses the common subset of Mermaid flowcharts: nodes with labels joined by arrows. Anything else returns null. */
function parse(source: string): { horizontal: boolean; nodes: Node[]; edges: { from: string; to: string; label: string }[] } | null {
  const lines = source.split('\n').map((l) => l.trim()).filter((l) => l !== '' && !l.startsWith('%%'));
  const head = /^(?:flowchart|graph)\s+(TD|TB|LR|RL|BT)?/.exec(lines[0] ?? '');
  if (!head) return null;
  const nodes = new Map<string, Node>();
  const edges: { from: string; to: string; label: string }[] = [];
  const touch = (token: string): string | null => {
    const m = NODE.exec(token.trim());
    if (!m) return null;
    const label = m[2] ?? m[3] ?? m[4] ?? m[5];
    const existing = nodes.get(m[1]!);
    if (existing) {
      if (label) existing.label = label;
    } else nodes.set(m[1]!, { id: m[1]!, label: label ?? m[1]!, rank: 0, order: nodes.size });
    return m[1]!;
  };
  for (const line of lines.slice(1)) {
    if (/^(?:subgraph|end|style|classDef|class|click|linkStyle|direction)\b/.test(line)) return null;
    const parts = line.replace(/;$/, '').split(EDGE);
    // split() with a capture group yields: node, label|undefined, node, label|undefined, node …
    let previous = touch(parts[0]!);
    if (previous === null) return null;
    for (let i = 1; i < parts.length; i += 2) {
      const next = touch(parts[i + 1] ?? '');
      if (next === null) return null;
      edges.push({ from: previous, to: next, label: (parts[i] ?? '').trim() });
      previous = next;
    }
  }
  if (nodes.size === 0 || nodes.size > 24) return null;
  // Rank = longest path from a source; bounded so a cycle cannot loop forever.
  for (let pass = 0; pass < nodes.size; pass++) for (const e of edges) nodes.get(e.to)!.rank = Math.max(nodes.get(e.to)!.rank, Math.min(nodes.size, nodes.get(e.from)!.rank + 1));
  return { horizontal: head[1] === 'LR' || head[1] === 'RL', nodes: [...nodes.values()], edges };
}

const W = 176;
const H = 56;
const GAP_MAIN = 64;
const GAP_CROSS = 24;

/**
 * A flowchart drawn from Mermaid source, for the simple diagrams an agent sketches while thinking.
 * It needs no stylesheet of its own (theme utilities only), and it is deliberately a small renderer: diagram source is model output, and this turns it into
 * rectangles, lines and text and nothing else. Diagrams outside the supported subset are shown as source.
 */
export function Flow({ source, label = '흐름도' }: { source: string; label?: string }) {
  const graph = useMemo(() => parse(source), [source]);
  if (!graph) return <pre className="overflow-x-auto border border-border bg-sunken p-4 font-mono text-sm">{source}</pre>;

  const ranks = new Map<number, Node[]>();
  for (const node of graph.nodes) ranks.set(node.rank, [...(ranks.get(node.rank) ?? []), node]);
  const widest = Math.max(...[...ranks.values()].map((r) => r.length));
  const depth = Math.max(...ranks.keys()) + 1;
  // A long left-to-right chain would have to shrink until its labels are unreadable. Past three steps it is
  // drawn top to bottom instead, at full size, where a column always has room for it.
  const horizontal = graph.horizontal && depth <= 3;
  const gap = horizontal ? GAP_MAIN : 40;
  const pos = new Map<string, { x: number; y: number }>();
  for (const [rank, members] of ranks) {
    members.forEach((node, i) => {
      const cross = (i - (members.length - 1) / 2 + (widest - 1) / 2) * ((horizontal ? H : W) + GAP_CROSS);
      const main = rank * ((horizontal ? W : H) + gap);
      pos.set(node.id, horizontal ? { x: main, y: cross } : { x: cross, y: main });
    });
  }
  const width = horizontal ? depth * (W + gap) - gap : widest * (W + GAP_CROSS) - GAP_CROSS;
  const height = horizontal ? widest * (H + GAP_CROSS) - GAP_CROSS : depth * (H + gap) - gap;

  return (
    <div className="overflow-x-auto">
      <svg className="shrink-0" viewBox={`-8 -8 ${width + 16} ${height + 16}`} width={width + 16} role="img" aria-label={label}>
        <defs>
          <marker id="flow-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" className="fill-fg-muted" />
          </marker>
        </defs>
        {graph.edges.map((e, i) => {
          const a = pos.get(e.from)!;
          const b = pos.get(e.to)!;
          const [x1, y1, x2, y2] = horizontal ? [a.x + W, a.y + H / 2, b.x, b.y + H / 2] : [a.x + W / 2, a.y + H, b.x + W / 2, b.y];
          return (
            <g key={i}>
              <line x1={x1} y1={y1} x2={x2} y2={y2} className="stroke-fg-muted" strokeWidth="1.5" markerEnd="url(#flow-arrow)" />
              {e.label ? <text x={(x1 + x2) / 2} y={(y1 + y2) / 2 - 6} textAnchor="middle" className="fill-fg-muted text-xs">{e.label}</text> : null}
            </g>
          );
        })}
        {graph.nodes.map((node) => {
          const p = pos.get(node.id)!;
          return (
            <g key={node.id}>
              <rect x={p.x} y={p.y} width={W} height={H} className="fill-surface stroke-control-border" strokeWidth="1.5" />
              <text x={p.x + W / 2} y={p.y + H / 2} textAnchor="middle" dominantBaseline="central" className="fill-fg text-sm font-medium">
                {node.label.length > 14 ? `${node.label.slice(0, 13)}…` : node.label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
