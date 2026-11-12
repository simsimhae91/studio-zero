#!/usr/bin/env node
import { pino } from 'pino';
import { VERSION, createDaemon } from './app/compose.ts';
import { loadConfig } from './config.ts';

const log = pino({
  level: process.env.SZ_LOG_LEVEL ?? 'info',
  base: { svc: 'studio-zero' },
  // Belt and braces: secrets are `Secret` objects that print as [secret], and these paths are redacted as well.
  redact: { paths: ['req.headers.authorization', 'req.headers["x-api-key"]', '*.token', '*.secret', '*.apiKey'], censor: '[redacted]' },
});

const config = loadConfig();
const daemon = await createDaemon(config, log);
await daemon.start();
log.info({ version: VERSION, control: `${config.listen.host}:${config.listen.port}`, gateway: `${config.gateway.host}:${config.gateway.port}`, runtime: config.runtime.dockerContext, home: config.home }, 'studio zero daemon ready');

let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    if (stopping) return;
    stopping = true;
    log.info({ signal }, 'shutting down');
    daemon.stop().then(
      () => process.exit(0),
      (err: unknown) => {
        log.error({ err: String(err) }, 'shutdown failed');
        process.exit(1);
      },
    );
  });
}
