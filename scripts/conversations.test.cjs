const { test } = require('node:test');
const assert = require('node:assert/strict');
const { backend } = require('./helpers/backend.cjs');

test('creators can delete channels, retry deletion and reuse the name without exposing old history', () => {
  const b = backend(), owner = b.user('owner@hays.test'), teammate = b.user('member@hays.test');
  const channel = b.ok('createConversation', { kind: 'channel', name: 'Project One' }, owner);
  const message = b.ok('sendMessage', { conversationId: channel.id, body: 'Old project history', clientId: 'old' }, owner);
  const payload = { conversationId: channel.id };
  assert.equal(b.ok('deleteConversation', payload, owner).conversationId, channel.id);
  assert.equal(b.ok('deleteConversation', payload, owner).conversationId, channel.id);
  for (const user of [owner, teammate]) {
    assert.equal(b.ok('bootstrap', {}, user).conversations.some(c => c.id === channel.id), false);
    for (const action of ['listMessages', 'getThread', 'sendMessage', 'markRead', 'leaveConversation']) {
      assert.equal(b.call(action, { ...payload, body: 'Blocked', clientId: 'blocked', parentId: message.id, through: message.createdAt }, user).code, 'forbidden');
    }
    for (const action of ['editMessage', 'deleteMessage', 'react']) {
      assert.equal(b.call(action, { messageId: message.id, body: 'Blocked', emoji: 'heart' }, user).code, 'forbidden');
    }
    assert.equal(b.ok('searchMessages', { query: 'Old project history' }, user).messages.length, 0);
  }
  const replacement = b.ok('createConversation', { kind: 'channel', name: 'project-one' }, teammate);
  assert.notEqual(replacement.id, channel.id);
  assert.deepEqual(b.ok('listMessages', { conversationId: replacement.id }, teammate).messages, []);
  assert.ok(b.sheets.get('Messages').data.some(row => row[0] === message.id), 'history remains in the spreadsheet for retention');
});

test('deletion requires a creator or administrator with access; direct messages cannot be deleted for others', () => {
  const b = backend(), owner = b.user('owner@hays.test'), member = b.user('member@hays.test');
  const admin = b.user('admin@hays.test', 'admin');
  const channel = b.ok('createConversation', { kind: 'channel', name: 'permissions' }, owner);
  assert.equal(b.call('deleteConversation', { conversationId: channel.id }, member).code, 'forbidden');
  b.ok('deleteConversation', { conversationId: channel.id }, admin);
  assert.equal(b.call('deleteConversation', { conversationId: channel.id }, member).code, 'forbidden');
  const group = b.ok('createConversation', { kind: 'group', name: 'Private crew', members: [member.user.email] }, owner);
  assert.equal(b.call('deleteConversation', { conversationId: group.id }, admin).code, 'forbidden');
  assert.equal(b.call('deleteConversation', { conversationId: group.id }, member).code, 'forbidden');
  b.ok('deleteConversation', { conversationId: group.id }, owner);
  assert.equal(b.ok('bootstrap', {}, member).conversations.some(c => c.id === group.id), false);
  const adminGroup = b.ok('createConversation', { kind: 'group', name: 'Admin crew', members: [admin.user.email] }, owner);
  b.ok('deleteConversation', { conversationId: adminGroup.id }, admin);
  const dm = b.ok('createConversation', { kind: 'dm', members: [member.user.email] }, owner);
  assert.equal(b.call('deleteConversation', { conversationId: dm.id }, owner).code, 'bad_request');
  assert.equal(b.call('deleteConversation', {}, owner).code, 'forbidden');
  assert.equal(b.call('deleteConversation', { conversationId: channel.id }).code, 'unauthorized');
});

test('leaving a group returns its identifier and removes only the leaving member', () => {
  const b = backend(), owner = b.user('owner@hays.test'), member = b.user('member@hays.test');
  const group = b.ok('createConversation', { kind: 'group', name: 'Crew', members: [member.user.email] }, owner);
  assert.equal(b.ok('leaveConversation', { conversationId: group.id }, member).conversationId, group.id);
  assert.equal(b.ok('bootstrap', {}, member).conversations.some(c => c.id === group.id), false);
  assert.equal(b.call('sendMessage', { conversationId: group.id, body: 'Blocked', clientId: 'left' }, member).code, 'forbidden');
  assert.equal(b.ok('bootstrap', {}, owner).conversations.some(c => c.id === group.id), true);
});

test('old seven-column conversation sheets upgrade on delete and preserve other conversations', () => {
  const b = backend(), admin = b.user('admin@hays.test', 'admin');
  const sheet = b.sheets.get('Conversations');
  sheet.data = sheet.data.map(row => row.slice(0, 7));
  const conversations = b.ok('bootstrap', {}, admin).conversations;
  b.ok('deleteConversation', { conversationId: conversations[0].id }, admin);
  assert.equal(sheet.data[0][7], 'DeletedAt');
  assert.ok(sheet.data.find(row => row[0] === conversations[0].id)[7]);
  assert.equal(b.ok('bootstrap', {}, admin).conversations.length, 1);
  b.context.setupMessaging();
  assert.equal(b.ok('bootstrap', {}, admin).conversations.length, 1);
});
