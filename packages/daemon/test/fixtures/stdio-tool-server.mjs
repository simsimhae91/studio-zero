// A real MCP server on stdio, standing in for a local tool such as Blender or Aseprite.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const server = new McpServer({ name: 'paint', version: '1.0.0' });
server.registerTool('draw_sprite', { description: 'Draw a sprite and say where it was saved.', inputSchema: { name: z.string(), size: z.number().int() } }, async (args) => ({
  content: [
    { type: 'text', text: `drew ${args.name} at ${args.size}px; token=${process.env.PAINT_TOKEN === 'paint-secret' ? 'present' : 'absent'}; ambient=${process.env.SZ_AMBIENT_SECRET ?? 'none'}; pid=${process.pid}` },
    { type: 'image', data: 'iVBORw0KGgo=', mimeType: 'image/png' },
  ],
}));
await server.connect(new StdioServerTransport());
