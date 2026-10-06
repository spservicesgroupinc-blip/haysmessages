import webpush from 'web-push';
import { relayRequest } from './relay.mjs';

const MAX_BODY = 262144;
async function readJson(request) {
  if (Number(request.headers.get('content-length')) > MAX_BODY) throw Object.assign(new Error('Request too large'), { status: 413 });
  const reader = request.body?.getReader();
  if (!reader) return undefined;
  const chunks = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY) { await reader.cancel(); throw Object.assign(new Error('Request too large'), { status: 413 }); }
      chunks.push(Buffer.from(value));
    }
  } finally { reader.releaseLock(); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw Object.assign(new Error('Invalid JSON'), { status: 400 }); }
}
export function createPushFetch({ env = process.env, sendNotification = webpush.sendNotification.bind(webpush) } = {}) {
  return async request => {
    const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
    if (!['GET', 'POST'].includes(request.method)) return Response.json({ error: 'Method not allowed' }, { status: 405, headers: { ...headers, Allow: 'GET, POST' } });
    try {
      const body = request.method === 'POST' ? await readJson(request) : undefined;
      const result = await relayRequest({ method: request.method, path: request.method === 'GET' ? '/health' : '/push', authorization: request.headers.get('authorization'), body }, { env, sendNotification });
      return Response.json(result.body, { status: result.status, headers });
    } catch (error) {
      const status = error?.status === 400 || error?.status === 413 ? error.status : 500;
      return Response.json({ error: status === 400 ? 'Invalid JSON' : status === 413 ? 'Request too large' : 'Request failed' }, { status, headers });
    }
  };
}
