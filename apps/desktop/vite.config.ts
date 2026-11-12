import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  // Tauri's dev window loads this exact URL (src-tauri/tauri.conf.json → build.devUrl).
  server: { host: '127.0.0.1', port: 1420, strictPort: true },
  build: { target: 'safari16', outDir: 'dist', sourcemap: false, chunkSizeWarningLimit: 900 },
});
