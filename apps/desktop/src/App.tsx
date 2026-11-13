import { useCallback, useEffect, useRef, useState } from 'react';
import type { Backend, LinkState } from './lib/backend.ts';
import { demoBackend } from './lib/demo.ts';
import { StudioProvider } from './lib/studio.tsx';
import { Connect } from './views/Connect.tsx';
import { Shell } from './views/Shell.tsx';

const demo = new URLSearchParams(location.search).has('demo');

export function App() {
  const [backend, setBackend] = useState<Backend | null>(() => (demo ? demoBackend() : null));
  const [link, setLink] = useState<LinkState>('connected');

  useEffect(() => () => backend?.close(), [backend]);

  // Whether the owner asked to leave. When the daemon ends the session instead, the connect screen says why it is back.
  const leaving = useRef(false);
  const [ended, setEnded] = useState(false);
  const disconnect = useCallback(() => {
    leaving.current = true;
    setBackend(null);
  }, []);
  // A daemon that rejects the token for good ends the session; a dropped tunnel only shows as "reconnecting".
  useEffect(() => {
    if (link !== 'closed' || demo) return;
    setBackend(null);
    setEnded(!leaving.current);
    leaving.current = false;
  }, [link]);

  if (!backend) {
    return (
      <Connect
        onLink={setLink}
        notice={ended ? '데몬이 이 연결을 끝냈습니다. 토큰이 바뀌었거나 앱과 데몬의 버전이 다를 때 그렇습니다. 토큰을 확인하고 다시 연결해 주세요.' : null}
        onConnected={(next) => {
          setEnded(false);
          setLink('connected');
          setBackend(next);
        }}
      />
    );
  }
  return (
    <StudioProvider backend={backend} link={link}>
      <Shell onDisconnect={disconnect} />
    </StudioProvider>
  );
}
