import { useCallback, useEffect, useState } from 'react';
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

  const disconnect = useCallback(() => setBackend(null), []);
  // A daemon that rejects the token for good ends the session; a dropped tunnel only shows as "reconnecting".
  useEffect(() => {
    if (link === 'closed' && !demo) setBackend(null);
  }, [link]);

  if (!backend) {
    return (
      <Connect
        onLink={setLink}
        onConnected={(next) => {
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
