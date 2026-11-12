import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { Terminal, type ITheme } from '@xterm/xterm';
import { RotateCw, Square } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Project, TerminalHandle } from '@studio-zero/protocol';
import { monoStack, usePrefs } from '../../lib/prefs.ts';
import { errorText, useStudio } from '../../lib/studio.tsx';
import { IconButton, Problem, Status } from '../../ui.tsx';

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

/** The sixteen colours a shell asks for, drawn from the theme's tokens so every preset stays legible. */
function terminalTheme(): ITheme {
  const fg = tokenColor('--color-fg');
  const muted = tokenColor('--color-fg-muted');
  const [red, green, yellow, blue] = [tokenColor('--color-danger'), tokenColor('--color-success'), tokenColor('--color-warning'), tokenColor('--color-accent')];
  return {
    background: tokenColor('--color-bg'),
    foreground: fg,
    cursor: fg,
    cursorAccent: tokenColor('--color-bg'),
    selectionBackground: tokenColor('--color-border'),
    black: tokenColor('--color-sunken'),
    red, green, yellow, blue,
    magenta: blue,
    cyan: green,
    white: fg,
    brightBlack: muted,
    brightRed: red, brightGreen: green, brightYellow: yellow, brightBlue: blue,
    brightMagenta: blue,
    brightCyan: green,
    brightWhite: fg,
  };
}

const QUICK: readonly { label: string; send: string }[] = [
  { label: 'pnpm dev', send: 'pnpm dev\r' },
  { label: 'pnpm test', send: 'pnpm test\r' },
  { label: 'git status', send: 'git status\r' },
  { label: 'clear', send: 'clear\r' },
];

type Phase = 'starting' | 'open' | 'ended' | 'failed';

/**
 * A real terminal: a login shell on a pseudo-terminal inside the project's sandbox. Keys go to the shell as
 * they are typed and its output is drawn as it arrives, so prompts, colours, tab completion, Ctrl+C and
 * full-screen programs behave as they do anywhere else. It runs where the agent's commands run, and nowhere
 * on this Mac.
 *
 * `visible` is false while another tab is in front: the terminal stays alive, and re-fits when it comes back.
 */
export function InteractiveTerminal({ project, visible }: { project: Project; visible: boolean }) {
  const { backend } = useStudio();
  const prefs = usePrefs();
  const host = useRef<HTMLDivElement>(null);
  const term = useRef<Terminal | null>(null);
  const fit = useRef<FitAddon | null>(null);
  const handle = useRef<TerminalHandle | null>(null);
  const [phase, setPhase] = useState<Phase>('starting');
  const [error, setError] = useState<string | null>(null);
  /** Bumped to open a fresh shell in the same terminal. */
  const [generation, setGeneration] = useState(0);

  // The terminal itself: created once, lives as long as this pane.
  useEffect(() => {
    if (!host.current) return;
    const terminal = new Terminal({
      cursorBlink: true,
      cursorStyle: 'bar',
      fontFamily: monoStack(prefs),
      fontSize: 14,
      lineHeight: 1.3,
      scrollback: 10_000,
      macOptionIsMeta: true,
      allowProposedApi: false,
      theme: terminalTheme(),
    });
    const fitter = new FitAddon();
    terminal.loadAddon(fitter);
    terminal.loadAddon(new WebLinksAddon((_event, uri) => void window.open(uri, '_blank', 'noopener,noreferrer')));
    terminal.open(host.current);
    terminal.onData((data) => handle.current?.write(data));
    terminal.onResize(({ cols, rows }) => void handle.current?.resize(cols, rows).catch(() => undefined));
    // Cmd+C copies a selection instead of interrupting; Cmd+V is left to the window, whose paste lands in the
    // terminal as typed text; Cmd+K clears. Every other Cmd shortcut belongs to the app, not to the shell.
    terminal.attachCustomKeyEventHandler((e) => {
      if (e.type !== 'keydown') return true;
      const key = e.key.toLowerCase();
      const chord = e.metaKey || (e.ctrlKey && e.shiftKey);
      if (!chord) return true;
      if (key === 'c' && terminal.hasSelection()) {
        void navigator.clipboard?.writeText(terminal.getSelection()).catch(() => undefined);
        return false;
      }
      if (key === 'v' && e.ctrlKey) {
        e.preventDefault();
        void navigator.clipboard?.readText().then((text) => terminal.paste(text)).catch(() => undefined);
        return false;
      }
      if (key === 'k' && e.metaKey) {
        terminal.clear();
        return false;
      }
      return !e.metaKey;
    });
    const observer = new ResizeObserver(() => {
      // A hidden pane has no size; fitting then would shrink the shell to a sliver.
      if (host.current && host.current.clientWidth > 0 && host.current.clientHeight > 0) fitter.fit();
    });
    observer.observe(host.current);
    term.current = terminal;
    fit.current = fitter;
    return () => {
      observer.disconnect();
      terminal.dispose();
      term.current = null;
      fit.current = null;
    };
    // Created once; preference changes are applied by the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The shell: one per generation, killed when the pane goes away.
  useEffect(() => {
    const terminal = term.current;
    if (!terminal) return;
    let disposed = false;
    setPhase('starting');
    setError(null);
    fit.current?.fit();
    void backend
      .openTerminal(
        { projectId: project.id, cols: terminal.cols, rows: terminal.rows },
        {
          onOutput: (data) => terminal.write(data),
          onExit: (exitCode, reason) => {
            handle.current = null;
            if (disposed) return;
            setPhase('ended');
            terminal.write(`\r\n\x1b[90m[${reason === 'disconnected' ? '데몬과의 연결이 끊겨 셸이 종료되었습니다' : exitCode === null ? '셸이 종료되었습니다' : `셸이 종료되었습니다 (종료 코드 ${exitCode})`}]\x1b[0m\r\n`);
          },
        },
      )
      .then(
        (opened) => {
          // The pane may have gone (or a newer shell been asked for) while this one was starting.
          if (disposed) return void opened.kill().catch(() => undefined);
          handle.current = opened;
          setPhase('open');
          void opened.resize(terminal.cols, terminal.rows).catch(() => undefined);
          terminal.focus();
        },
        (err: unknown) => {
          if (disposed) return;
          setPhase('failed');
          setError(errorText(err));
        },
      );
    return () => {
      disposed = true;
      void handle.current?.kill().catch(() => undefined);
      handle.current = null;
    };
  }, [backend, project.id, generation]);

  useEffect(() => {
    const terminal = term.current;
    if (!terminal) return;
    terminal.options.theme = terminalTheme();
    terminal.options.fontFamily = monoStack(prefs);
    fit.current?.fit();
  }, [prefs]);

  useEffect(() => {
    if (!visible) return;
    fit.current?.fit();
    term.current?.focus();
  }, [visible]);

  const restart = useCallback(() => {
    term.current?.reset();
    setGeneration((n) => n + 1);
  }, []);
  const send = (text: string): void => {
    handle.current?.write(text);
    term.current?.focus();
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border py-1 pl-2 pr-1">
        <div className="flex flex-wrap items-center gap-1" role="group" aria-label="자주 쓰는 명령">
          {QUICK.map((q) => (
            <button key={q.label} type="button" disabled={phase !== 'open'} onClick={() => send(q.send)} className="min-h-9 pointer-coarse:min-h-11 rounded-md border border-border px-3 font-mono text-sm text-fg hover:bg-sunken disabled:opacity-60">
              {q.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1">
          <Status tone={phase === 'open' ? 'good' : phase === 'failed' ? 'bad' : 'neutral'}>{phase === 'open' ? '샌드박스 셸' : phase === 'starting' ? '여는 중' : phase === 'failed' ? '열지 못함' : '종료됨'}</Status>
          <IconButton label="셸 끝내기" disabled={phase !== 'open'} onClick={() => void handle.current?.kill().catch(() => undefined)}>
            <Square className="size-4" aria-hidden />
          </IconButton>
          <IconButton label="새 셸로 다시 시작" onClick={restart}>
            <RotateCw className="size-4" aria-hidden />
          </IconButton>
        </div>
      </div>
      {error ? <Problem>{error}</Problem> : null}
      {/* The terminal sizes itself in whole character cells, which can overshoot the pane by a pixel or two: clip it here. */}
      <div className="min-h-0 min-w-0 flex-1 overflow-hidden bg-bg px-3 py-2">
        <div ref={host} className="h-full" role="application" aria-label={`${project.name} 샌드박스 터미널`} />
      </div>
    </div>
  );
}
