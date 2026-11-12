// A stand-in for an agent CLI in ACP mode (`agy acp`, `cursor-agent acp`): JSON-RPC, one message per line.
import { createInterface } from 'node:readline';

const send = (message) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);
const waiting = new Map();
let servers = [];
let model = null;
process.stdout.write('starting up (a log line that is not protocol)\n');
createInterface({ input: process.stdin }).on('line', async (line) => {
  const m = JSON.parse(line);
  if (m.method === undefined) return void waiting.get(m.id)?.(m);
  if (m.method === 'initialize') return send({ id: m.id, result: { protocolVersion: 1, agentCapabilities: {}, offered: m.params.clientCapabilities } });
  if (m.method === 'session/new') {
    servers = m.params.mcpServers;
    return send({ id: m.id, result: { sessionId: 'ses_1' } });
  }
  if (m.method === 'session/set_model') {
    if (m.params.modelId === 'no-such-model') return send({ id: m.id, error: { code: -32602, message: `unknown model: ${m.params.modelId}` } });
    model = m.params.modelId;
    return send({ id: m.id, result: {} });
  }
  if (m.method === 'session/prompt') {
    const ask = (id, method, params) => new Promise((resolve) => (waiting.set(id, resolve), send({ id, method, params })));
    const permission = await ask('p1', 'session/request_permission', { sessionId: 'ses_1', toolCall: { title: 'mcp__studio__write_file' }, options: [{ optionId: 'no', kind: 'reject_once' }, { optionId: 'yes', kind: 'allow_once' }] });
    const file = await ask('f1', 'fs/read_text_file', { sessionId: 'ses_1', path: '/etc/hosts' });
    send({ method: 'session/update', params: { sessionId: 'ses_1', update: { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'thinking' } } } });
    for (const text of [`servers=${servers.map((s) => `${s.name}:${s.command}:${s.env.map((e) => e.name).join('+')}`).join(',')} `, `permission=${permission.result?.outcome?.optionId} `, `fs=${file.error ? 'refused' : 'allowed'} `, `prompt=${m.params.prompt[0].text}`, ...(model ? [` model=${model}`] : [])]) {
      send({ method: 'session/update', params: { sessionId: 'ses_1', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } } } });
    }
    return send({ id: m.id, result: { stopReason: 'end_turn' } });
  }
  send({ id: m.id, error: { code: -32601, message: 'unknown method' } });
});
