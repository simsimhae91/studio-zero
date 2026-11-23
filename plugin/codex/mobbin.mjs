import { spawnSync } from 'node:child_process';

const endpoint = 'https://api.mobbin.com/mcp';
const searches = ['search_screens', 'search_flows', 'search_sections'];

export function mobbinOptions(phase, label, cwd) {
  if (phase !== 'Design' || label === 'sweep:design') return [];
  const result = spawnSync('codex', ['mcp', 'get', 'mobbin', '--json'], {
    cwd,
    encoding: 'utf8',
    timeout: 10000,
  });
  if (result.status !== 0) return [];
  const server = JSON.parse(result.stdout);
  if (!server.enabled || server.transport?.url !== endpoint) return [];
  const tools = searches.filter(
    (name) => (!server.enabled_tools || server.enabled_tools.includes(name)) && !server.disabled_tools?.includes(name),
  );
  if (!tools.length) return [];
  // Codex retrieves the owner's OAuth session from its credential store.
  return [
    '-c',
    'mcp_servers.mobbin.url=' + JSON.stringify(endpoint),
    '-c',
    'mcp_servers.mobbin.enabled_tools=' + JSON.stringify(tools),
    '-c',
    'mcp_servers.mobbin.default_tools_approval_mode="approve"',
  ];
}
