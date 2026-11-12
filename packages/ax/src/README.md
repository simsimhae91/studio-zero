# AX kit

Put here by Studio Zero. It is the same code Studio Zero's own interface uses to show what an agent is doing,
so an AI feature in this project does not have to be a chat bubble.

It needs `react` and `zod` (version 4). Nothing else.

## Setup

1. Add an import alias for this folder, for example `"@ax/*": [".studio-zero/ax/*"]` in `tsconfig.json` and the
   matching `resolve.alias` in the bundler config.
2. Let Tailwind see the class names used here. In the global stylesheet, after the theme import:
   `@source "../.studio-zero/ax";` (the path is relative to the stylesheet).

The renderer is styled only with this project's theme tokens (`bg-surface`, `text-fg-muted`, `border-accent`, …),
so it follows the project's palette, in light and dark.

## The three parts

**Stream.** The server answers a POST with `text/event-stream` and writes events with `encodeEvent`:

```ts
import { EVENT_STREAM_HEADERS, encodeEvent } from '@ax/index';

return new Response(new ReadableStream({
  async start(controller) {
    const send = (event) => controller.enqueue(new TextEncoder().encode(encodeEvent(event)));
    send({ type: 'activity', label: '주문 내역을 확인하는 중' });
    send({ type: 'text', delta: '지난달 주문은 ' });
    send({ type: 'block', block: { type: 'comparison', title: '…', criteria: ['…'], options: [/* … */], recommended: null, confidence: 'medium' } });
    send({ type: 'done' });
    controller.close();
  },
}), { headers: EVENT_STREAM_HEADERS });
```

The model's API key stays on the server. The browser only ever sees events.

**Hook and renderer.** In a component:

```tsx
import { Block, Markdown, useAgentStream } from '@ax/react/index';

const agent = useAgentStream({ url: '/api/agent', steerUrl: '/api/agent/steer', telemetry });
// agent.start({ question }) · agent.stop() · agent.steer('표로 보여줘')
// agent.status · agent.activity · agent.text · agent.blocks · agent.error

<Markdown source={agent.text} />
{agent.blocks.map((block, i) => <Block key={i} block={block} onRespond={send} telemetry={telemetry} />)}
```

Every block is checked against the schema in `blocks.ts` before it reaches `agent.blocks`; an event that does not
match is counted and dropped. `Markdown` builds React elements and never sets HTML, so model output cannot
inject markup. `Block` covers: `text`, `choice`, `comparison`, `form`, `diagram` (Mermaid flowcharts),
`decision`, `sources`, `checklist`. A `choice` or a `comparison` carries the agent's stated confidence, and the
renderer shows it. Pass `labels` to change or translate the few words the renderer adds itself.

`steer` posts `{ message }` to `steerUrl` while a response is streaming, without stopping it.

**Telemetry.** How people actually respond to the feature, without recording what they typed or read:

```ts
import { createTelemetry } from '@ax/index';
export const telemetry = createTelemetry({ endpoint: '/api/ax-telemetry', app: 'my-app' });
```

It posts batches of `{ app, session, events }`: stream timings (time to first output, total, failures by code),
which block types were shown, and for answered questions whether the agent's recommendation was followed and
at which stated confidence. That last number is the one to watch: an agent that says "high" and is overridden
often is miscalibrated.

On React Native, the stream and telemetry work (pass `expo/fetch` as `fetch` to get a streaming body). The
renderer needs a DOM; on native, render `agent.blocks` with native components.
