import http from 'node:http';
import { pathToFileURL } from 'node:url';
import webpush from 'web-push';
import { relayRequest } from './relay.mjs';

export function createServer({ env = process.env, sendNotification = webpush.sendNotification.bind(webpush) } = {}) {
  return http.createServer(async (request, response) => {
    const send = (status, body) => { response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); response.end(JSON.stringify(body)); };
    try {
      if (Number(request.headers['content-length']) > 262144) { send(413, { error: 'Request too large' }); request.resume(); return; }
      let raw = '', bytes = 0;
      for await (const chunk of request) {
        bytes += chunk.length;
        if (bytes > 262144) { send(413, { error: 'Request too large' }); request.resume(); return; }
        raw += chunk.toString('utf8');
      }
      let body;
      if (raw) { try { body = JSON.parse(raw); } catch { send(400, { error: 'Invalid JSON' }); return; } }
      const result = await relayRequest({ method: request.method, path: new URL(request.url, 'http://localhost').pathname, authorization: request.headers.authorization, body }, { env, sendNotification });
      send(result.status, result.body);
    } catch { if (!response.headersSent) send(500, { error: 'Request failed' }); }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT || 3002);
  const server = createServer();
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  server.listen(port, () => process.stdout.write(`Push relay listening on port ${port}\n`));
}
