import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { inTauri } from './lib/platform.ts';
import './styles/app.css';

// The desktop window draws its title bar over the content (tauri.conf.json: titleBarStyle Overlay), so panes
// that touch the top leave room for the traffic lights. Phones get the same room from the safe-area inset.
if (inTauri && /Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints === 0) document.documentElement.style.setProperty('--titlebar-height', '28px');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
