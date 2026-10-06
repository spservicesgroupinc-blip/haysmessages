const { test } = require('node:test');
const assert = require('node:assert/strict');
const loaded = import('../src/lib/messageAlerts.ts');
const time = minute => `2026-10-06T12:${String(minute).padStart(2, '0')}:00.000Z`;
const conversation = (lastActivity, unread) => ({ id: 'general', lastActivity, unread });
const message = (id, minute, extra = {}) => ({ id, authorEmail: 'teammate@hays.test', createdAt: time(minute), deleted: false, ...extra });

test('incoming messages chime once, while history, own sends, edits and removed messages stay quiet', async () => {
  const { createMessageAlerts } = await loaded;
  let sounds = 0;
  const alerts = createMessageAlerts('me@hays.test', () => sounds++);
  alerts.bootstrap([conversation(time(1), 3)]);
  alerts.messages('general', [message('history', 1)], 'main');
  alerts.messages('general', [message('history', 1, { body: 'Edited history' })], 'main');
  alerts.messages('general', [message('own', 2, { authorEmail: 'me@hays.test' })], 'main');
  assert.equal(sounds, 0);
  alerts.messages('general', [message('new', 3)], 'main');
  alerts.messages('general', [message('new', 3)], 'main');
  alerts.bootstrap([conversation(time(3), 4)]);
  assert.equal(sounds, 1);
  alerts.messages('general', [message('removed', 4, { deleted: true })], 'main');
  assert.equal(sounds, 1);
});

test('other conversations and thread replies alert without double-alerting through bootstrap and message polling', async () => {
  const { createMessageAlerts } = await loaded;
  let sounds = 0;
  const alerts = createMessageAlerts('me@hays.test', () => sounds++);
  alerts.bootstrap([conversation(time(1), 0)]);
  alerts.bootstrap([conversation(time(2), 1)]);
  alerts.messages('general', [message('new', 2)], 'main');
  alerts.bootstrap([conversation(time(2), 1)]);
  assert.equal(sounds, 1);
  alerts.read('general');
  alerts.messages('general', [message('reply', 3, { parentId: 'new' })], 'thread:new');
  alerts.bootstrap([conversation(time(3), 1)]);
  assert.equal(sounds, 2);
  alerts.bootstrap([conversation(time(4), 1)]);
  assert.equal(sounds, 2, 'own send advances activity without increasing unread');
});
