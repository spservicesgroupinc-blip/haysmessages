import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPushFetch } from '../vercel-handler.mjs';
import entrypoint from '../../api/push.mjs';

const env = { VAPID_PUBLIC_KEY: 'B'.repeat(87), VAPID_PRIVATE_KEY: 'c'.repeat(43), VAPID_SUBJECT: 'mailto:admin@hays.test', PUSH_RELAY_SECRET: 's'.repeat(64) };
const body = { deliveries: [{ id: 'job', subscription: { endpoint: 'https://fcm.googleapis.com/fcm/send/test', keys: { p256dh: 'B'.repeat(87), auth: 'a'.repeat(22) } }, payload: { data: { conversationId: 'sales', messageId: 'message' } } }] };
const request = value => new Request('https://hays.vercel.app/api/push', { method: 'POST', headers: { Authorization: `Bearer ${env.PUSH_RELAY_SECRET}`, 'Content-Type': 'application/json' }, body: typeof value === 'string' ? value : JSON.stringify(value) });

test('Vercel function entrypoint imports successfully and exposes public readiness without secrets', async () => {
  assert.equal(typeof entrypoint.fetch, 'function');
  const handler = createPushFetch({ env, sendNotification: () => assert.fail('Health must not send') });
  const response = await handler(new Request('https://hays.vercel.app/api/push'));
  assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
  const data = await response.json(); assert.equal(data.enabled, true); assert.equal(data.publicKey, env.VAPID_PUBLIC_KEY);
  assert.equal(JSON.stringify(data).includes(env.VAPID_PRIVATE_KEY), false);
});

test('Vercel POST forwards an authenticated job to native sender and refuses unauthorized delivery', async () => {
  let sent = 0;
  const handler = createPushFetch({ env, sendNotification: async (_, payload) => { sent++; assert.equal(JSON.parse(payload).data.conversationId, 'sales'); } });
  const response = await handler(request(body)); assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { results: [{ id: 'job', status: 'delivered' }] });
  const unauthorized = new Request('https://hays.vercel.app/api/push', { method: 'POST', body: JSON.stringify(body) });
  assert.equal((await handler(unauthorized)).status, 401); assert.equal(sent, 1);
});

test('Vercel handler bounds streaming input, rejects malformed JSON and rejects unsupported methods', async () => {
  const handler = createPushFetch({ env, sendNotification: () => assert.fail('Invalid body must not send') });
  assert.equal((await handler(request('{'))).status, 400);
  assert.equal((await handler(request('x'.repeat(262145)))).status, 413);
  const stream = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(262145)); controller.close(); } });
  const streamed = new Request('https://hays.vercel.app/api/push', { method: 'POST', body: stream, duplex: 'half' });
  assert.equal((await handler(streamed)).status, 413);
  const method = await handler(new Request('https://hays.vercel.app/api/push', { method: 'PUT' }));
  assert.equal(method.status, 405); assert.equal(method.headers.get('allow'), 'GET, POST');
});
