---
name: read
does: Has a model read a picture or a document (an estimate, a receipt, a card) into the fields a product names, on the product's server.
check: one text-only call of a few tokens to the first provider whose key is there; a fraction of a cent
keys:
  - id: model/anthropic/api-key
    env: ANTHROPIC_API_KEY
    what: an API key of the owner's Anthropic account (Claude Console), used first when both are there
    without: another
    costs: billed per call to the owner's Anthropic account; a photographed page on Claude Sonnet 5.5 is about 5,000 tokens in ($0.01) and its fields and thinking out (about $0.01 to $0.03), worked out from the prices, not measured
  - id: model/openai/api-key
    env: OPENAI_API_KEY
    what: an API key of the owner's OpenAI account, used when there is no Anthropic key
    without: another
    costs: billed per call to the owner's OpenAI account; the cost of a page was not worked out (its image tokens follow per-model rules)
---

# read: a model reads a picture into fields

Read on 2026-11-17. Anthropic: the `claude-api` skill and platform.claude.com/docs/en/ pages **[vision]** build-with-claude/vision, **[schema]** build-with-claude/structured-outputs, **[price]** about-claude/pricing, **[data]** manage-claude/api-and-data-retention. OpenAI: developers.openai.com/api/docs/ pages **[o-vision]** guides/images-vision, **[o-pdf]** guides/pdf-files, **[o-schema]** guides/structured-outputs, **[o-ref]** api/reference/resources/responses/methods/create, **[o-models]** models and guides/latest-model, **[o-price]** pricing, **[o-data]** guides/your-data, **[o-errors]** guides/error-codes.

## When a product takes it

When a person has what the product needs on paper or a screen and typing it would be the work. Not when they can pick from a short list, and never to supply what the picture does not show.

## The pattern, on either provider

- The browser sends the picture to the product's server, which sends it on with the key from its environment (`env.ANTHROPIC_API_KEY` on a Worker, `Deno.env.get('ANTHROPIC_API_KEY')` in an edge function). The browser never holds a key or calls a provider.
- Send no more than the reading needs: crop to the document, at most 2,576 px on the long side (larger is scaled down anyway [vision]), and ask for no field that names the person.
- The answer is held to the product's JSON schema by the provider, then checked in code (types; the lines add up to the total). A field the picture does not show legibly is `null`.
- **When it cannot be read** (a refusal, a cut-off answer, a `null` where a figure is needed, sums that disagree), the product says so and lets the person type it. It never guesses a figure or fills a `null` with a typical one.

```ts
const ESTIMATE = { type: 'object', additionalProperties: false, required: ['clinic', 'date', 'lines', 'total'], properties: {
  clinic: { type: ['string', 'null'] }, date: { type: ['string', 'null'] }, total: { type: ['integer', 'null'] },
  lines: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['item', 'count', 'amount'], properties: {
    item: { type: 'string' }, count: { type: ['integer', 'null'] }, amount: { type: ['integer', 'null'] } } } } } };
const ASK = 'Read the estimate in the picture into the schema, amounts in won. Anything the picture does not show legibly is null. Never estimate a figure.';
```

## Anthropic (used first)

`claude-sonnet-5-5`, $2 in and $10 out a million tokens [price]. `claude-haiku-5-5` ($0.10 and $0.50 [price]) is enough for a clean printed page with few fields: run both on the same ten pictures and keep Haiku when it gives the same fields. Images: JPEG, PNG, GIF or WebP; 10 MB each (base64), 8000 × 8000 px, 128 MB a request; a picture costs ⌈width/28⌉ × ⌈height/28⌉ tokens, at most 4,784 on Claude 4.7 and later [vision]. A PDF goes as a `document` block (base64, `application/pdf`; 32 MB and 600 pages, per the skill). Schemas: every object `additionalProperties: false`; no `minimum`, `maximum`, `minLength`, `maxLength` or recursion; at most 24 optional fields and 16 with union types in a request [schema].

```ts
import Anthropic from '@anthropic-ai/sdk'; // in an edge function: 'npm:@anthropic-ai/sdk'
const res = await new Anthropic({ apiKey: env.ANTHROPIC_API_KEY }).messages.create({
  model: 'claude-sonnet-5-5', max_tokens: 16000, // the model's thinking counts toward this: a low ceiling cuts a long estimate off before its answer
  output_config: { effort: 'low', format: { type: 'json_schema', schema: ESTIMATE } },
  messages: [{ role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: photo } }, { type: 'text', text: ASK }] }],
});
const text = res.content.find((b) => b.type === 'text');
if (res.stop_reason !== 'end_turn' || !text) return cannotRead(); // refusal or max_tokens: the JSON may not match [schema]
const fields = checked(JSON.parse(text.text));
```

`effort: 'low'` keeps the thinking (billed as output) short; raise it when fields come back missed.

## OpenAI (when there is no Anthropic key)

`gpt-6.1-terra`, $1 in and $5 out a million tokens, the model OpenAI points to for visual reasoning; `gpt-6-luna` ($0.10 and $0.50) for focused work in volume [o-models, o-price]. A picture is an `input_image` part with a `data:image/jpeg;base64,…` address and `detail` (`low`, `high`, `auto`, `original`) [o-vision]; a PDF an `input_file` part with `file_data` `data:application/pdf;base64,…` [o-pdf]. PNG, JPEG, WEBP or still GIF; 512 MB and 1,500 pictures a request [o-vision]. Strict schemas list every field in `required`, set `additionalProperties: false`, and write an optional field as `['string', 'null']` [o-schema]. The text is in `output[]`, an item of type `message`, part `output_text`; a refusal is a part of type `refusal` [o-ref].

```ts
const res = await fetch('https://api.openai.com/v1/responses', { method: 'POST', headers: { authorization: `Bearer ${env.OPENAI_API_KEY}`, 'content-type': 'application/json' }, body: JSON.stringify({
  model: 'gpt-6.1-terra', max_output_tokens: 4000,
  input: [{ role: 'user', content: [{ type: 'input_image', image_url: `data:image/jpeg;base64,${photo}`, detail: 'high' }, { type: 'input_text', text: ASK }] }],
  text: { format: { type: 'json_schema', name: 'estimate', strict: true, schema: ESTIMATE } },
}) });
const out = (await res.json()).output?.find((o) => o.type === 'message')?.content?.find((c) => c.type === 'output_text' || c.type === 'refusal');
if (!res.ok || out?.type !== 'output_text') return cannotRead();
const fields = checked(JSON.parse(out.text)); // a cut-off answer does not parse: cannotRead()
```

Not confirmed on OpenAI's pages: the exact body of a refused key (the tool hides any word holding an end of the key), a size limit per picture in bytes, a model named for extraction, and whether a new account needs credit bought first ([o-errors] names `credit_balance_exhausted` when prepaid credit runs out).

## Keys while developing and shipped

`sz-eyes secret run ANTHROPIC_API_KEY=model/anthropic/api-key -- <launch>` (a Worker also needs `CLOUDFLARE_INCLUDE_PROCESS_ENV=true` and no `.dev.vars`; an edge function an `env(ANTHROPIC_API_KEY)` line under `[edge_runtime.secrets]`, as `public-data.md` shows). Shipped: the host's secrets, set at the release (`sz:ship`).

## What users are told and asked

- Before the first picture: it is sent abroad to be read, to Anthropic or OpenAI (both American companies). Under 개인정보 보호법 제28조의8 ①3 that processing abroad, when the service the person asked for needs it, may be disclosed in the 개인정보 처리방침 (or told by email) with what goes, to which country, when and how, to whom with their contact, for what and how long, and how to refuse and what refusing means.
- Medical or dental details are 민감정보 (제23조): processed only with consent asked apart from any other, after telling them what 제15조 ② lists. So a box of its own, unticked, before the first upload; refusing leaves the typing path. (Both read on casenote.kr's copy of the act, not on law.go.kr.)
- What becomes of the picture: the product keeps it no longer than it says. Anthropic: retained data is never used for training without express permission [data]. OpenAI: API data is not used for training unless the owner opts in; abuse logs up to 30 days [o-data].

## Shown to be real

One real document whose fields were typed by hand beforehand (kept with the product's tests as the expected JSON) goes through the running product to the real provider with the owner's key, and the screen shows exactly those fields; one unreadable picture (blurred, or a blank page) shows that it was not read and offers typing, with no figure. It bills the owner a few cents: run on their word.

## 주인이 할 일

### Anthropic API 키 (`model/anthropic/api-key`)

둘 중 하나만 있으면 됩니다. 둘 다 있으면 이쪽을 먼저 씁니다.

1. https://platform.claude.com 에서 Claude Console 계정을 만들거나 로그인합니다.
2. 결제(Billing)에 결제 수단을 넣습니다. 사진을 읽을 때마다 쓴 만큼 이 계정에 청구됩니다.
3. https://platform.claude.com/settings/keys 에서 키를 만듭니다. 이름은 Studio Zero 같은 것으로 합니다.
4. 아래 줄을 이 세션의 입력창에 붙여 넣기만 하고 Enter는 아직 누르지 않습니다. 줄을 복사하면 클립보드가 그 줄로 바뀌므로, 키보다 먼저 붙여 넣습니다: `! pbpaste | sz-eyes secret set model/anthropic/api-key`
5. 만든 키를 복사합니다.
6. 이 세션으로 돌아와 Enter를 누릅니다.
7. 넣었다고 말해 주면 세션이 확인합니다. 아주 짧은 호출 한 번이라 1센트도 들지 않습니다.

### OpenAI API 키 (`model/openai/api-key`)

Anthropic 키가 없을 때만 씁니다.

1. https://platform.openai.com 에 로그인합니다.
2. https://platform.openai.com/account/billing/overview 에서 크레딧을 충전합니다.
3. 아래 줄을 이 세션의 입력창에 붙여 넣기만 하고 Enter는 아직 누르지 않습니다. 줄을 복사하면 클립보드가 그 줄로 바뀌므로, 키보다 먼저 붙여 넣습니다: `! pbpaste | sz-eyes secret set model/openai/api-key`
4. https://platform.openai.com/api-keys 에서 키를 만들고 복사합니다.
5. 이 세션으로 돌아와 Enter를 누릅니다.
6. 넣었다고 말해 주면 세션이 확인합니다.
