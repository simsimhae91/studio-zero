// Pictures for a product: asked for through one tool, made by a subscription's image tool on the host, checked,
// brought to a shippable size, written into the workspace with a line saying why, metered, and capped per task.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deflateSync } from 'node:zlib';
import { IMAGE_LOG_FILE, imageSize, type ImageMaker } from '../src/qa/ImageDesk.ts';
import { codingSystemPrompt } from '../src/harness/prompts.ts';
import { sampleProject, testDaemon } from './helpers.ts';

const OWNER = { type: 'owner', via: 'desktop' } as const;

/** A real, if plain, PNG of the given size. */
function png(width: number, height: number): Uint8Array {
  const chunk = (type: string, data: Buffer): Buffer => {
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    let c = ~0;
    for (const byte of body) {
      c ^= byte;
      for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
    }
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(~c >>> 0);
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8);
  const rows = Buffer.alloc((width * 3 + 1) * height, 0x80);
  for (let y = 0; y < height; y++) rows[y * (width * 3 + 1)] = 0;
  return new Uint8Array(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', header), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]));
}

test('image headers are read for size, and nothing else passes for a picture', () => {
  assert.deepEqual(imageSize(png(1536, 1024)), { width: 1536, height: 1024, type: 'png' });
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x03, 0x00, 0x04, 0x80, 0x03, 0x01, 0x11, 0x00]);
  assert.deepEqual(imageSize(new Uint8Array(jpeg)), { width: 1152, height: 768, type: 'jpeg' });
  assert.equal(imageSize(new TextEncoder().encode('<svg onload="x()"></svg>')), null);
});

test('an engine asks for a picture: it is drawn on the host, saved, logged with its reason, metered, and capped', async () => {
  const asked: { description: string; shape: string }[] = [];
  const maker: ImageMaker = {
    availability: async () => ({ available: true, reason: 'codex-cli test' }),
    generateImage: async (req) => (asked.push({ description: req.description, shape: req.shape }), { png: png(1536, 1024), inputTokens: 38_000, outputTokens: 200, cachedTokens: 0 }),
  };
  // Stands in for sips: the same picture, said to be brought down to the asked size.
  const d = await testDaemon({ images: { perTask: 2 } }, { images: { maker, convert: async (_png, to, max) => (assert.deepEqual([to, max], ['png', 1600]), png(1600, 1067)) } });
  try {
    const { store, studio, provisioner, sandboxes, toolbox, events } = d.daemon;
    const project = sampleProject('diet');
    store.insertProject(project);
    await provisioner.ensure(project);
    const task = await studio.submitTask(OWNER, { projectId: project.id, kind: 'build', prompt: '다이어트 매칭 앱' }, 'desktop');
    const ctx = { project, taskId: task.id };
    const want = { description: 'A ripe mandarin cut in half beside a soft-boiled egg on a pale wooden table, morning light from the left, seen from above, photographic.', path: 'public/images/breakfast.png', shape: 'landscape', purpose: '첫 주 식단 카드의 머리 사진: 오늘 먹을 것을 보여 준다.' };

    const made = await toolbox.call(ctx, 'generate_image', want);
    assert.equal(made.isError, false, made.content);
    assert.match(made.content, /saved public\/images\/breakfast\.png \(1600x1067, \d+ KB\)/);
    assert.deepEqual(asked, [{ description: want.description, shape: 'landscape' }]);
    const saved = (await sandboxes.exec(project, 'head -c 8 public/images/breakfast.png | od -An -tx1', { timeoutSec: 20 })).stdout.replace(/\s+/g, '');
    assert.equal(saved, '89504e470d0a1a0a', 'the bytes in the workspace are the picture');
    const log = JSON.parse((await sandboxes.exec(project, `cat ${IMAGE_LOG_FILE}`, { timeoutSec: 20 })).stdout) as { path: string; purpose: string; description: string; via: string; width: number }[];
    assert.deepEqual(log.map((entry) => [entry.path, entry.purpose, entry.via, entry.width]), [[want.path, want.purpose, 'codex', 1600]]);
    const bodies = events.history({ taskId: task.id }, 0, 100).map((e) => e.body);
    assert.ok(bodies.some((b) => b.type === 'image.generated' && b.path === want.path && b.width === 1600 && b.height === 1067));
    assert.ok(bodies.some((b) => b.type === 'usage' && b.model === 'codex:image' && b.inputTokens === 38_000), 'the call is on the task\'s account');
    assert.equal(store.getTask(task.id)!.spentTokens, 38_200);

    // Paths stay in the workspace and name a picture.
    for (const path of ['../outside.png', '/etc/passwd.png', 'public/x.svg', 'public/a/../../b.png']) assert.equal((await toolbox.call(ctx, 'generate_image', { ...want, path })).isError, true, path);
    // The allowance: two for this task, and the third is refused by policy before anything is drawn.
    assert.equal((await toolbox.call(ctx, 'generate_image', { ...want, path: 'public/images/lunch.png' })).isError, false);
    const third = await toolbox.call(ctx, 'generate_image', { ...want, path: 'public/images/dinner.png' });
    assert.equal(third.isError, true);
    assert.match(third.content, /this task has had its 2 pictures/);
    assert.equal(asked.length, 2);
  } finally {
    await d.cleanup();
  }
});

test('with nothing connected that can draw, the engine is told to design without pictures', async () => {
  const d = await testDaemon({}, { images: { maker: null } });
  try {
    const { store, studio, provisioner, toolbox } = d.daemon;
    const project = sampleProject('diet');
    store.insertProject(project);
    await provisioner.ensure(project);
    const task = await studio.submitTask(OWNER, { projectId: project.id, kind: 'build', prompt: 'x' }, 'desktop');
    const out = await toolbox.call({ project, taskId: task.id }, 'generate_image', { description: 'A ripe mandarin cut in half on a pale wooden table.', path: 'public/a.jpg', shape: 'square', purpose: '식단 카드의 머리 사진으로 쓴다.' });
    assert.equal(out.isError, true);
    assert.match(out.content, /no image generator is connected/);
    assert.match(codingSystemPrompt('web-vite-react'), /A picture never stands in for the product's real thing on the first screen/);
  } finally {
    await d.cleanup();
  }
});
