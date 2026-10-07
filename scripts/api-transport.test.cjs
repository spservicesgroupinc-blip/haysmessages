const { test } = require('node:test');
const assert = require('node:assert/strict');
const loaded = import('../src/lib/apiTransport.ts');
const url = 'https://script.google.com/macros/s/example/exec';
const response = (body, status = 200, type = 'application/json') => new Response(body, { status, headers: { 'Content-Type': type } });

test('decodes JSON despite plain text content type and a leading BOM, preserving backend errors', async () => {
  const { decodeResponse, ApiError } = await loaded;
  assert.deepEqual(await decodeResponse(response('\uFEFF{"ok":true,"data":{"messages":[]}}', 200, 'text/plain'), 'listMessages', url), { messages: [] });
  await assert.rejects(decodeResponse(response('{"ok":false,"error":"Please sign in.","code":"session_expired"}', 401), 'bootstrap', url), error => error instanceof ApiError && error.code === 'session_expired');
});

test('distinguishes Google HTML authorization, missing deployment, and throttling without exposing HTML', async () => {
  const { decodeResponse } = await loaded;
  for (const [body, status, code] of [
    ['<html><title>Sign in - Google Accounts</title></html>', 200, 'deployment_access'],
    ['<html>Authorization is required to perform that action</html>', 200, 'deployment_access'],
    ['<html>Script function not found: doPost</html>', 200, 'deployment_missing'],
    ['<html>Sorry, unable to open the file at this time.</html>', 200, 'deployment_missing'],
    ['<html>Service invoked too many times</html>', 200, 'backend_throttled'],
    ['<html>Bad Gateway</html>', 502, 'backend_unavailable'],
  ]) {
    await assert.rejects(decodeResponse(response(body, status, 'text/html'), 'bootstrap', url), error => {
      assert.equal(error.code, code); assert.equal(error.details.status, status);
      assert.equal(error.details.action, 'bootstrap'); assert.ok(error.message.includes(url));
      assert.ok(!error.message.includes('<html>')); return true;
    });
  }
});

test('malformed JSON envelopes and success on an HTTP failure cannot pass as workspace data', async () => {
  const { decodeResponse } = await loaded;
  for (const body of ['null', '[]', '{}', '{"ok":"true","data":{}}', '{"ok":true}', '<html>Unexpected page</html>']) {
    await assert.rejects(decodeResponse(response(body), 'listMessages', url), { code: 'bad_response' });
  }
  await assert.rejects(decodeResponse(response('{"ok":true,"data":{}}', 503), 'bootstrap', url), { code: 'backend_unavailable' });
});

test('reads recover once from a Google HTML response and explicitly omit cookies and HTTP caches', async t => {
  const { fetchWorkspace } = await loaded;
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (target, options) => {
    assert.equal(target, url); assert.equal(options.credentials, 'omit'); assert.equal(options.cache, 'no-store');
    assert.equal(options.redirect, 'follow'); assert.equal(options.method, 'POST');
    return ++calls === 1 ? response('<html>Temporary Google page</html>', 200, 'text/html') : response('{"ok":true,"data":{"messages":[]}}');
  });
  assert.deepEqual(await fetchWorkspace(url, 'listMessages', '{"action":"listMessages"}', new AbortController().signal), { messages: [] });
  assert.equal(calls, 2);
});

test('failed writes and sign-in attempts are never replayed; permission and session errors do not retry', async t => {
  const { fetchWorkspace } = await loaded;
  let calls = 0;
  let body = '<html>Service invoked too many times</html>';
  t.mock.method(globalThis, 'fetch', async () => { calls++; return response(body); });
  for (const action of ['login', 'register', 'sendMessage', 'react', 'uploadAttachment', 'createConversation']) {
    const before = calls;
    await assert.rejects(fetchWorkspace(url, action, '{}', new AbortController().signal), { code: 'backend_throttled' });
    assert.equal(calls - before, 1);
  }
  for (const [nextBody, code] of [['<html>Sign in - Google Accounts</html>', 'deployment_access'], ['{"ok":false,"code":"session_expired"}', 'session_expired']]) {
    body = nextBody; const before = calls;
    await assert.rejects(fetchWorkspace(url, 'bootstrap', '{}', new AbortController().signal), { code });
    assert.equal(calls - before, 1);
  }
});

test('aborting a read cancels its pending recovery without sending another request', async t => {
  const { fetchWorkspace } = await loaded;
  const controller = new AbortController(); let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; return response('<html>Bad Gateway</html>', 502); });
  const pending = fetchWorkspace(url, 'bootstrap', '{}', controller.signal);
  setTimeout(() => controller.abort(), 20);
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(calls, 1);
});
