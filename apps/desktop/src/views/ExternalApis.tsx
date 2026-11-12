import { KeyRound, Plus, Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import type { ExternalApi, Project } from '@studio-zero/protocol';
import { useAction, useQuery, useStudio } from '../lib/studio.tsx';
import { Button, Field, IconButton, Modal, Problem, inputClass } from '../ui.tsx';

interface Row {
  name: string;
  secret: string;
}
const blank = (): Row => ({ name: '', secret: '' });
const envName = (api: string, variable: string): string => `${api.toUpperCase().replaceAll('-', '_')}_${variable}`;

/**
 * Keys for the outside APIs this project's own code calls. A key typed here goes to the daemon's Keychain and
 * is never shown again; the project gets a stand-in for it, and the swap happens on the way out of this Mac.
 */
export function ExternalApisModal({ project, open, onOpenChange }: { project: Project; open: boolean; onOpenChange: (open: boolean) => void }) {
  const { backend } = useStudio();
  const apis = useQuery('external.list', open ? { projectId: project.id } : null);
  const [name, setName] = useState('');
  const [origin, setOrigin] = useState('');
  const [rows, setRows] = useState<Row[]>([blank()]);
  const filled = rows.filter((r) => r.name.trim() !== '' && r.secret !== '');
  const connect = useAction(async () => {
    await backend.call('external.set', { projectId: project.id, name: name.trim(), origin: origin.trim(), variables: filled.map((r) => ({ name: r.name.trim(), secret: r.secret })) });
    setName('');
    setOrigin('');
    setRows([blank()]);
    apis.reload();
  });
  const remove = useAction(async (api: ExternalApi) => {
    await backend.call('external.remove', { projectId: project.id, name: api.name });
    apis.reload();
  });
  const submit = (e: FormEvent): void => {
    e.preventDefault();
    if (name.trim() !== '' && origin.trim() !== '' && filled.length > 0) void connect.run();
  };
  const edit = (index: number, patch: Partial<Row>): void => setRows((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  const list = apis.data?.apis ?? [];

  return (
    <Modal open={open} onOpenChange={onOpenChange} title="외부 API 키" description="키는 이 Mac의 Keychain에만 들어갑니다. 샌드박스에는 대역 값이 가고, 진짜 키는 나가는 길목에서 붙습니다.">
      {apis.error ? <Problem>{apis.error}</Problem> : null}
      {remove.error ? <Problem>{remove.error}</Problem> : null}
      {list.length > 0 ? (
        <ul className="flex flex-col">
          {list.map((api) => (
            <li key={api.name} className="flex max-w-none items-start justify-between gap-3 border-t border-border py-3">
              <span className="flex min-w-0 flex-col gap-1">
                <span className="flex items-center gap-2 text-base font-semibold">
                  <KeyRound className="size-4 shrink-0 text-fg-muted" aria-hidden />
                  {api.name}
                </span>
                <span className="break-all text-sm text-fg-muted">{api.origin}</span>
                <code className="break-all font-mono text-sm text-fg-muted">{[envName(api.name, 'BASE_URL'), ...api.variables.map((v) => envName(api.name, v))].join(' · ')}</code>
              </span>
              <IconButton label={`${api.name} 연결 해제`} disabled={remove.busy} onClick={() => void remove.run(api)}>
                <Trash2 className="size-4" aria-hidden />
              </IconButton>
            </li>
          ))}
        </ul>
      ) : apis.data ? (
        <p className="text-base text-fg-muted">연결된 API가 없습니다. 코드는 아래 이름의 환경 변수를 읽습니다.</p>
      ) : null}

      <form onSubmit={submit} className="flex flex-col gap-4 border-t border-border pt-4">
        <Field label="이름" hint="영문 소문자와 숫자, 하이픈. 변수 이름 앞에 붙습니다 (kis → KIS_APP_KEY).">
          <input className={`${inputClass} font-mono`} value={name} maxLength={24} pattern="[a-z][a-z0-9-]{1,23}" autoCapitalize="none" spellCheck={false} placeholder="kis" onChange={(e) => setName(e.target.value.toLowerCase())} />
        </Field>
        <Field label="API 주소" hint="https로 시작하는 호스트까지만. 이 주소 밖으로는 키가 나가지 않습니다.">
          <input className={`${inputClass} font-mono`} value={origin} maxLength={200} inputMode="url" autoCapitalize="none" spellCheck={false} placeholder="https://openapi.koreainvestment.com:9443" onChange={(e) => setOrigin(e.target.value)} />
        </Field>
        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium">키</span>
          {rows.map((row, i) => (
            <div key={i} className="flex flex-wrap gap-2">
              <input aria-label={`변수 이름 ${i + 1}`} className={`${inputClass} w-40 flex-none font-mono`} value={row.name} maxLength={31} pattern="[A-Z][A-Z0-9_]{0,30}" autoCapitalize="characters" spellCheck={false} placeholder="APP_KEY" onChange={(e) => edit(i, { name: e.target.value.toUpperCase() })} />
              <input aria-label={`키 값 ${i + 1}`} type="password" className={`${inputClass} min-w-40 flex-1 font-mono`} value={row.secret} autoComplete="off" spellCheck={false} placeholder="값" onChange={(e) => edit(i, { secret: e.target.value })} />
            </div>
          ))}
          {rows.length < 6 ? (
            <Button className="self-start" onClick={() => setRows((prev) => [...prev, blank()])} icon={<Plus className="size-4" aria-hidden />}>
              키 하나 더
            </Button>
          ) : null}
        </div>
        {/* What the stand-in does not stop: the agent cannot read the key, and can still call the API with it. */}
        <p className="border-l-4 border-warning pl-3 text-base">에이전트는 키를 읽지 못하지만 이 API를 호출할 수는 있습니다. 실계좌 주문이나 결제 권한이 있는 키 대신 조회 전용 키나 모의 키를 넣으세요.</p>
        {connect.error ? <Problem>{connect.error}</Problem> : null}
        <div className="flex flex-wrap justify-end gap-2">
          <Button disabled={connect.busy} onClick={() => onOpenChange(false)}>
            닫기
          </Button>
          <Button type="submit" variant="primary" busy={connect.busy} disabled={name.trim() === '' || origin.trim() === '' || filled.length === 0}>
            연결
          </Button>
        </div>
      </form>
    </Modal>
  );
}
