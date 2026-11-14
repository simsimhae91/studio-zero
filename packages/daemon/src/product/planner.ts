import { ProductMap, type Template } from '@studio-zero/protocol';
import { PRODUCT_MAP_PROMPT } from '../harness/prompts.ts';
import { textBlock, type ClaudeClient, type LlmScope } from '../llm/ClaudeClient.ts';
import { untrusted } from '../trust/dataBlock.ts';
import { readProductMap } from './ProductMap.ts';

/** The planning model: the same one that plans a build. */
export const PRODUCT_MODEL = 'claude-fable-5-2';

const PLATFORM: Record<Template, string> = {
  'mobile-expo': 'a phone app (Expo, React Native); the preview is its web build in a phone-sized browser',
  'web-vite-react': 'a web app (Vite and React)',
  'web-next': 'a web app (Next.js)',
};

/** A map that could not be made to hold: what was still wrong with the second one. */
export class ProductMapError extends Error {
  readonly problems: string[];
  constructor(problems: string[]) {
    super(`the product map does not hold: ${problems.slice(0, 4).join(' | ')}${problems.length > 4 ? ` (and ${problems.length - 4} more)` : ''}`);
    this.name = 'ProductMapError';
    this.problems = problems;
  }
}

/**
 * Plans a whole product from the owner's request: one call, and one more with what was wrong when the first map
 * does not hold. The request is the owner's and goes in as theirs; what the project already has was read from
 * its workspace and goes in as data, as does the model's own first map when it is sent back.
 */
export async function planProductMap(
  deps: { claude: Pick<ClaudeClient, 'structured'>; scope: LlmScope },
  input: { request: string; template: Template; connected: readonly string[]; existing: string | null; signal?: AbortSignal },
): Promise<ProductMap> {
  const said = [
    textBlock(`The owner's request:\n${input.request.trim()}`),
    textBlock(`Platform: ${PLATFORM[input.template]}.`),
    textBlock(input.connected.length > 0 ? `Outside services the owner has connected (by the name they gave each): ${input.connected.join(', ')}.` : 'The owner has connected no outside service: nothing in the product can call a model or a paid API for real yet.'),
    textBlock(input.existing ? `What the project already has, from its screen plan:\n${untrusted('sandbox-output', input.existing)}\nKeep it: the map starts from this, and what is built already is the first milestone's.` : 'The project is empty.'),
  ];
  const ask = (again: ReturnType<typeof textBlock>[]): Promise<unknown> =>
    deps.claude.structured({ scope: deps.scope, model: PRODUCT_MODEL, effort: 'high', system: PRODUCT_MAP_PROMPT, schema: ProductMap, maxTokens: 24_000, content: [...said, ...again], signal: input.signal, timeoutMs: 15 * 60 * 1000 });

  const written = await ask([]);
  const first = readProductMap(written);
  if (first.ok) return first.map;
  const second = readProductMap(
    await ask([
      textBlock(`You wrote a map for this request and it does not hold yet. Write the whole map again, the same product, with these put right:\n${first.problems.map((problem) => `- ${problem}`).join('\n')}`),
      textBlock(`The map you wrote:\n${untrusted('engine-output', JSON.stringify(written))}`),
    ]),
  );
  if (second.ok) return second.map;
  throw new ProductMapError(second.problems);
}
