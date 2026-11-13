import { KeyRound, Unplug } from 'lucide-react';
import { useMemo, useState, type FormEvent } from 'react';
import type { McpServerInfo } from '@studio-zero/protocol';
import { engineLabel, slugify } from '../lib/format.ts';
import { forgetToken } from '../lib/platform.ts';
import { MONO_FONTS, THEME_PRESETS, fontInstalled, setPrefs, usePrefs } from '../lib/prefs.ts';
import { EffortDefaults } from './enginePicker.tsx';
import { useAction, useQuery, useStudio } from '../lib/studio.tsx';
import { Button, ConfirmButton, Field, inputClass, Problem, Segmented, Sheet, Status } from '../ui.tsx';

const BASE_CREDENTIALS: readonly { id: string; label: string }[] = [
  { id: 'provider/anthropic/api-key', label: 'Anthropic API 키' },
  { id: 'provider/openai/api-key', label: 'OpenAI API 키' },
  { id: 'relay/telegram/bot-token', label: 'Telegram 봇 토큰' },
  { id: 'relay/slack/app-token', label: 'Slack 앱 토큰 (xapp-)' },
  { id: 'relay/slack/bot-token', label: 'Slack 봇 토큰 (xoxb-)' },
  { id: 'relay/ntfy/token', label: 'ntfy 액세스 토큰' },
];
const serverState = { ready: '사용 가능', 'needs-token': '토큰 필요', unsupported: 'OAuth 로그인 필요 (아직 지원 안 함)' } as const;
const confidenceLabel = { high: '확실', medium: '의견이 갈릴 수 있음', speculative: '추정' } as const;
const relayLabel = { telegram: 'Telegram', slack: 'Slack', ntfy: 'ntfy' } as const;
const subscriptionLabel: Record<string, string> = { ...engineLabel, 'claude-code': 'Claude Code 구독', codex: 'Codex 구독', cursor: 'Cursor 구독', antigravity: 'Antigravity 구독' };

export function Settings({ open, onOpenChange, onDisconnect }: { open: boolean; onOpenChange: (open: boolean) => void; onDisconnect: () => void }) {
  const { backend } = useStudio();
  const status = useQuery('system.status', open ? {} : null);
  const vault = useQuery('vault.list', open ? {} : null);
  const servers = useQuery('mcp.list', open ? {} : null, ['approval.resolved']);
  const calibration = useQuery('ax.calibration', open ? {} : null);
  // A tool server that signs in with a token gets an entry in the credential list below.
  const CREDENTIALS = [...BASE_CREDENTIALS, ...(servers.data?.servers ?? []).filter((m) => m.auth === 'bearer').map((m) => ({ id: m.credentialId, label: `${m.name} 토큰` }))];
  const [credential, setCredential] = useState<string>(BASE_CREDENTIALS[0]!.id);
  const [secret, setSecret] = useState('');
  const [saved, setSaved] = useState<string | null>(null);
  const save = useAction(async () => {
    await backend.call('vault.set', { id: credential, secret });
    setSaved(credential);
    setSecret('');
    vault.reload();
    status.reload();
    servers.reload();
  });
  const remove = useAction(async (id: string) => {
    await backend.call('vault.delete', { id });
    vault.reload();
    status.reload();
    servers.reload();
  });
  const submit = (e: FormEvent): void => {
    e.preventDefault();
    void save.run();
  };
  const stored = new Set((vault.data?.credentials ?? []).map((c) => c.id));
  const s = status.data;

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="설정">
      <div className="flex flex-col gap-10 p-6">
      <Appearance />

      <section className="flex flex-col gap-3">
        <h3 className="text-lg font-semibold">데몬</h3>
        {status.error ? <Problem>{status.error}</Problem> : null}
        {s ? (
          <dl className="flex flex-col">
            <Row term="주소">{backend.host}</Row>
            <Row term="버전">{s.version}</Row>
            <Row term="컨테이너 런타임">{s.runtime.reachable ? `${s.runtime.context}, ${s.runtime.detail}` : `${s.runtime.context}에 닿지 않습니다. ${s.runtime.detail}`}</Row>
            {s.relays.map((relay) => (
              <Row key={relay.id} term={relayLabel[relay.id]}>
                {relay.state === 'connected' ? '수신 중' : relay.state === 'degraded' ? '연결 불안정' : '꺼짐'}
              </Row>
            ))}
            <Row term="작업">
              진행 {s.queue.running}건, 대기 {s.queue.queued}건
            </Row>
          </dl>
        ) : null}
        <Button
          className="self-start"
          onClick={() => {
            void forgetToken(backend.host);
            onDisconnect();
          }}
          icon={<Unplug className="size-4" aria-hidden />}
        >
          연결 끊기
        </Button>
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h3 className="text-lg font-semibold">엔진</h3>
          <p className="text-base text-fg-muted">
            작업 종류마다 정해진 순서로, 쓸 수 있는 첫 엔진이 맡습니다. 작업을 시작할 때 직접 고를 수도 있습니다. 계획, 검증, 작업 노트 같은 스튜디오 자체의 생각은{' '}
            {s?.brain === 'api' ? '저장된 Anthropic API 키로 합니다.' : s?.brain === 'session' ? 'Claude 구독(Claude Code 로그인)으로 합니다. API 키는 필요 없습니다.' : '지금 할 방법이 없습니다. Claude Code에 로그인하거나 API 키를 저장해 주세요.'}
          </p>
        </div>
        <ul className="flex flex-col">
          {(s?.engines ?? []).map((engine) => (
            <li key={engine.id} className="flex flex-col gap-1 border-t border-border py-3">
              <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1">
                <span className="text-base font-medium">{subscriptionLabel[engine.id] ?? engine.id}</span>
                <Status tone={engine.available ? 'good' : 'neutral'}>{engine.available ? '사용 가능' : '사용 안 함'}</Status>
              </div>
              <span className="break-words text-base text-fg-muted">{engine.reason}</span>
            </li>
          ))}
        </ul>
        <div className="flex flex-col gap-1 pt-3">
          <h4 className="text-base font-semibold">추론 강도 기본값</h4>
          <p className="text-base text-fg-muted">엔진을 직접 골랐을 때 얼마나 깊이 생각하게 할지입니다. 설계와 구현은 따로 기억합니다. 작업을 시작하는 자리의 메뉴와 같은 값이고, 어느 쪽에서 바꿔도 됩니다.</p>
        </div>
        <EffortDefaults />
      </section>

      <section className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h3 className="text-lg font-semibold">외부 도구</h3>
          <p className="text-base text-fg-muted">작업 중 GitHub나 Stripe 같은 서비스, 또는 이 Mac의 Blender, Unity, Aseprite 같은 도구가 필요해지면 에이전트가 여기 등록된 MCP 서버에서 도구를 찾습니다. 호출은 데몬이 대신 하고, 도구마다 프로젝트에서 처음 쓸 때 한 번 승인을 받습니다.</p>
        </div>
        {servers.error ? <Problem>{servers.error}</Problem> : null}
        <ul className="flex flex-col">
          {(servers.data?.servers ?? []).map((server) => (
            <ToolServer key={server.id} server={server} onToken={() => setCredential(server.credentialId)} onChanged={servers.reload} />
          ))}
        </ul>
        <AddToolServer onAdded={servers.reload} />
      </section>

      {calibration.data ? (
        <section className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <h3 className="text-lg font-semibold">확신도 보정</h3>
            <p className="text-base text-fg-muted">
              스튜디오가 추천한 것과 실제로 고르신 것을 비교한 기록입니다. {calibration.data.highDemoted ? '최근 "확실"이라던 추천을 자주 뒤집으셔서, 지금은 "확실"한 결정도 먼저 여쭙니다.' : '"확실"한 추천이 자주 뒤집히면 그 수준의 결정도 먼저 여쭙게 됩니다.'}
            </p>
          </div>
          <dl className="flex flex-col">
            {(['high', 'medium', 'speculative'] as const).map((level) => {
              const stat = calibration.data!.levels[level] ?? { total: 0, overridden: 0 };
              return (
                <Row key={level} term={confidenceLabel[level]}>
                  {stat.total === 0 ? '기록 없음' : `${stat.total}번 중 ${stat.overridden}번 다르게 선택`}
                </Row>
              );
            })}
          </dl>
        </section>
      ) : null}

      <section className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h3 className="text-lg font-semibold">자격 증명</h3>
          <p className="text-base text-fg-muted">데몬이 실행 중인 Mac의 키체인에 저장됩니다. 저장한 값은 이 화면을 포함해 어디에도 다시 표시되지 않고, 샌드박스에는 들어가지 않습니다.</p>
        </div>
        {vault.error ? <Problem>{vault.error}</Problem> : null}
        <ul className="flex flex-col">
          {CREDENTIALS.filter((c) => stored.has(c.id)).map((c) => (
            <li key={c.id} className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-t border-border py-2">
              <span className="text-base">{c.label}</span>
              {/* A stored value cannot be read back, so a stray press here would lose it for good. */}
              <ConfirmButton label="삭제" confirm={`${c.label} 삭제 확인`} busy={remove.busy} onConfirm={() => void remove.run(c.id)} />
            </li>
          ))}
        </ul>
        {remove.error ? <Problem>{remove.error}</Problem> : null}
        <form onSubmit={submit} className="flex flex-col gap-4">
          <div role="radiogroup" aria-label="자격 증명 종류" className="flex flex-col border-b border-border">
            {CREDENTIALS.map((c) => (
              <button key={c.id} type="button" role="radio" aria-checked={credential === c.id} onClick={() => setCredential(c.id)} className={`flex min-h-11 items-center justify-between gap-4 border-l-4 border-t border-t-border px-4 text-left text-base ${credential === c.id ? 'border-l-accent bg-sunken font-medium' : 'border-l-transparent'}`}>
                {c.label}
                {stored.has(c.id) ? <span className="text-sm text-fg-muted">저장됨, 바꾸기</span> : null}
              </button>
            ))}
          </div>
          <Field label="값">
            <input className={inputClass} type="password" value={secret} onChange={(e) => setSecret(e.target.value)} autoComplete="off" required />
          </Field>
          {save.error ? <Problem>{save.error}</Problem> : null}
          {saved !== null && secret === '' && !save.busy ? <Status tone="good">{CREDENTIALS.find((c) => c.id === saved)?.label ?? '값'}을(를) 키체인에 저장했습니다</Status> : null}
          <Button type="submit" variant="primary" busy={save.busy} className="self-start" icon={<KeyRound className="size-4" aria-hidden />}>
            키체인에 저장
          </Button>
        </form>
      </section>
      </div>
    </Sheet>
  );
}

/** How the studio looks on this device: the theme, and the face code is set in. Kept in this window's storage, not on the daemon. */
function Appearance() {
  const prefs = usePrefs();
  // Faces that do not ship with the app are only there if this machine has them.
  const missing = useMemo(() => new Set(MONO_FONTS.filter((f) => !f.bundled && !fontInstalled(f.probe)).map((f) => f.id)), []);
  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h3 className="text-lg font-semibold">화면</h3>
        <p className="text-base text-fg-muted">테마와 코드 서체는 이 기기에만 저장됩니다. 어느 테마든 글자와 배경의 대비는 같은 기준으로 맞춰져 있습니다.</p>
      </div>
      <div role="radiogroup" aria-label="테마" className="flex flex-col border-b border-border">
        {THEME_PRESETS.map((preset) => (
          <button key={preset.id} type="button" role="radio" aria-checked={prefs.theme === preset.id} onClick={() => setPrefs({ theme: preset.id })} className={`flex min-h-11 items-center justify-between gap-4 border-l-4 border-t border-t-border px-4 py-2 text-left ${prefs.theme === preset.id ? 'border-l-accent bg-sunken' : 'border-l-transparent'}`}>
            <span className="flex flex-col">
              <span className="text-base font-medium">{preset.label}</span>
              <span className="text-sm text-fg-muted">{preset.note}</span>
            </span>
            {preset.id === 'system' ? null : (
              <span className={`preset-${preset.id} flex shrink-0 overflow-hidden rounded-md border border-border`} aria-hidden>
                <span className="size-6 bg-bg" />
                <span className="size-6 bg-surface" />
                <span className="size-6 bg-fg" />
                <span className="size-6 bg-accent" />
              </span>
            )}
          </button>
        ))}
      </div>
      <div role="radiogroup" aria-label="코드 서체" className="flex flex-col border-b border-border">
        {MONO_FONTS.map((font) => (
          <button key={font.id} type="button" role="radio" aria-checked={prefs.mono === font.id} onClick={() => setPrefs({ mono: font.id })} className={`flex min-h-11 flex-wrap items-center justify-between gap-x-4 border-l-4 border-t border-t-border px-4 py-2 text-left ${prefs.mono === font.id ? 'border-l-accent bg-sunken' : 'border-l-transparent'}`}>
            <span className="text-base font-medium">{font.label}</span>
            <span className="text-sm text-fg-muted">{missing.has(font.id) ? '이 기기에 설치되어 있지 않아 Geist Mono로 표시됩니다' : font.bundled ? '앱에 포함' : '이 기기에 설치됨'}</span>
          </button>
        ))}
      </div>
      {/* Set in the chosen face: what the file viewer and the terminal will look like. */}
      <pre className="overflow-x-auto rounded-md border border-border bg-sunken p-4 font-mono text-sm">{'const total = items.reduce((sum, item) => sum + item.price, 0);\n// 0O 1lI |!  =>  !==  가나다라 한글 정렬'}</pre>
    </section>
  );
}

function ToolServer({ server, onToken, onChanged }: { server: McpServerInfo; onToken: () => void; onChanged: () => void }) {
  const { backend } = useStudio();
  const remove = useAction(async () => {
    await backend.call('mcp.remove', { serverId: server.id });
    onChanged();
  });
  const revoke = useAction(async (projectId: string) => {
    await backend.call('mcp.revoke', { serverId: server.id, projectId });
    onChanged();
  });
  const projects = [...new Set(server.grants.map((g) => g.projectId))];
  return (
    <li className="flex flex-col gap-2 border-t border-border py-3">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1">
        <span className="text-base font-medium">{server.name}</span>
        <Status tone={server.state === 'ready' ? 'good' : server.state === 'needs-token' ? 'warn' : 'neutral'}>{serverState[server.state]}</Status>
      </div>
      <span className="break-all text-sm text-fg-muted">{server.transport === 'stdio' ? `이 Mac에서 실행: ${[server.command, ...server.args].join(' ')}` : server.url}</span>
      {projects.map((projectId) => (
        <div key={projectId} className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
          <span className="break-words text-base">
            {projectId}에서 허용: {server.grants.filter((g) => g.projectId === projectId).map((g) => g.tool).join(', ')}
          </span>
          <Button disabled={revoke.busy} onClick={() => void revoke.run(projectId)}>
            허용 취소
          </Button>
        </div>
      ))}
      {remove.error ?? revoke.error ? <Problem>{remove.error ?? revoke.error}</Problem> : null}
      <div className="flex flex-wrap gap-2">
        {server.state === 'needs-token' ? <Button onClick={onToken}>아래에서 토큰 저장</Button> : null}
        {server.builtin ? null : (
          <ConfirmButton label="서버 삭제" confirm={`${server.name} 삭제 확인`} busy={remove.busy} onConfirm={() => void remove.run()} />
        )}
      </div>
    </li>
  );
}

/** Splits a command line the way a shell would for the simple cases: spaces separate, quotes group. */
function words(line: string): string[] {
  return [...line.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)].map((m) => m[1] ?? m[2] ?? m[3] ?? '');
}

function AddToolServer({ onAdded }: { onAdded: () => void }) {
  const { backend } = useStudio();
  const [open, setOpen] = useState(false);
  const [transport, setTransport] = useState<'stdio' | 'http'>('stdio');
  const [name, setName] = useState('');
  const [line, setLine] = useState('');
  const [url, setUrl] = useState('');
  const [auth, setAuth] = useState<'bearer' | 'none'>('bearer');
  const [tokenEnv, setTokenEnv] = useState('');
  const add = useAction(async () => {
    const base = { id: slugify(name).slice(0, 30), name: name.trim(), about: '' };
    if (transport === 'http') await backend.call('mcp.add', { ...base, transport, url: url.trim(), auth });
    else {
      const [command = '', ...args] = words(line);
      await backend.call('mcp.add', { ...base, transport, command, args, ...(tokenEnv.trim() ? { tokenEnv: tokenEnv.trim() } : {}) });
    }
    setName('');
    setLine('');
    setUrl('');
    setTokenEnv('');
    setOpen(false);
    onAdded();
  });
  if (!open) {
    return (
      <Button className="self-start" onClick={() => setOpen(true)}>
        MCP 서버 추가
      </Button>
    );
  }
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void add.run();
      }}
      className="flex flex-col gap-4"
    >
      <Segmented label="연결 방식" value={transport} onChange={setTransport} options={[{ id: 'stdio', label: '이 Mac의 프로그램' }, { id: 'http', label: '원격 주소' }]} />
      <Field label="이름">
        <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} required maxLength={60} />
      </Field>
      {transport === 'stdio' ? (
        <>
          <Field label="실행 명령" hint="그 도구의 MCP 서버를 켜는 명령을 그대로 적습니다. 예를 들어 Blender는 uvx mcp-for-blender 입니다. 이 프로그램은 데몬이 도는 Mac에서, 샌드박스 밖에서 실행됩니다.">
            <input className={inputClass} value={line} onChange={(e) => setLine(e.target.value)} required autoCapitalize="none" spellCheck={false} />
          </Field>
          <Field label="토큰을 받는 환경 변수 (선택)" hint="서버가 토큰을 환경 변수로 받는다면 그 이름만 적습니다 (예: NOTION_TOKEN). 값은 추가한 뒤 아래 자격 증명에 저장합니다.">
            <input className={inputClass} value={tokenEnv} onChange={(e) => setTokenEnv(e.target.value.toUpperCase())} autoCapitalize="characters" spellCheck={false} />
          </Field>
        </>
      ) : (
        <>
          <Field label="주소" hint="https:// 로 시작해야 합니다.">
            <input className={inputClass} value={url} onChange={(e) => setUrl(e.target.value)} required inputMode="url" autoCapitalize="none" />
          </Field>
          <Segmented label="인증" value={auth} onChange={setAuth} options={[{ id: 'bearer', label: '토큰 사용' }, { id: 'none', label: '인증 없음' }]} />
        </>
      )}
      {add.error ? <Problem>{add.error}</Problem> : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="primary" busy={add.busy}>
          서버 추가
        </Button>
        {/* Opening the form is not a promise to fill it in. */}
        <Button disabled={add.busy} onClick={() => setOpen(false)}>
          취소
        </Button>
      </div>
    </form>
  );
}

function Row({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap justify-between gap-x-6 gap-y-1 border-t border-border py-2">
      <dt className="text-sm text-fg-muted">{term}</dt>
      <dd className="break-words text-base">{children}</dd>
    </div>
  );
}
