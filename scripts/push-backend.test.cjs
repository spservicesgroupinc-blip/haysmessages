const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');

function backend({ channels = true } = {}) {
  const properties = new Map(), sheets = new Map(), triggers = [], fetches = [];
  class Sheet {
    constructor(name = '') { this.name = name; this.data = []; }
    getName() { return this.name; }
    appendRow(row) { this.data.push([...row]); return this; }
    getLastRow() { return this.data.length; }
    getLastColumn() { return Math.max(0, ...this.data.map(row => row.length)); }
    getDataRange() { return { getValues: () => this.data.map(row => [...row]) }; }
    getRange(row, column, height = 1, width = 1) {
      const range = {
        getValues: () => Array.from({ length: height }, (_, i) => Array.from({ length: width }, (_, j) => this.data[row - 1 + i]?.[column - 1 + j] ?? '')),
        setValues: values => {
          for (let i = 0; i < height; i++) {
            const target = this.data[row - 1 + i] ?? (this.data[row - 1 + i] = []);
            for (let j = 0; j < width; j++) target[column - 1 + j] = values[i][j];
          }
          return range;
        },
        setValue: value => range.setValues([[value]]),
        clearContent: () => {
          for (let i = 0; i < height; i++) {
            const target = this.data[row - 1 + i];
            if (!target) continue;
            for (let j = 0; j < width; j++) target[column - 1 + j] = '';
          }
          while (this.data.length && this.data[this.data.length - 1].every(value => value === '' || value == null)) this.data.pop();
          return range;
        },
        setBackground: () => range, setFontColor: () => range, setFontWeight: () => range,
      };
      return range;
    }
    setFrozenRows() {}
    clearContents() { this.data = []; }
    deleteRow(row) { this.data.splice(row - 1, 1); }
  }
  const db = { getSheetByName: name => sheets.get(name), insertSheet: name => { const sheet = new Sheet(name); sheets.set(name, sheet); return sheet; }, getId: () => 'messaging-test-db', getUrl: () => 'https://example.test/messaging' };
  let locked = false, outcome = () => 'delivered';
  const context = vm.createContext({
    PropertiesService: { getScriptProperties: () => ({ getProperty: key => properties.get(key) || null, setProperty: (key, value) => properties.set(key, value) }) },
    SpreadsheetApp: { create: () => db, openById: () => db },
    Utilities: { getUuid: () => crypto.randomUUID(), base64Encode: bytes => Buffer.from(bytes).toString('base64'), DigestAlgorithm: { SHA_256: 'sha256' }, computeDigest: (_, value) => crypto.createHash('sha256').update(value).digest(), computeHmacSha256Signature: (value, salt) => crypto.createHmac('sha256', salt).update(value).digest() },
    LockService: { getScriptLock: () => ({ waitLock: () => { assert.equal(locked, false); locked = true; }, tryLock: () => { if (locked) return false; locked = true; return true; }, releaseLock: () => { assert.equal(locked, true); locked = false; } }) },
    ScriptApp: { getProjectTriggers: () => triggers, newTrigger: handler => { const builder = { timeBased: () => builder, everyMinutes: minutes => { assert.equal(minutes, 1); return builder; }, create: () => triggers.push({ getHandlerFunction: () => handler }) }; return builder; } },
    UrlFetchApp: { fetch: (url, options) => { const body = JSON.parse(options.payload); fetches.push({ url, options, body }); return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ results: body.deliveries.map(d => ({ id: d.id, status: outcome(d) })) }) }; } },
    ContentService: { MimeType: { JSON: 'application/json' }, createTextOutput: value => ({ setMimeType: () => value }) }, Logger: { log: () => {} },
  });
  vm.runInContext(fs.readFileSync('apps-script/Code.gs', 'utf8'), context); context.setupMessaging();
  // Test-only channels. Production setup creates empty tables.
  if (channels) for (const name of ['general', 'sales']) {
    context.createConversation_({kind: 'channel', name}, {email: 'test-setup@hays.test', name: 'Test setup', role: 'admin'});
  }
  // Code.gs caches sheet reads for the lifetime of one execution. Every simulated
  // request starts and ends with an empty cache, like a fresh Apps Script run.
  function resetRequestCache() { if (typeof context.invalidateSheetCache_ === 'function') context.invalidateSheetCache_(); }
  function call(action, payload = {}, session) { resetRequestCache(); const result = JSON.parse(context.doPost({ postData: { contents: JSON.stringify({ ...payload, action, sessionToken: session?.token }) } })); assert.equal(locked, false); resetRequestCache(); return result; }
  function ok(action, payload, session) { const result = call(action, payload, session); assert.equal(result.ok, true, JSON.stringify(result)); return result.data; }
  function user(email) { context.createUser(email, email.split('@')[0], 'correct password', 'member'); return ok('login', { email, password: 'correct password' }); }
  function setup() { properties.set('VAPID_PUBLIC_KEY', 'B'.repeat(87)); properties.set('PUSH_RELAY_SECRET', 's'.repeat(64)); properties.set('PUSH_RELAY_URL', 'https://push.hays.test/push'); context.setupPushMessaging(); }
  function subscribe(session, id = session.user.email) { const subscription = { endpoint: `https://fcm.googleapis.com/fcm/send/${id}`, keys: { p256dh: 'B'.repeat(87), auth: 'a'.repeat(22) }, expirationTime: null }; ok('subscribePush', { subscription }, session); return subscription; }
  function due() { for (const row of sheets.get('PushQueue').data.slice(1)) { row[6] = new Date(0).toISOString(); const targets = JSON.parse(row[4]); targets.forEach(t => { t.nextAt = 0; }); row[4] = JSON.stringify(targets); } }
  return { context, properties, sheets, triggers, fetches, call, ok, user, setup, subscribe, due, setOutcome: fn => { outcome = fn; } };
}

test('push setup is optional, editor-only, idempotent and needs minute trigger readiness', () => {
  const b = backend(), a = b.user('a@hays.test');
  assert.equal(b.sheets.size, 5); assert.equal(b.call('pushConfig').code, 'unauthorized');
  assert.equal(b.ok('pushConfig', {}, a).enabled, false);
  assert.throws(() => b.context.setupPushMessaging(), /Set VAPID_PUBLIC_KEY/);
  b.setup(); b.context.setupPushMessaging(); assert.equal(b.sheets.size, 7); assert.equal(b.triggers.length, 1);
  assert.equal(b.ok('pushConfig', {}, a).enabled, true);
  b.triggers.splice(0); assert.equal(b.ok('pushConfig', {}, a).enabled, false);
  assert.equal(b.call('setupPushMessaging', {}, a).code, 'unknown_action');
});

test('push subscriptions validate provider and keys, bind sessions, and revoke on logout/expiry', () => {
  const b = backend(); b.setup(); const a = b.user('a@hays.test'), other = b.user('other@hays.test');
  const sub = b.subscribe(a);
  assert.equal(b.ok('pushStatus', { endpoint: sub.endpoint }, a).subscribed, true);
  assert.equal(b.ok('pushStatus', { endpoint: sub.endpoint }, other).subscribed, false);
  b.ok('unsubscribePush', { endpoint: sub.endpoint }, other); assert.equal(b.sheets.get('PushSubscriptions').data.length, 2);
  assert.equal(b.call('subscribePush', { subscription: { ...sub, endpoint: 'https://127.0.0.1/private' } }, a).code, 'bad_request');
  assert.equal(b.call('subscribePush', { subscription: { ...sub, keys: { p256dh: 'invalid', auth: 'invalid' } } }, a).code, 'bad_request');
  b.ok('logout', {}, a); assert.equal(b.sheets.get('PushSubscriptions').data.length, 1);
  b.subscribe(other); b.sheets.get('Sessions').data.find(r => r[1] === other.user.email)[2] = new Date(0).toISOString(); b.context.cleanupSessions();
  assert.equal(b.sheets.get('PushSubscriptions').data.length, 1);
});

test('an editor password reset revokes sessions and push access only for the reset account', () => {
  const b = backend(); b.setup(); const a = b.user('a@hays.test'), other = b.user('other@hays.test');
  b.subscribe(a); b.subscribe(other);
  b.context.resetUserPassword(a.user.email, 'replacement password');
  assert.equal(b.call('session', {}, a).code, 'session_expired');
  // The reset revokes sessions; the next prune removes only the reset account's subscriptions.
  b.context.prunePushSubscriptions_();
  assert.equal(b.sheets.get('PushSubscriptions').data.length, 2);
  assert.equal(b.sheets.get('PushSubscriptions').data[1][1], other.user.email);
  assert.equal(b.ok('session', {}, other).user.email, other.user.email);
});

test('message retries queue once, exclude author and outsiders, suppress read and deleted messages', () => {
  const b = backend(); b.setup(); const a = b.user('a@hays.test'), c = b.user('c@hays.test'), outsider = b.user('out@hays.test');
  b.subscribe(a); const sub = b.subscribe(c); b.subscribe(outsider);
  const dm = b.ok('createConversation', { kind: 'dm', name: 'C', members: [c.user.email] }, a);
  const payload = { conversationId: dm.id, body: 'A private estimate', clientId: 'first' };
  const message = b.ok('sendMessage', payload, a); b.ok('sendMessage', payload, a);
  assert.equal(b.sheets.get('PushQueue').data.length, 2);
  b.context.deliverPushQueue(); assert.equal(b.fetches.length, 1); assert.equal(b.fetches[0].body.deliveries.length, 1);
  const delivery = b.fetches[0].body.deliveries[0]; assert.equal(delivery.subscription.endpoint, sub.endpoint); assert.equal(delivery.payload.data.messageId, message.id);
  assert.equal(JSON.stringify(delivery).includes('private estimate'), false);
  assert.equal(b.fetches[0].options.headers.Authorization, `Bearer ${b.properties.get('PUSH_RELAY_SECRET')}`);
  assert.equal(b.fetches[0].options.followRedirects, false); assert.equal(b.sheets.get('PushQueue').data.length, 1);
  const read = b.ok('sendMessage', { ...payload, clientId: 'read' }, a); b.ok('markRead', { conversationId: dm.id, through: read.createdAt }, c); b.context.deliverPushQueue();
  assert.equal(b.fetches.length, 1);
  const removed = b.ok('sendMessage', { ...payload, clientId: 'removed' }, a); b.ok('deleteMessage', { messageId: removed.id }, a); b.context.deliverPushQueue();
  assert.equal(b.fetches.length, 1); assert.equal(b.sheets.get('PushQueue').data.length, 1);
});

test('partial delivery retries only failed endpoints and prunes gone subscriptions', () => {
  const b = backend(); b.setup(); const a = b.user('a@hays.test'), c = b.user('c@hays.test'), d = b.user('d@hays.test');
  const subC = b.subscribe(c), subD = b.subscribe(d);
  const channel = b.ok('bootstrap', {}, a).conversations[0];
  b.setOutcome(delivery => delivery.subscription.endpoint === subC.endpoint ? 'delivered' : 'retry');
  b.ok('sendMessage', { conversationId: channel.id, body: 'Sensitive internal update', clientId: 'retry' }, a); b.context.deliverPushQueue();
  assert.equal(b.fetches[0].body.deliveries.length, 2);
  assert.equal(JSON.parse(b.sheets.get('PushQueue').data[1][4]).length, 1);
  b.context.deliverPushQueue(); assert.equal(b.fetches.length, 1, 'backoff prevents immediate retry');
  b.due(); b.setOutcome(() => 'gone'); b.context.deliverPushQueue();
  assert.equal(b.fetches[1].body.deliveries.length, 1); assert.equal(b.fetches[1].body.deliveries[0].subscription.endpoint, subD.endpoint);
  assert.equal(b.sheets.get('PushQueue').data.length, 1); assert.equal(b.sheets.get('PushSubscriptions').data.length, 2);
});

test('bounded failures expire jobs and endpoint ownership changes never transfer queued notifications', () => {
  const b = backend(); b.setup(); const a = b.user('a@hays.test'), c = b.user('c@hays.test'); const sub = b.subscribe(c);
  const channel = b.ok('bootstrap', {}, a).conversations[0];
  b.setOutcome(() => 'retry'); b.ok('sendMessage', { conversationId: channel.id, body: 'Hello', clientId: 'failure' }, a);
  for (let i = 0; i < 5; i++) { b.due(); b.context.deliverPushQueue(); }
  assert.equal(b.fetches.length, 5); assert.equal(b.sheets.get('PushQueue').data.length, 1);
  b.ok('sendMessage', { conversationId: channel.id, body: 'Hello again', clientId: 'ownership' }, a);
  const next = b.ok('login', { email: c.user.email, password: 'correct password' }); b.ok('subscribePush', { subscription: sub }, next); b.context.deliverPushQueue();
  assert.equal(b.fetches.length, 5); assert.equal(b.sheets.get('PushQueue').data.length, 1);
});

test('large queues respect the 50-delivery cap without spending retry attempts on unattempted devices', () => {
  const b = backend(); b.setup(); const a = b.user('a@hays.test'), c = b.user('c@hays.test');
  b.subscribe(c); const subRow = b.sheets.get('PushSubscriptions').data[1];
  // Model 56 active devices to verify queue batching independently of registration limits.
  for (let i = 1; i < 56; i++) {
    const sub = JSON.parse(subRow[3]); sub.endpoint = `https://fcm.googleapis.com/fcm/send/device-${i}`;
    b.sheets.get('PushSubscriptions').appendRow([b.context.digest_(sub.endpoint), subRow[1], subRow[2], JSON.stringify(sub), subRow[4], subRow[5], subRow[6]]);
  }
  const channel = b.ok('bootstrap', {}, a).conversations[0];
  b.ok('sendMessage', { conversationId: channel.id, body: 'Hello devices', clientId: 'batch' }, a);
  b.context.deliverPushQueue(); assert.equal(b.fetches[0].body.deliveries.length, 50);
  const pending = JSON.parse(b.sheets.get('PushQueue').data[1][4]); assert.equal(pending.length, 6);
  assert.ok(pending.every(target => target.attempts === 0));
  b.context.deliverPushQueue(); assert.equal(b.fetches[1].body.deliveries.length, 6);
  assert.equal(b.sheets.get('PushQueue').data.length, 1);
});

test('unreadable queue rows and subscriptions are dropped without blocking deliveries', () => {
  const b = backend(); b.setup(); const a = b.user('a@hays.test'), c = b.user('c@hays.test');
  b.subscribe(c); const channel = b.ok('bootstrap', {}, a).conversations[0];
  b.ok('sendMessage', { conversationId: channel.id, body: 'First', clientId: 'unreadable' }, a);
  b.ok('sendMessage', { conversationId: channel.id, body: 'Second', clientId: 'readable' }, a);
  b.sheets.get('PushQueue').data[1][4] = '{unreadable';
  b.context.deliverPushQueue();
  assert.equal(b.fetches.length, 1);
  assert.equal(b.fetches[0].body.deliveries.length, 1);
  assert.equal(b.sheets.get('PushQueue').data.length, 1);
  b.ok('sendMessage', { conversationId: channel.id, body: 'Third', clientId: 'subscription' }, a);
  b.sheets.get('PushSubscriptions').data[1][3] = '{unreadable';
  b.context.deliverPushQueue();
  assert.equal(b.fetches.length, 1);
  assert.equal(b.sheets.get('PushSubscriptions').data.length, 1);
  assert.equal(b.sheets.get('PushQueue').data.length, 1);
});
