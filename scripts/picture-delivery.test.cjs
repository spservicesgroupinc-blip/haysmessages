const { test } = require('node:test');
const assert = require('node:assert/strict');
const person = { email: 'sender@hays.test', name: 'Sender', role: 'member' };
const picture = { name: 'site.png', mimeType: 'image/png', size: 3, base64: 'AAAA', preview: 'data:image/png;base64,AAAA' };
test('picture is visible before upload, and retry after lost send response reuses the uploaded file', async () => {
  const { createDelivery } = await import('../src/lib/delivery.ts');
  const calls = []; let attempts = 0;
  const delivery = createDelivery(async (action, payload) => {
    calls.push(action);
    if (action === 'pictureConfig') return { privateStorage: true, maxBytes: 2097152 };
    if (action === 'uploadAttachment') return { id: 'private-picture', name: 'site.png', mimeType: 'image/png', size: 3 };
    if (!attempts++) throw new Error('Lost response');
    return { ...delivery.getSnapshot()[0], id: 'saved', pending: undefined, attachment: { id: payload.attachmentId } };
  }, person);
  const sending = delivery.send('crew', '', 'photo', '', picture);
  assert.equal(delivery.getSnapshot()[0].localPicture, picture.preview);
  assert.equal(delivery.getSnapshot()[0].deliveryStage, 'uploading');
  await assert.rejects(sending, /Lost response/);
  await delivery.retry(delivery.getSnapshot()[0]);
  assert.deepEqual(calls, ['pictureConfig', 'uploadAttachment', 'sendMessage', 'sendMessage']);
  assert.equal(delivery.getSnapshot()[0].pending, undefined);
});
test('legacy backends cannot receive picture data through their public upload handler', async () => {
  const { createDelivery } = await import('../src/lib/delivery.ts'); const calls = [];
  const delivery = createDelivery(async action => { calls.push(action); throw new Error('Unknown action'); }, person);
  await assert.rejects(delivery.send('crew', 'caption', 'photo', '', picture), /Apps Script.*update/i);
  assert.deepEqual(calls, ['pictureConfig']);
  assert.equal(delivery.getSnapshot()[0].pending, 'failed');
  assert.equal(delivery.getSnapshot()[0].localPicture, picture.preview);
});
