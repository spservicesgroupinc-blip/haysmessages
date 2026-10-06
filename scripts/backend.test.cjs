const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');

function backend() {
  const properties = new Map();
  const sheets = new Map();
  class Sheet {
    constructor() { this.data = []; }
    appendRow(row) { this.data.push([...row]); return this; }
    getLastRow() { return this.data.length; }
    getDataRange() { return { getValues: () => this.data.map(row => [...row]) }; }
    getRange(row, column, height = 1, width = 1) {
      const range = {
        setValues: values => { for (let i = 0; i < height; i++) for (let j = 0; j < width; j++) this.data[row - 1 + i][column - 1 + j] = values[i][j]; return range; },
        setValue: value => range.setValues([[value]]),
        setBackground: () => range, setFontColor: () => range, setFontWeight: () => range,
      };
      return range;
    }
    setFrozenRows() {}
    deleteRow(row) { this.data.splice(row - 1, 1); }
  }
  const db = { getSheetByName: name => sheets.get(name), insertSheet: name => { const sheet = new Sheet(); sheets.set(name, sheet); return sheet; }, getId: () => 'messaging-test-db', getUrl: () => 'https://example.test/messaging' };
  let locked = false;
  const context = vm.createContext({
    PropertiesService: { getScriptProperties: () => ({ getProperty: key => properties.get(key) || null, setProperty: (key, value) => properties.set(key, value) }) },
    SpreadsheetApp: { create: () => db, openById: id => { assert.equal(id, 'messaging-test-db'); return db; } },
    Utilities: {
      getUuid: () => crypto.randomUUID(), base64Encode: bytes => Buffer.from(bytes).toString('base64'),
      DigestAlgorithm: { SHA_256: 'sha256' }, computeDigest: (_, value) => crypto.createHash('sha256').update(value).digest(),
      computeHmacSha256Signature: (value, salt) => crypto.createHmac('sha256', salt).update(value).digest(),
    },
    LockService: { getScriptLock: () => ({ waitLock: () => { assert.equal(locked, false); locked = true; }, releaseLock: () => { assert.equal(locked, true); locked = false; } }) },
    ContentService: { MimeType: { JSON: 'application/json' }, createTextOutput: value => ({ setMimeType: () => value }) },
    Logger: { log: () => {} },
  });
  vm.runInContext(fs.readFileSync('apps-script/Code.gs', 'utf8'), context);
  context.setupMessaging();
  function call(action, payload = {}, session) {
    const result = JSON.parse(context.doPost({ postData: { contents: JSON.stringify({ ...payload, action, sessionToken: session?.token }) } }));
    assert.equal(locked, false, 'request must release its lock');
    return result;
  }
  function ok(action, payload, session) { const result = call(action, payload, session); assert.equal(result.ok, true, JSON.stringify(result)); return result.data; }
  function user(email, role = 'member', password = 'correct password') {
    context.createUser(email, email.split('@')[0], password, role);
    return ok('login', { email, password });
  }
  return { context, properties, sheets, call, ok, user };
}

test('setup is idempotent, creates only messaging tables and default channels', () => {
  const b = backend(); b.context.setupMessaging();
  assert.equal(b.sheets.size, 5);
  assert.equal(b.sheets.get('Conversations').data.length, 5);
  assert.equal(b.properties.get('REGISTRATION_MODE'), 'invite');
  assert.ok(b.properties.get('REGISTRATION_CODE'));
});

test('sessions require valid credentials and expire, deactivate and revoke correctly', () => {
  const b = backend(); const session = b.user('alex@hays.test');
  assert.equal(b.call('bootstrap').code, 'unauthorized');
  assert.equal(b.call('login', { email: 'alex@hays.test', password: 'wrong password' }).code, 'invalid_credentials');
  assert.equal(b.call('session', {}, { token: 'invented' }).code, 'session_expired');
  assert.equal(b.ok('session', {}, session).user.email, 'alex@hays.test');
  b.sheets.get('Users').data[1][5] = false;
  assert.equal(b.call('session', {}, session).code, 'session_expired');
  b.sheets.get('Users').data[1][5] = true;
  b.sheets.get('Sessions').data[1][2] = new Date(0).toISOString();
  assert.equal(b.call('session', {}, session).code, 'session_expired');
  const next = b.ok('login', { email: 'alex@hays.test', password: 'correct password' });
  b.ok('logout', {}, next);
  assert.equal(b.call('session', {}, next).code, 'session_expired');
  const password = '  secret password  ';
  const spaced = b.user('spaced@hays.test', 'member', password);
  assert.ok(spaced.token);
  assert.equal(b.call('login', { email: 'spaced@hays.test', password: password.trim() }).code, 'invalid_credentials');
});

test('five failed attempts lock an account and expired lock can recover', () => {
  const b = backend(); b.user('alex@hays.test');
  for (let i = 0; i < 5; i++) assert.equal(b.call('login', { email: 'alex@hays.test', password: 'wrong' }).code, 'invalid_credentials');
  assert.equal(b.call('login', { email: 'alex@hays.test', password: 'correct password' }).code, 'account_locked');
  b.sheets.get('Users').data[1][7] = new Date(0).toISOString();
  assert.ok(b.ok('login', { email: 'alex@hays.test', password: 'correct password' }).token);
  assert.equal(b.sheets.get('Users').data[1][6], 0);
});

test('registration checks invite, approved domain, duplicate accounts and closed registration', () => {
  const b = backend();
  const payload = { email: 'new@hays.test', name: 'New teammate', password: 'new password' };
  assert.equal(b.call('register', payload).code, 'invalid_invite_code');
  payload.inviteCode = b.properties.get('REGISTRATION_CODE');
  b.properties.set('REGISTRATION_EMAIL_DOMAINS', 'hays.test');
  assert.equal(b.call('register', { ...payload, email: 'new@outside.test' }).code, 'domain_not_allowed');
  const session = b.ok('register', { ...payload, role: 'admin' });
  assert.equal(session.user.role, 'member');
  assert.equal(b.call('register', payload).code, 'user_exists');
  b.properties.set('REGISTRATION_MODE', 'off');
  assert.equal(b.ok('registrationInfo').enabled, false);
  assert.equal(b.call('register', { ...payload, email: 'other@hays.test' }).code, 'registration_closed');
});

test('private conversations are restricted, direct messages deduplicate and channels validate', () => {
  const b = backend(); const a = b.user('a@hays.test'); const c = b.user('c@hays.test'); const outsider = b.user('outsider@hays.test', 'admin');
  const dm = b.ok('createConversation', { kind: 'dm', name: 'C', members: [c.user.email] }, a);
  assert.equal(b.ok('createConversation', { kind: 'dm', name: 'A', members: [a.user.email] }, c).id, dm.id);
  assert.equal(b.ok('bootstrap', {}, outsider).conversations.some(item => item.id === dm.id), false);
  for (const action of ['listMessages', 'getThread', 'sendMessage', 'markRead']) assert.equal(b.call(action, { conversationId: dm.id, body: 'hello', clientId: 'x', through: new Date().toISOString() }, outsider).code, 'forbidden');
  const message = b.ok('sendMessage', { conversationId: dm.id, body: 'Private update', clientId: 'private' }, a);
  assert.equal(b.call('react', { messageId: message.id, emoji: 'heart' }, outsider).code, 'forbidden');
  assert.equal(b.call('createConversation', { kind: 'group', name: 'Group', members: ['missing@hays.test'] }, a).code, 'bad_request');
  assert.equal(b.call('createConversation', { kind: 'dm', name: 'Invalid', members: [c.user.email, outsider.user.email] }, a).code, 'bad_request');
  assert.equal(b.call('createConversation', { kind: 'channel', name: 'bad/channel' }, a).code, 'bad_request');
  assert.equal(b.call('createConversation', { kind: 'channel', name: 'general' }, a).code, 'duplicate');
  const group = b.ok('createConversation', { kind: 'group', name: 'Crew', members: [c.user.email] }, a);
  assert.equal(b.call('listMessages', { conversationId: group.id }, outsider).code, 'forbidden');
});

test('send retries are idempotent, scoped to author and cannot reuse another conversation identifier', () => {
  const b = backend(); const a = b.user('a@hays.test'); const c = b.user('c@hays.test');
  const channels = b.ok('bootstrap', {}, a).conversations;
  const payload = { conversationId: channels[0].id, body: 'Update', clientId: 'stable-retry-id' };
  const first = b.ok('sendMessage', payload, a);
  assert.equal(b.ok('sendMessage', payload, a).id, first.id);
  assert.equal(b.sheets.get('Messages').data.length, 2);
  assert.notEqual(b.ok('sendMessage', payload, c).id, first.id);
  assert.equal(b.call('sendMessage', { ...payload, conversationId: channels[1].id }, a).code, 'duplicate');
  assert.equal(b.call('sendMessage', { ...payload, clientId: 'empty', body: ' ' }, a).code, 'bad_request');
  assert.equal(b.call('sendMessage', { ...payload, clientId: 'long', body: 'x'.repeat(4001) }, a).code, 'bad_request');
});

test('only authors edit; administrators delete; reactions toggle and removed messages retain replies', () => {
  const b = backend(); const author = b.user('a@hays.test'); const teammate = b.user('b@hays.test'); const admin = b.user('admin@hays.test', 'admin');
  const conversationId = b.ok('bootstrap', {}, author).conversations[0].id;
  const message = b.ok('sendMessage', { conversationId, body: 'Original', clientId: 'parent' }, author);
  assert.equal(b.call('editMessage', { messageId: message.id, body: 'No' }, teammate).code, 'forbidden');
  assert.equal(b.call('editMessage', { messageId: message.id, body: 'No' }, admin).code, 'forbidden');
  assert.equal(b.ok('editMessage', { messageId: message.id, body: 'Edited' }, author).body, 'Edited');
  assert.deepEqual(b.ok('react', { messageId: message.id, emoji: 'heart' }, teammate).reactions.heart, [teammate.user.email]);
  assert.deepEqual(b.ok('react', { messageId: message.id, emoji: 'heart' }, teammate).reactions.heart, []);
  assert.equal(b.call('react', { messageId: message.id, emoji: '__proto__' }, teammate).code, 'bad_request');
  const reply = b.ok('sendMessage', { conversationId, parentId: message.id, body: 'Reply', clientId: 'reply' }, teammate);
  assert.equal(b.call('sendMessage', { conversationId, parentId: reply.id, body: 'Nested', clientId: 'nested' }, teammate).code, 'bad_request');
  assert.equal(b.call('deleteMessage', { messageId: message.id }, teammate).code, 'forbidden');
  const deleted = b.ok('deleteMessage', { messageId: message.id }, admin);
  assert.equal(deleted.deleted, true); assert.equal(deleted.body, '');
  assert.equal(b.ok('getThread', { conversationId, parentId: message.id }, author).messages.length, 2);
  assert.equal(b.call('sendMessage', { conversationId, parentId: message.id, body: 'Late reply', clientId: 'late' }, teammate).code, 'bad_request');
  assert.equal(b.call('react', { messageId: message.id, emoji: 'heart' }, teammate).code, 'bad_request');
});

test('pagination handles identical timestamps and includes replies without hiding root messages', () => {
  const b = backend(); const a = b.user('a@hays.test');
  const conversationId = b.ok('bootstrap', {}, a).conversations[0].id;
  const ids = [];
  for (let i = 0; i < 7; i++) ids.push(b.ok('sendMessage', { conversationId, body: `Update ${i}`, clientId: `root-${i}` }, a).id);
  for (let i = 0; i < 4; i++) b.ok('sendMessage', { conversationId, parentId: ids[6], body: `Reply ${i}`, clientId: `reply-${i}` }, a);
  b.sheets.get('Messages').data.slice(1).forEach(row => { row[5] = '2026-01-01T00:00:00.000Z'; });
  let page = b.ok('listMessages', { conversationId, limit: 3 }, a);
  assert.equal(page.messages.filter(m => !m.parentId).length, 3);
  assert.equal(page.messages.filter(m => m.parentId).length, 4);
  const roots = page.messages.filter(m => !m.parentId).map(m => m.id);
  while (page.hasMore) { page = b.ok('listMessages', { conversationId, limit: 3, beforeId: page.nextBeforeId }, a); roots.unshift(...page.messages.filter(m => !m.parentId).map(m => m.id)); }
  assert.deepEqual(roots, ids);
  const search = b.ok('listMessages', { conversationId, query: 'Reply' }, a);
  assert.equal(search.messages.length, 4);
  assert.equal(b.call('listMessages', { conversationId, beforeId: 'missing' }, a).code, 'bad_request');
});

test('read receipts are monotonic, reject future timestamps, and isolate user unread counts', () => {
  const b = backend(); const a = b.user('a@hays.test'); const reader = b.user('reader@hays.test');
  const conversationId = b.ok('bootstrap', {}, a).conversations[0].id;
  const m = b.ok('sendMessage', { conversationId, body: 'Read me', clientId: 'read' }, a);
  const unread = session => b.ok('bootstrap', {}, session).conversations.find(c => c.id === conversationId).unread;
  assert.equal(unread(reader), 1); assert.equal(unread(a), 0);
  b.ok('markRead', { conversationId, through: m.createdAt }, reader);
  b.ok('markRead', { conversationId, through: new Date(0).toISOString() }, reader);
  assert.equal(unread(reader), 0);
  assert.equal(b.call('markRead', { conversationId, through: new Date(Date.now() + 60000).toISOString() }, reader).code, 'bad_request');
});

test('HTTP envelope rejects malformed requests and never exposes editor-only administration', () => {
  const b = backend(); const a = b.user('a@hays.test');
  for (const contents of ['', 'null', '[]', '{', 'x'.repeat(25001)]) assert.equal(JSON.parse(b.context.doPost({ postData: { contents } })).ok, false);
  assert.equal(b.call('createUser', { email: 'intruder@hays.test', role: 'admin' }, a).code, 'unknown_action');
  assert.equal(b.context.cell_('=SUM(A1:A2)'), "'=SUM(A1:A2)");
});
