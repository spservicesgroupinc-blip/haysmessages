const { test } = require('node:test');
const assert = require('node:assert/strict');
const { backend } = require('./helpers/backend.cjs');

test('setup creates empty tables, is idempotent and preserves existing accounts and messages', () => {
  const b = backend({ channels: false }); b.context.setupMessaging();
  assert.equal(b.sheets.size, 5);
  for (const sheet of b.sheets.values()) assert.equal(sheet.data.length, 1);
  assert.equal(b.properties.has('REGISTRATION_MODE'), false);
  assert.equal(b.properties.has('REGISTRATION_CODE'), false);
  const session = b.user('admin@hays.test', 'admin');
  assert.deepEqual(b.ok('bootstrap', {}, session).conversations, []);
  const conversation = b.ok('createConversation', { kind: 'channel', name: 'company-updates' }, session);
  const message = b.ok('sendMessage', { conversationId: conversation.id, body: 'First company message', clientId: 'first' }, session);
  b.context.setupMessaging();
  assert.equal(b.sheets.get('Users').data.length, 2);
  assert.equal(b.sheets.get('Conversations').data.length, 2);
  assert.equal(b.ok('listMessages', { conversationId: conversation.id }, session).messages[0].id, message.id);
});

test('email usernames normalize, support both payload names and reject conflicting identities', () => {
  const b = backend(); b.user('alex@hays.test');
  assert.equal(b.ok('login', { username: '  ALEX@HAYS.TEST  ', password: 'correct password' }).user.email, 'alex@hays.test');
  assert.equal(b.ok('login', { email: ' ALEX@HAYS.TEST ', password: 'correct password' }).user.email, 'alex@hays.test');
  assert.equal(b.call('login', { email: 'alex@hays.test', username: 'other@hays.test', password: 'correct password' }).code, 'bad_request');
  assert.equal(b.call('login', { username: 'alex', password: 'correct password' }).code, 'bad_request');
  const registered = b.ok('register', { username: 'new@hays.test', name: 'New teammate', password: 'new password' });
  assert.equal(registered.user.email, 'new@hays.test');
});

test('password resets are editor-only, retain accounts and revoke every session for that account', () => {
  const b = backend(); const first = b.user('alex@hays.test');
  const second = b.ok('login', { email: first.user.email, password: 'correct password' });
  const other = b.user('other@hays.test');
  const original = [...b.sheets.get('Users').data[1]];
  assert.equal(b.call('resetUserPassword', { email: first.user.email, password: 'replacement password' }, first).code, 'unknown_action');
  assert.throws(() => b.context.resetUserPassword(first.user.email, 'short'), /at least 10/);
  b.context.resetUserPassword(first.user.email.toUpperCase(), 'replacement password');
  assert.equal(b.call('session', {}, first).code, 'session_expired');
  assert.equal(b.call('session', {}, second).code, 'session_expired');
  assert.equal(b.ok('session', {}, other).user.email, other.user.email);
  assert.equal(b.call('login', { email: first.user.email, password: 'correct password' }).code, 'invalid_credentials');
  assert.ok(b.ok('login', { email: first.user.email, password: 'replacement password' }).token);
  const updated = b.sheets.get('Users').data[1];
  assert.deepEqual(updated.slice(0, 3), original.slice(0, 3));
  assert.notEqual(updated[3], original[3]); assert.notEqual(updated[4], original[4]);
  assert.notEqual(updated[4], 'replacement password');
});

test('public status reports the configured signup mode and disabled closes signup', () => {
  const b = backend();
  const status = JSON.parse(b.context.doGet()).data;
  assert.equal(status.version, 8.1); assert.equal(status.configured, true); assert.equal(status.usernameType, 'email');
  assert.ok(status.features.includes('sales-aggregations'));
  b.properties.set('REGISTRATION_CODE', 'obsolete-code');
  b.properties.set('REGISTRATION_EMAIL_DOMAINS', 'company.test');
  for (const [mode, requiresInvite] of [['invalid', false], ['invite', true], ['off', false], ['open', false]]) {
    b.properties.set('REGISTRATION_MODE', mode);
    assert.equal(b.ok('registrationInfo').enabled, true);
    assert.equal(b.ok('registrationInfo').requiresInvite, requiresInvite);
    assert.equal(b.ok('registrationInfo').registrationMode, mode);
    assert.ok(b.ok('register', { username: `${mode}@gmail.com`, name: 'New', password: 'correct password' }).token);
  }
  b.properties.set('REGISTRATION_MODE', 'disabled');
  assert.equal(b.ok('registrationInfo').enabled, false);
  assert.equal(b.call('register', { email: 'closed@gmail.com', name: 'New', password: 'correct password' }).code, 'forbidden');
});

test('sessions require valid credentials and expire, deactivate and revoke correctly', () => {
  const b = backend(); const session = b.user('alex@hays.test');
  assert.equal(b.call('bootstrap').code, 'unauthorized');
  assert.equal(b.call('login', { email: 'alex@hays.test', password: 'wrong password' }).code, 'invalid_credentials');
  assert.equal(b.call('session', {}, { token: 'invented' }).code, 'session_expired');
  assert.equal(b.call('session', {}, { token: { toString: 'invented' } }).code, 'unauthorized');
  assert.equal(b.call('session', {}, { token: 'x'.repeat(201) }).code, 'unauthorized');
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

test('registration accepts any email without an invite, validates credentials and prevents duplicate/admin signup', () => {
  const b = backend();
  const payload = { email: 'new@hays.test', name: 'New teammate', password: 'new password' };
  assert.ok(b.ok('register', { ...payload, email: 'new@outside.test' }).token);
  const session = b.ok('register', { ...payload, role: 'admin' });
  assert.equal(session.user.role, 'member');
  assert.equal(b.call('register', payload).code, 'user_exists');
  assert.equal(b.call('register', { ...payload, email: ' NEW@HAYS.TEST ' }).code, 'user_exists');
  assert.equal(b.call('register', { ...payload, email: 'invalid' }).code, 'bad_request');
  assert.equal(b.call('register', { ...payload, email: 'short@gmail.com', password: 'short' }).code, 'weak_password');
  assert.equal(b.call('register', { ...payload, email: 'blank@gmail.com', name: ' ' }).code, 'bad_request');
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

test('missing notification code cannot fail saved messages or replies; retries remain idempotent', () => {
  const b = backend({ withoutPushEnqueue: true }); const author = b.user('author@hays.test');
  const conversationId = b.ok('bootstrap', {}, author).conversations[0].id;
  const payload = { conversationId, body: 'Saved without notification code', clientId: 'missing-push' };
  const message = b.ok('sendMessage', payload, author);
  assert.equal(b.ok('sendMessage', payload, author).id, message.id);
  const reply = b.ok('sendMessage', { conversationId, parentId: message.id, body: 'Reply without notification code', clientId: 'missing-push-reply' }, author);
  assert.equal(reply.parentId, message.id);
  assert.equal(b.sheets.get('Messages').data.length, 3);
  assert.equal(b.ok('listMessages', { conversationId }, author).messages.length, 2);
});

test('a throwing notification handler cannot fail a saved message; storage failures still fail', () => {
  const b = backend(); const author = b.user('author@hays.test');
  const conversationId = b.ok('bootstrap', {}, author).conversations[0].id;
  let notificationAttempts = 0;
  b.context.enqueuePush_ = () => { notificationAttempts++; throw new Error('Notification queue unavailable'); };
  const payload = { conversationId, body: 'Saved despite notification failure', clientId: 'failed-push' };
  const message = b.ok('sendMessage', payload, author);
  assert.equal(b.ok('sendMessage', payload, author).id, message.id);
  assert.equal(notificationAttempts, 1);
  assert.equal(b.sheets.get('Messages').data.length, 2);
  b.sheets.get('Messages').appendRow = () => { throw new Error('Spreadsheet unavailable'); };
  assert.equal(b.call('sendMessage', { ...payload, clientId: 'storage-failure' }, author).ok, false);
  assert.equal(notificationAttempts, 1);
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
  for (const contents of ['', 'null', '[]', '{', '{}', '{"action":{}}', '{"action":""}', 'x'.repeat(25001)]) assert.equal(JSON.parse(b.context.doPost({ postData: { contents } })).ok, false);
  assert.equal(b.call('createUser', { email: 'intruder@hays.test', role: 'admin' }, a).code, 'unknown_action');
  assert.equal(b.context.cell_('=SUM(A1:A2)'), "'=SUM(A1:A2)");
});

test('unreadable stored values and malformed bodies degrade safely instead of failing requests', () => {
  const b = backend(); const a = b.user('a@hays.test'); const c = b.user('c@hays.test');
  const general = b.ok('bootstrap', {}, a).conversations[0];
  const message = b.ok('sendMessage', { conversationId: general.id, body: 'Unreadable storage', clientId: 'stored' }, a);
  const row = b.sheets.get('Messages').data.find(r => r[0] === message.id);
  row[9] = '{unreadable';
  assert.deepEqual(b.ok('react', { messageId: message.id, emoji: 'check' }, a).reactions.check, [a.user.email]);
  row[9] = '{"heart":"not a list"}';
  assert.deepEqual(b.ok('react', { messageId: message.id, emoji: 'heart' }, a).reactions.heart, [a.user.email]);
  const dm = b.ok('createConversation', { kind: 'dm', name: 'C', members: [c.user.email] }, a);
  b.sheets.get('Conversations').data.find(r => r[0] === dm.id)[4] = '{unreadable';
  assert.equal(b.ok('bootstrap', {}, a).conversations.some(x => x.id === dm.id), false);
  assert.equal(b.call('listMessages', { conversationId: dm.id }, a).code, 'forbidden');
  assert.equal(JSON.parse(b.context.doPost({ postData: { contents: '{' } })).code, 'bad_request');
});
