import { execFileSync } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Codex copies plugin/ into its cache. The eyes and their workspace dependencies
// live next to the original local marketplace's plugin directory.
export function checkout() {
  const plugin = dirname(dirname(fileURLToPath(import.meta.url)));
  if (existsSync(join(plugin, '../packages/eyes/package.json'))) return plugin;
  const listing = JSON.parse(
    execFileSync('codex', ['plugin', 'list', '--marketplace', 'studio-zero', '--json'], { encoding: 'utf8' }),
  );
  const source = listing.installed.find((p) => p.pluginId === 'sz@studio-zero')?.source;
  if (source?.source !== 'local' || !existsSync(join(source.path, '../packages/eyes/package.json'))) {
    throw new Error('Register the Studio Zero checkout as a local Codex marketplace, or use its plugin/bin directly.');
  }
  return realpathSync(source.path);
}
