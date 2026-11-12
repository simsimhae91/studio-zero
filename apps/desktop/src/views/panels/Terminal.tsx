import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import { useEffect, useRef } from 'react';
import type { EventEnvelope } from '@studio-zero/protocol';
import { clock, duration, evalLabel, phaseLabel } from '../../lib/format.ts';
import { useTaskEvents } from '../../lib/studio.tsx';
import { Empty } from '../../ui.tsx';

/** Resolves a theme token to the rgb() string the terminal renderer needs, by letting the browser paint it. */
function tokenColor(name: string): string {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  ctx.fillRect(0, 0, 1, 1);
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
  return `rgb(${r}, ${g}, ${b})`;
}

const DIM = '\x1b[90m';
const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

/** One event as terminal output. Sandbox output is written as text; escape sequences inside it are stripped first. */
function render(e: EventEnvelope): string | null {
  const b = e.body;
  const at = `${DIM}${clock(e.at)}${RESET} `;
  // Output from the sandbox is untrusted: drop anything that could drive the terminal (cursor moves, title changes, OSC links).
  const safe = (text: string): string => text.replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, '');
  switch (b.type) {
    case 'task.phase':
      return `\n${BOLD}${phaseLabel[b.phase]}${b.round > 1 ? ` ${b.round}회차` : ''}${RESET}`;
    case 'tool.call':
      return `${at}${BOLD}$${RESET} ${safe(b.tool === 'bash' ? b.input : `${b.tool} ${b.input}`)}`;
    case 'tool.result':
      return `${b.ok ? '' : RED}${safe(b.preview)}${RESET}\n${DIM}${b.ok ? '완료' : '실패'}${b.exitCode === null ? '' : `, 종료 코드 ${b.exitCode}`}, ${duration(b.durationMs)}${RESET}`;
    case 'eval.result':
      return `${at}${b.passed ? GREEN : RED}${evalLabel(b.name)} ${b.passed ? '통과' : '실패'}${RESET}${b.passed ? '' : `\n${safe(b.detail)}`}`;
    case 'audit.completed':
      return `${at}시각 감사 ${b.score.toFixed(0)}점, 블로커 ${b.blockers}건`;
    case 'agent.text':
      return `${at}${safe(b.text)}`;
    case 'policy.decision':
      return `${at}${RED}정책 ${b.effect} (${b.rule})${RESET} ${safe(b.reason)}`;
    case 'task.state':
      return b.state === 'running' ? null : `${at}${BOLD}작업 ${b.state}${RESET}${b.error ? ` ${safe(b.error)}` : ''}`;
    default:
      return null;
  }
}

/** The selected task's activity as a terminal log: commands, their output, and what the daemon checked. Read-only. */
export function TerminalPane({ taskId }: { taskId: string | null }) {
  const events = useTaskEvents(taskId);
  const host = useRef<HTMLDivElement>(null);
  const term = useRef<Terminal | null>(null);
  const written = useRef(0);

  useEffect(() => {
    if (!host.current) return;
    const terminal = new Terminal({
      convertEol: true,
      disableStdin: true,
      cursorStyle: 'bar',
      cursorInactiveStyle: 'none',
      fontFamily: '"Geist Mono", ui-monospace, monospace',
      fontSize: 14,
      lineHeight: 1.4,
      scrollback: 5000,
      theme: {
        background: tokenColor('--color-bg'),
        foreground: tokenColor('--color-fg'),
        cursor: tokenColor('--color-bg'),
        selectionBackground: tokenColor('--color-border'),
        red: tokenColor('--color-danger'),
        green: tokenColor('--color-success'),
        yellow: tokenColor('--color-warning'),
        brightBlack: tokenColor('--color-fg-muted'),
      },
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(host.current);
    fit.fit();
    const observer = new ResizeObserver(() => fit.fit());
    observer.observe(host.current);
    term.current = terminal;
    written.current = 0;
    return () => {
      observer.disconnect();
      terminal.dispose();
      term.current = null;
    };
  }, []);

  useEffect(() => {
    const terminal = term.current;
    if (!terminal) return;
    if (events.length < written.current) {
      terminal.reset(); // a different task was selected
      written.current = 0;
    }
    for (const e of events.slice(written.current)) {
      const line = render(e);
      if (line !== null) terminal.writeln(line);
    }
    written.current = events.length;
  }, [events]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {taskId === null ? (
        <Empty title="선택된 작업이 없습니다">
          <p>작업을 시작하면 샌드박스에서 실행된 명령과 출력이 여기에 흐릅니다.</p>
        </Empty>
      ) : null}
      {/* The terminal sizes itself in whole character cells, which can overshoot the pane by a pixel or two: clip it here. */}
      <div className={`min-h-0 min-w-0 flex-1 overflow-hidden px-4 py-3 ${taskId === null ? 'hidden' : ''}`}>
        <div ref={host} className="h-full" role="log" aria-label="작업 터미널 출력" />
      </div>
    </div>
  );
}
