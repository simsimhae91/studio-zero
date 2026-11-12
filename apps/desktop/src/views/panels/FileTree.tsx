import { Check, ChevronRight, Copy, File, FileCode, FileJson, FileText, Folder, FolderOpen, Image, Palette, Pencil, RefreshCw, Save, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { FileEntry, Project } from '@studio-zero/protocol';
import type { CodeNode } from '../../lib/highlight.ts';
import { errorText, useAction, useQuery, useStudio } from '../../lib/studio.tsx';
import { Button, Empty, IconButton, Problem } from '../../ui.tsx';

const ROOT = '.';
/** Above this many characters a file is shown without colour: highlighting it would stall the window. */
const HIGHLIGHT_LIMIT = 200_000;

function iconFor(entry: FileEntry, open: boolean): ReactNode {
  if (entry.type === 'directory') return open ? <FolderOpen className="size-4 shrink-0 text-accent" aria-hidden /> : <Folder className="size-4 shrink-0 text-accent" aria-hidden />;
  const extension = entry.name.includes('.') ? entry.name.slice(entry.name.lastIndexOf('.') + 1).toLowerCase() : '';
  const Icon = ['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'mts', 'html', 'vue', 'py', 'rs', 'go', 'sh'].includes(extension)
    ? FileCode
    : ['json', 'jsonc', 'yaml', 'yml', 'toml'].includes(extension)
      ? FileJson
      : ['css', 'scss', 'less'].includes(extension)
        ? Palette
        : ['md', 'mdx', 'txt'].includes(extension)
          ? FileText
          : ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico'].includes(extension)
            ? Image
            : File;
  return <Icon className="size-4 shrink-0 text-fg-muted" aria-hidden />;
}

function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * The project's workspace as files: a tree that opens one directory at a time, and a viewer beside it.
 * The listing comes from inside the sandbox and follows .gitignore, so this is the project as the repository
 * sees it, without node_modules or build output. `openPath` lets another part of the page point at a file.
 */
export function FileTree({ project, openPath = null }: { project: Project; openPath?: string | null }) {
  const { backend, onEvent } = useStudio();
  const [dirs, setDirs] = useState<Record<string, FileEntry[]>>({});
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [selected, setSelected] = useState<string | null>(openPath);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const loaded = useRef<Set<string>>(new Set([ROOT]));

  const load = useCallback(
    async (path: string): Promise<void> => {
      try {
        const { entries } = await backend.call('files.list', { projectId: project.id, ...(path === ROOT ? {} : { path }) });
        setDirs((prev) => ({ ...prev, [path]: entries }));
        setError(null);
      } catch (err) {
        // A directory that has since been removed just drops out of the tree; the root failing is worth saying.
        if (path === ROOT) setError(errorText(err));
        else setDirs(({ [path]: _gone, ...rest }) => rest);
      }
    },
    [backend, project.id],
  );
  const reload = useCallback(async (): Promise<void> => {
    setLoading(true);
    await Promise.all([...loaded.current].map(load));
    setLoading(false);
  }, [load]);

  useEffect(() => void reload(), [reload]);
  // The agent changes files while this pane is open. A checkpoint is taken after every turn that wrote something.
  useEffect(() => {
    let scheduled = false;
    return onEvent((e) => {
      if (e.projectId !== project.id || scheduled || (e.body.type !== 'checkpoint.created' && e.body.type !== 'checkpoint.restored' && e.body.type !== 'git.merged')) return;
      scheduled = true;
      setTimeout(() => {
        scheduled = false;
        void reload();
      }, 300);
    });
  }, [onEvent, project.id, reload]);
  useEffect(() => {
    if (openPath) setSelected(openPath);
  }, [openPath]);

  const toggle = (path: string): void => {
    const next = new Set(expanded);
    if (next.has(path)) next.delete(path);
    else {
      next.add(path);
      loaded.current.add(path);
      if (!dirs[path]) void load(path);
    }
    setExpanded(next);
  };

  const rows = (parent: string, depth: number): ReactNode =>
    (dirs[parent] ?? []).map((entry) => {
      const open = expanded.has(entry.path);
      const current = selected === entry.path;
      return (
        <li key={entry.path} role="none">
          <button
            type="button"
            role="treeitem"
            aria-expanded={entry.type === 'directory' ? open : undefined}
            aria-selected={current}
            onClick={() => (entry.type === 'directory' ? toggle(entry.path) : setSelected(entry.path))}
            style={{ paddingInlineStart: 8 + depth * 16 }}
            className={`flex min-h-8 pointer-coarse:min-h-11 w-full items-center gap-2 rounded-sm pr-2 text-left text-sm ${current ? 'bg-sunken font-medium text-fg' : 'text-fg hover:bg-sunken'}`}
          >
            {entry.type === 'directory' ? <ChevronRight className={`size-4 shrink-0 text-fg-muted ${open ? 'rotate-90' : ''}`} aria-hidden /> : <span className="size-4 shrink-0" aria-hidden />}
            {iconFor(entry, open)}
            <span className="min-w-0 break-all">{entry.name}</span>
          </button>
          {entry.type === 'directory' && open ? (
            <ul role="group" className="flex flex-col">
              {rows(entry.path, depth + 1)}
            </ul>
          ) : null}
        </li>
      );
    });

  const root = dirs[ROOT];
  return (
    <div className="flex min-h-0 flex-1 flex-col md:flex-row">
      <div className={`flex min-h-0 flex-col border-border md:w-64 md:flex-none md:border-r ${selected ? 'max-h-48 border-b md:max-h-none md:border-b-0' : 'flex-1'}`}>
        <div className="flex items-center justify-between gap-2 border-b border-border py-1 pl-4 pr-1">
          <span className="text-sm font-medium text-fg-muted">/workspace</span>
          <IconButton label="파일 목록 새로 고침" onClick={() => void reload()}>
            <RefreshCw className={`size-4 ${loading ? 'animate-spin' : ''}`} aria-hidden />
          </IconButton>
        </div>
        <div className="pane-scroll min-h-0 flex-1 p-1">
          {error ? <Problem>{error}</Problem> : null}
          {root && root.length === 0 ? <p className="p-3 text-sm text-fg-muted">워크스페이스가 비어 있습니다. 첫 작업이 파일을 만들면 여기에 나타납니다.</p> : null}
          <ul role="tree" aria-label={`${project.name} 파일`} className="flex flex-col">
            {rows(ROOT, 0)}
          </ul>
        </div>
      </div>
      {selected ? (
        <FileViewer key={selected} project={project} path={selected} onClose={() => setSelected(null)} />
      ) : (
        <div className="hidden min-h-0 flex-1 md:flex">
          <Empty title="파일을 고르면 여기에서 열립니다">
            <p>에이전트가 샌드박스에 쓴 코드를 그대로 읽고, 필요하면 직접 고칠 수 있습니다.</p>
          </Empty>
        </div>
      )}
    </div>
  );
}

function render(nodes: readonly CodeNode[]): ReactNode {
  return nodes.map((node, i) =>
    node.type === 'text' ? (
      node.value
    ) : (
      <span key={i} className={node.classes.join(' ')}>
        {render(node.children)}
      </span>
    ),
  );
}

/** One file: read-only with line numbers and colour, or as a plain text field when the owner chooses to edit it. */
function FileViewer({ project, path, onClose }: { project: Project; path: string; onClose: () => void }) {
  const { backend } = useStudio();
  const file = useQuery('files.read', { projectId: project.id, path }, ['checkpoint.created', 'checkpoint.restored']);
  const [draft, setDraft] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [colored, setColored] = useState<{ content: string; nodes: CodeNode[] } | null>(null);
  const content = file.data?.content ?? '';
  const save = useAction(async () => {
    await backend.call('files.write', { projectId: project.id, path, content: draft ?? '' });
    setDraft(null);
    file.reload();
  });

  // The highlighter is a large module with every grammar in it: fetched the first time a file is opened.
  useEffect(() => {
    if (!file.data || file.data.binary || content.length > HIGHLIGHT_LIMIT) return;
    let stale = false;
    void import('../../lib/highlight.ts').then(({ highlight }) => {
      const nodes = highlight(path, content);
      if (!stale && nodes) setColored({ content, nodes });
    });
    return () => {
      stale = true;
    };
  }, [file.data, content, path]);

  const lineCount = useMemo(() => (content === '' ? 1 : content.split('\n').length - (content.endsWith('\n') ? 1 : 0)), [content]);
  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // No clipboard permission: the text can still be selected and copied by hand.
    }
  };
  const editable = file.data !== undefined && !file.data.binary && !file.data.truncated;

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center justify-between gap-x-4 border-b border-border py-1 pl-4 pr-1">
        <div className="flex min-w-0 flex-col py-1">
          <span className="break-all font-mono text-sm font-medium">{path}</span>
          {file.data ? (
            <span className="text-xs text-fg-muted">
              {bytes(file.data.size)}
              {file.data.binary ? '' : `, ${lineCount}줄`}
              {file.data.truncated ? ', 앞부분만 표시' : ''}
            </span>
          ) : null}
        </div>
        <div className="flex items-center">
          {draft === null ? (
            <>
              <IconButton label={copied ? '복사됨' : '내용 복사'} disabled={!file.data || file.data.binary} onClick={() => void copy()}>
                {copied ? <Check className="size-4 text-success" aria-hidden /> : <Copy className="size-4" aria-hidden />}
              </IconButton>
              <IconButton label="편집" disabled={!editable} onClick={() => setDraft(content)}>
                <Pencil className="size-4" aria-hidden />
              </IconButton>
            </>
          ) : (
            <>
              <Button variant="primary" busy={save.busy} disabled={draft === content} onClick={() => void save.run()} icon={<Save className="size-4" aria-hidden />}>
                저장
              </Button>
              <Button disabled={save.busy} onClick={() => setDraft(null)}>
                취소
              </Button>
            </>
          )}
          <IconButton label="파일 닫기" onClick={onClose}>
            <X className="size-4" aria-hidden />
          </IconButton>
        </div>
      </div>
      {file.error ? <Problem>{file.error}</Problem> : null}
      {save.error ? <Problem>{save.error}</Problem> : null}
      {file.data?.binary ? (
        <Empty title="텍스트 파일이 아닙니다">
          <p>이미지나 바이너리 파일은 여기에서 열지 않습니다. 터미널에서 확인할 수 있습니다.</p>
        </Empty>
      ) : draft !== null ? (
        <textarea aria-label={`${path} 편집`} value={draft} onChange={(e) => setDraft(e.target.value)} spellCheck={false} autoCapitalize="none" className="code-view min-h-0 flex-1 resize-none bg-bg p-4 text-fg focus-visible:outline-hidden" />
      ) : file.data ? (
        <div className="pane-scroll min-h-0 flex-1 overflow-x-auto bg-bg">
          <div className="code-view flex min-w-max">
            {/* The gutter is a column of its own, so selecting code never picks up line numbers. */}
            <pre aria-hidden className="sticky left-0 select-none border-r border-border bg-bg px-3 py-4 text-right text-fg-muted">
              {Array.from({ length: lineCount }, (_, i) => i + 1).join('\n')}
            </pre>
            <pre className="px-4 py-4 text-fg">
              <code>{colored && colored.content === content ? render(colored.nodes) : content}</code>
            </pre>
          </div>
        </div>
      ) : null}
    </div>
  );
}
