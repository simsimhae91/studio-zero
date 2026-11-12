// Renders the app icon source (1024×1024 PNG) with headless Chrome; `pnpm tauri icon` then derives every size.
//   node scripts/icon.mjs && pnpm tauri icon src-tauri/app-icon.png
import { chromium } from 'playwright-core';
import { fileURLToPath } from 'node:url';

// A sheet of paper with one thing on it and a proof mark around that thing.
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <rect x="100" y="100" width="824" height="824" rx="184" fill="#f6f5f6"/>
  <rect x="280" y="388" width="336" height="248" fill="#1d1c1e"/>
  <rect x="236" y="344" width="424" height="336" fill="none" stroke="#93256f" stroke-width="28"/>
  <rect x="700" y="388" width="60" height="60" fill="#93256f"/>
</svg>`;

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1024, height: 1024 }, deviceScaleFactor: 1 });
await page.setContent(`<style>html,body{margin:0;background:transparent}</style>${svg}`);
await page.screenshot({ path: fileURLToPath(new URL('../src-tauri/app-icon.png', import.meta.url)), omitBackground: true });
await browser.close();
