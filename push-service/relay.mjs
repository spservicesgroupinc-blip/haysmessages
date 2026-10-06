import { createHash, timingSafeEqual } from 'node:crypto';

export function validSubscription(subscription) {
  if (!subscription || typeof subscription !== 'object' || Array.isArray(subscription)) return false;
  let url;
  try { url = new URL(subscription.endpoint); } catch { return false; }
  const host = url.hostname;
  // Exact provider hosts prevent the relay from making requests to arbitrary servers.
  const allowed = host === 'fcm.googleapis.com' || host === 'updates.push.services.mozilla.com' || /^[a-z0-9-]+\.push\.services\.mozilla\.com$/.test(host) || /^[a-z0-9-]+\.push\.apple\.com$/.test(host) || /^[a-z0-9-]+\.notify\.windows\.com$/.test(host);
  const key = subscription.keys;
  return allowed && url.protocol === 'https:' && !url.port && !url.username && !url.password && !url.hash && subscription.endpoint.length <= 2048 &&
    /^[A-Za-z0-9_-]{87}$/.test(key?.p256dh || '') && /^[A-Za-z0-9_-]{22}$/.test(key?.auth || '') &&
    (subscription.expirationTime == null || (Number.isFinite(subscription.expirationTime) && subscription.expirationTime > Date.now()));
}

export function configured(env) {
  return /^[A-Za-z0-9_-]{87}$/.test(env.VAPID_PUBLIC_KEY || '') && /^[A-Za-z0-9_-]{43}$/.test(env.VAPID_PRIVATE_KEY || '') &&
    /^mailto:[^\s@]+@[^\s@]+\.[^\s@]+$/.test(env.VAPID_SUBJECT || '') && (env.PUSH_RELAY_SECRET || '').length >= 32;
}

function authorized(header, secret) {
  const candidate = typeof header === 'string' && header.startsWith('Bearer ') ? header.slice(7) : '';
  return timingSafeEqual(createHash('sha256').update(candidate).digest(), createHash('sha256').update(secret).digest());
}

export async function relayRequest({ method, path, authorization, body }, { env, sendNotification }) {
  if (method === 'GET' && (path === '/' || path === '/health')) {
    return { status: 200, body: { app: 'Hays + Sons Push Relay', enabled: configured(env), publicKey: configured(env) ? env.VAPID_PUBLIC_KEY : '' } };
  }
  if (method !== 'POST' || path !== '/push') return { status: 404, body: { error: 'Not found' } };
  if (!configured(env)) return { status: 503, body: { error: 'Push relay is not configured' } };
  if (!authorized(authorization, env.PUSH_RELAY_SECRET)) return { status: 401, body: { error: 'Unauthorized' } };
  if (!body || !Array.isArray(body.deliveries) || !body.deliveries.length || body.deliveries.length > 50) return { status: 400, body: { error: 'Expected 1 to 50 deliveries' } };
  if (body.deliveries.some(delivery => !delivery || typeof delivery.id !== 'string' || !delivery.id.length || delivery.id.length > 180 || !validSubscription(delivery.subscription) ||
    typeof delivery.payload?.data?.conversationId !== 'string' || delivery.payload.data.conversationId.length > 100 || !delivery.payload.data.conversationId.length ||
    typeof delivery.payload?.data?.messageId !== 'string' || delivery.payload.data.messageId.length > 100 || !delivery.payload.data.messageId.length)) {
    return { status: 400, body: { error: 'Invalid delivery' } };
  }
  const results = [];
  // Bound concurrency and per-provider request timeouts; sanitize all notification text.
  for (let offset = 0; offset < body.deliveries.length; offset += 10) {
    results.push(...await Promise.all(body.deliveries.slice(offset, offset + 10).map(async delivery => {
      const data = { conversationId: delivery.payload.data.conversationId, messageId: delivery.payload.data.messageId };
      const payload = JSON.stringify({ title: 'Hays + Sons', body: 'You have a new team message.', tag: `conversation-${data.conversationId}`, data });
      try {
        await sendNotification({ endpoint: delivery.subscription.endpoint, keys: delivery.subscription.keys }, payload, {
          vapidDetails: { subject: env.VAPID_SUBJECT, publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY },
          TTL: 300, timeout: 5000, urgency: 'normal', contentEncoding: 'aes128gcm',
          topic: createHash('sha256').update(data.conversationId).digest('base64url').slice(0, 32),
        });
        return { id: delivery.id, status: 'delivered' };
      } catch (error) {
        return { id: delivery.id, status: error?.statusCode === 404 || error?.statusCode === 410 ? 'gone' : 'retry' };
      }
    })));
  }
  return { status: 200, body: { results } };
}
