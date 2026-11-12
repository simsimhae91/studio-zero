import { Fragment, type ReactNode } from 'react';
import { Flow } from './Flow.tsx';

/**
 * Markdown as React elements. Agent and research output is rendered through this and never through innerHTML:
 * whatever the text contains, it can only become the elements listed here. Raw HTML in the source stays text.
 */

function inline(text: string, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  // Bold, inline code, links to http(s), and [n] citation markers. Everything else is literal.
  const pattern = /\*\*([^*]+)\*\*|`([^`]+)`|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|\[(\d{1,3})\]/g;
  let last = 0;
  let i = 0;
  for (let m = pattern.exec(text); m; m = pattern.exec(text)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const k = `${key}-${i++}`;
    if (m[1] !== undefined) out.push(<strong key={k} className="font-semibold">{m[1]}</strong>);
    else if (m[2] !== undefined) out.push(<code key={k} className="font-mono text-base">{m[2]}</code>);
    else if (m[3] !== undefined) out.push(<a key={k} href={m[4]} target="_blank" rel="noreferrer" className="text-accent underline underline-offset-4">{m[3]}</a>);
    else out.push(<sup key={k} className="font-medium text-accent">{m[5]}</sup>);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const cells = (row: string): string[] => row.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());

export function Markdown({ source }: { source: string }) {
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  const out: ReactNode[] = [];
  let i = 0;
  const key = (): string => `b${out.length}`;

  while (i < lines.length) {
    const line = lines[i]!;
    if (line.trim() === '') {
      i += 1;
      continue;
    }
    const fence = /^\s*```\s*([\w-]*)/.exec(line);
    if (fence) {
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !/^\s*```/.test(lines[i]!)) body.push(lines[i++]!);
      i += 1;
      out.push(fence[1] === 'mermaid' ? <Flow key={key()} source={body.join('\n')} /> : <pre key={key()} className="overflow-x-auto border border-border bg-sunken p-4 font-mono text-sm">{body.join('\n')}</pre>);
      continue;
    }
    const heading = /^(#{1,4})\s+(.+?)\s*#*$/.exec(line);
    if (heading) {
      const level = heading[1]!.length;
      const cls = level === 1 ? 'text-3xl font-semibold' : level === 2 ? 'mt-4 border-t border-border pt-4 text-2xl font-semibold' : 'mt-2 text-xl font-semibold';
      out.push(level === 1 ? <h3 key={key()} className={cls}>{inline(heading[2]!, key())}</h3> : level === 2 ? <h4 key={key()} className={cls}>{inline(heading[2]!, key())}</h4> : <h5 key={key()} className={cls}>{inline(heading[2]!, key())}</h5>);
      i += 1;
      continue;
    }
    if (/^\s*\|/.test(line) && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1] ?? '')) {
      const head = cells(line);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && /^\s*\|/.test(lines[i]!)) rows.push(cells(lines[i++]!));
      const k = key();
      out.push(
        <div key={k} className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-base">
            <thead>
              <tr>{head.map((c, n) => <th key={n} scope="col" className="border-b-2 border-fg px-3 py-2 font-semibold">{inline(c, `${k}h${n}`)}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((r, y) => (
                <tr key={y}>{r.map((c, n) => <td key={n} className="border-b border-border px-3 py-2 align-top">{inline(c, `${k}r${y}c${n}`)}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }
    const item = /^\s*(?:([-*+])|(\d+)\.)\s+(.*)$/.exec(line);
    if (item) {
      const ordered = item[2] !== undefined;
      const items: string[] = [];
      while (i < lines.length) {
        const next = /^\s*(?:[-*+]|\d+\.)\s+(.*)$/.exec(lines[i]!);
        if (!next) break;
        items.push(next[1]!);
        i += 1;
      }
      const k = key();
      const children = items.map((t, n) => <li key={n}>{inline(t, `${k}i${n}`)}</li>);
      out.push(ordered ? <ol key={k} className="flex list-decimal flex-col gap-1 pl-6">{children}</ol> : <ul key={k} className="flex list-disc flex-col gap-1 pl-6">{children}</ul>);
      continue;
    }
    if (/^\s*>/.test(line)) {
      const quote: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i]!)) quote.push(lines[i++]!.replace(/^\s*>\s?/, ''));
      out.push(<blockquote key={key()} className="border-l-4 border-accent pl-4 text-fg-muted">{inline(quote.join(' '), key())}</blockquote>);
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i]!.trim() !== '' && !/^\s*(?:#{1,4}\s|```|[-*+]\s|\d+\.\s|>|\|)/.test(lines[i]!)) para.push(lines[i++]!);
    if (para.length === 0) para.push(lines[i++]!); // a line that looked structural but was not
    out.push(<p key={key()}>{inline(para.join(' '), key())}</p>);
  }
  return <div className="flex flex-col gap-4 text-lg">{out.map((node, n) => <Fragment key={n}>{node}</Fragment>)}</div>;
}
