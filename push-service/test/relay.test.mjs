import { test } from 'node:test';
import assert from 'node:assert/strict';
import { relayRequest, validSubscription } from '../relay.mjs';
import { createServer } from '../server.mjs';

const env = { VAPID_PUBLIC_KEY: 'B'.repeat(87), VAPID_PRIVATE_KEY: 'c'.repeat(43), VAPID_SUBJECT: 'mailto:admin@hays.test', PUSH_RELAY_SECRET: 's'.repeat(64) };
const subscription = { endpoint: 'https://fcm.googleapis.com/fcm/send/test', keys: { p256dh: 'B'.repeat(87), auth: 'a'.repeat(22) }, expirationTime: null };
const delivery = (id = 'test') => ({ id, subscription, payload: { body: 'sensitive text must never be forwarded', data: { conversationId: 'channel', messageId: 'message' } } });
const request = (body = { deliveries: [delivery()] }) => ({ method: 'POST', path: '/push', authorization: `Bearer ${env.PUSH_RELAY_SECRET}`, body });

test('health exposes readiness and public key only; authorization precedes validation or delivery', async () => {
  let called = false;
  const options = { env, sendNotification: () => { called = true; } };
  const health = await relayRequest({ method: 'GET', path: '/health' }, options);
  assert.equal(health.body.enabled, true);
  assert.equal(JSON.stringify(health).includes(env.VAPID_PRIVATE_KEY), false);
  assert.equal(JSON.stringify(health).includes(env.PUSH_RELAY_SECRET), false);
  assert.equal((await relayRequest({ ...request(), authorization: 'Bearer wrong' }, options)).status, 401);
  assert.equal(called, false);
  assert.equal((await relayRequest(request(), { ...options, env: {} })).status, 503);
});

test('provider allowlist refuses credentials, local addresses, lookalikes, ports and expired subscriptions', async () => {
  for (const endpoint of ['http://fcm.googleapis.com/path', 'https://127.0.0.1/push', 'https://fcm.googleapis.com.attacker.test/path', 'https://fcm.googleapis.com:8443/path', 'https://user@fcm.googleapis.com/path', 'https://web.push.apple.com/path#fragment']) {
    assert.equal(validSubscription({ ...subscription, endpoint }), false, endpoint);
  }
  for (const endpoint of ['https://web.push.apple.com/id', 'https://updates.push.services.mozilla.com/id', 'https://wns2-by3p.notify.windows.com/?token=test']) assert.equal(validSubscription({ ...subscription, endpoint }), true);
  assert.equal(validSubscription({ ...subscription, expirationTime: Date.now() - 1 }), false);
  let called = false;
  const result = await relayRequest(request({ deliveries: [{ ...delivery(), subscription: { ...subscription, endpoint: 'https://localhost/push' } }] }), { env, sendNotification: () => { called = true; } });
  assert.equal(result.status, 400); assert.equal(called, false);
});

test('delivery uses native encrypted webpush, private generic text, dedupe topic and classified failures', async () => {
  const seen = [];
  const result = await relayRequest(request({ deliveries: [delivery('success'), delivery('expired'), delivery('busy')] }), { env, sendNotification: async (sub, payload, options) => {
    seen.push({ sub, payload: JSON.parse(payload), options });
    if (seen.length === 2) throw { statusCode: 410 };
    if (seen.length === 3) throw { statusCode: 429 };
  } });
  assert.deepEqual(result.body.results, [{ id: 'success', status: 'delivered' }, { id: 'expired', status: 'gone' }, { id: 'busy', status: 'retry' }]);
  for (const call of seen) {
    assert.equal(call.payload.body, 'You have a new team message.');
    assert.deepEqual(call.payload.data, { conversationId: 'channel', messageId: 'message' });
    assert.equal(call.options.contentEncoding, 'aes128gcm'); assert.equal(call.options.timeout, 5000);
    assert.equal(call.options.vapidDetails.privateKey, env.VAPID_PRIVATE_KEY);
    assert.equal(call.options.topic.length, 32);
    assert.equal(JSON.stringify(call.payload).includes('sensitive'), false);
  }
});

test('batches are bounded and invalid items reject the whole batch', async () => {
  let calls = 0, active = 0, highest = 0;
  const options = { env, sendNotification: async () => { calls++; active++; highest = Math.max(highest, active); await new Promise(resolve => setTimeout(resolve, 2)); active--; } };
  const result = await relayRequest(request({ deliveries: Array.from({ length: 23 }, (_, i) => delivery(String(i))) }), options);
  assert.equal(result.status, 200); assert.equal(calls, 23); assert.ok(highest <= 10);
  assert.equal((await relayRequest(request({ deliveries: Array.from({ length: 51 }, () => delivery()) }), options)).status, 400);
  assert.equal((await relayRequest(request({ deliveries: [delivery(), { ...delivery(), payload: {} }] }), options)).status, 400);
  assert.equal(calls, 23);
});

test('HTTP server rejects oversized and malformed bodies without sending notifications', async () => {
  const server = createServer({ env, sendNotification: () => assert.fail('Unexpected send') });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const url = `http://127.0.0.1:${server.address().port}/push`;
    const bad = await fetch(url, { method: 'POST', body: '{' }); assert.equal(bad.status, 400);
    const large = await fetch(url, { method: 'POST', body: 'x'.repeat(262145) }); assert.equal(large.status, 413);
    const forbidden = await fetch(url, { method: 'POST', body: JSON.stringify({ deliveries: [delivery()] }) }); assert.equal(forbidden.status, 401);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
