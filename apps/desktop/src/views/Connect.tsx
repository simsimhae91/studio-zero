import { PlugZap } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { RpcCallError } from '@studio-zero/protocol';
import { connectDaemon, daemonAddress, type Backend, type LinkState } from '../lib/backend.ts';
import { inTauri, loadToken, localClientToken, saveToken } from '../lib/platform.ts';
import { Button, Field, Problem, TitlebarSpace, inputClass } from '../ui.tsx';

const ADDRESS_KEY = 'studio-zero.daemon-address';

function explain(err: unknown, host: string): string {
  if (err instanceof RpcCallError && err.code === 'unauthorized') return `${host}의 데몬이 이 토큰을 받아들이지 않습니다. 데몬이 실행 중인 Mac에서 sz token으로 토큰을 확인해 주세요.`;
  if (['localhost', '127.0.0.1', '[::1]'].includes(host)) return '이 Mac에서 데몬이 실행되고 있지 않습니다. 터미널에서 프로젝트 폴더로 가서 pnpm daemon 을 실행해 둔 뒤 다시 연결해 주세요.';
  return `${host}의 데몬에 닿지 않습니다. 데몬이 실행 중인지, 주소가 맞는지 확인해 주세요.`;
}

/** First screen: where the daemon is and the token that proves this client belongs to its owner. */
export function Connect({ onConnected, onLink }: { onConnected: (backend: Backend) => void; onLink: (state: LinkState) => void }) {
  const [address, setAddress] = useState(() => localStorage.getItem(ADDRESS_KEY) ?? 'localhost');
  const [token, setToken] = useState('');
  const [tokenSource, setTokenSource] = useState<'keychain' | 'typed'>('typed');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const tried = useRef(false);

  const connect = async (addr: string, secret: string): Promise<void> => {
    const { host } = daemonAddress(addr);
    setBusy(true);
    setProblem(null);
    try {
      const backend = await connectDaemon(addr, secret, onLink);
      localStorage.setItem(ADDRESS_KEY, addr); // the address only; the token goes to the OS keychain
      await saveToken(host, secret).catch(() => undefined);
      onConnected(backend);
    } catch (err) {
      setProblem(explain(err, host));
    } finally {
      setBusy(false);
    }
  };

  // In the native shell the token is usually already in the keychain: connect without asking.
  useEffect(() => {
    if (tried.current || !inTauri) return;
    tried.current = true;
    void (async () => {
      const { host } = daemonAddress(address);
      const stored = (await loadToken(host)) ?? (host === 'localhost' || host === '127.0.0.1' ? await localClientToken() : null);
      if (!stored) return;
      setToken(stored);
      setTokenSource('keychain');
      await connect(address, stored);
    })();
    // Runs once on mount with the remembered address.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = (e: FormEvent): void => {
    e.preventDefault();
    void connect(address, token);
  };

  return (
    <main className="flex h-full flex-col overflow-y-auto bg-bg px-6 py-12 text-fg sm:px-16 sm:py-24">
      <TitlebarSpace />
      <form onSubmit={submit} className="flex w-full max-w-md flex-col gap-8">
        <header className="flex flex-col gap-3">
          <h1 className="text-3xl font-semibold">스튜디오에 연결</h1>
          <p className="text-base text-fg-muted">작업은 데몬이 합니다. 이 창은 지시하고, 결과를 살펴보고, 승인하는 곳입니다.</p>
        </header>

        <div className="flex flex-col gap-6">
          <Field label="데몬 주소" hint="이 Mac이면 localhost, Mac mini면 Tailscale 이름을 적습니다.">
            <input className={inputClass} value={address} onChange={(e) => setAddress(e.target.value)} placeholder="macmini.tailnet.ts.net" autoCapitalize="none" autoCorrect="off" spellCheck={false} required />
          </Field>
          <Field label="연결 토큰" hint={tokenSource === 'keychain' ? '이 기기의 키체인에서 읽었습니다.' : '데몬이 실행 중인 Mac에서 sz token을 실행하면 나옵니다.'}>
            <input
              className={inputClass}
              type="password"
              value={token}
              onChange={(e) => {
                setToken(e.target.value);
                setTokenSource('typed');
              }}
              autoComplete="off"
              minLength={16}
              required
            />
          </Field>
        </div>

        {problem ? <Problem>{problem}</Problem> : null}

        <div className="flex flex-wrap items-center gap-4">
          <Button type="submit" variant="primary" busy={busy} icon={<PlugZap className="size-4" aria-hidden />}>
            연결
          </Button>
          <a className="inline-flex min-h-11 items-center text-base text-accent underline underline-offset-4" href="?demo">
            데몬 없이 둘러보기
          </a>
        </div>
      </form>
    </main>
  );
}
