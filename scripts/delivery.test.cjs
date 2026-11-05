const { test } = require('node:test');
const assert = require('node:assert/strict');
const loaded = import('../src/lib/delivery.ts');
const person = { email: 'sender@hays.test', name: 'Sender', role: 'member' };
const confirmed = (body, clientId, conversationId = 'crew') => ({ id: `saved:${clientId}`, body, clientId, conversationId, authorEmail: person.email, authorName: person.name, createdAt: new Date().toISOString(), updatedAt: '', parentId: '', deleted: false, reactions: {} });

test('pending sends publish immediately, allow concurrent messages and settle in reverse order without duplicates', async () => {
  const { createDelivery, mergeMessages } = await loaded;
  const finish = new Map();
  const delivery = createDelivery((_, payload) => new Promise(resolve => finish.set(payload.clientId, () => resolve(confirmed(payload.body, payload.clientId)))), person);
  const first = delivery.send('crew', 'First', 'first');
  const second = delivery.send('crew', 'Second', 'second');
  assert.deepEqual(delivery.getSnapshot().map(m => [m.body, m.pending]), [['First', 'sending'], ['Second', 'sending']]);
  finish.get('second')(); await second;
  assert.equal(delivery.getSnapshot().find(m => m.clientId === 'first').pending, 'sending');
  finish.get('first')(); await first;
  const messages = mergeMessages(delivery.getSnapshot(), [confirmed('First edited', 'first')]);
  assert.equal(messages.length, 2);
  assert.equal(messages.find(m => m.clientId === 'first').body, 'First edited');
});

test('polling confirmation replaces a pending bubble and survives a lost write response', async () => {
  const { createDelivery, mergeMessages } = await loaded;
  let rejectSend;
  const delivery = createDelivery(() => new Promise((_, reject) => { rejectSend = reject; }), person);
  const sending = delivery.send('crew', 'Already saved', 'stable-id');
  const result = confirmed('Already saved', 'stable-id');
  assert.equal(mergeMessages(delivery.getSnapshot(), [result]).length, 1);
  delivery.observe([result]);
  rejectSend(new Error('Response lost'));
  assert.equal((await sending).id, result.id);
  assert.equal(delivery.getSnapshot().length, 0, 'the fetched message now owns the confirmed display');
});

test('failed messages stay visible and explicit retry reuses the identifier; double retry sends once', async () => {
  const { createDelivery } = await loaded;
  const ids = []; let attempts = 0;
  const delivery = createDelivery(async (_, payload) => {
    ids.push(payload.clientId);
    if (!attempts++) throw new Error('Connection dropped');
    return confirmed(payload.body, payload.clientId);
  }, person);
  await assert.rejects(delivery.send('crew', 'Keep this visible', 'retry-id'), /Connection dropped/);
  assert.equal(delivery.getSnapshot()[0].pending, 'failed');
  assert.equal(delivery.getSnapshot()[0].body, 'Keep this visible');
  await Promise.all([delivery.send('crew', 'Keep this visible', 'retry-id'), delivery.send('crew', 'Keep this visible', 'retry-id')]);
  assert.deepEqual(ids, ['retry-id', 'retry-id']);
  assert.equal(delivery.getSnapshot().length, 1);
  assert.equal(delivery.getSnapshot()[0].pending, undefined);
});

test('merging never duplicates pending and confirmed versions or mixes authors with the same client identifier', async () => {
  const { mergeMessages } = await loaded;
  const saved = confirmed('Saved', 'same');
  const pending = { ...saved, id: 'pending:same', pending: 'sending' };
  assert.deepEqual(mergeMessages([pending], [saved]), [saved]);
  assert.deepEqual(mergeMessages([saved], [pending]), [saved]);
  assert.equal(mergeMessages([saved], [{ ...pending, authorEmail: 'other@hays.test' }]).length, 2);
});
