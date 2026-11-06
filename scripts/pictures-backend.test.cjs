const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { backend } = require('./helpers/backend.cjs');
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a2ioAAAAASUVORK5CYII=';
const upload = (conversationId, clientId = 'photo-1', extra = {}) => ({ conversationId, clientId, fileName: 'site.png', mimeType: 'image/png', base64: png, ...extra });

test('pictures are private, belong to a sender/conversation and are readable only through a visible message', () => {
  const b = backend(), owner = b.user('owner@hays.test'), member = b.user('member@hays.test'), outsider = b.user('outsider@hays.test', 'admin');
  const dm = b.ok('createConversation', { kind: 'dm', members: [member.user.email] }, owner);
  assert.equal(b.call('uploadAttachment', upload(dm.id), outsider).code, 'forbidden');
  const picture = b.ok('uploadAttachment', upload(dm.id), owner);
  assert.equal(picture.mimeType, 'image/png'); assert.ok(picture.size > 0);
  assert.equal(picture.url, undefined); assert.equal(picture.downloadUrl, undefined);
  assert.equal([...b.files.values()][0].access, 'PRIVATE');
  assert.equal(b.ok('uploadAttachment', upload(dm.id), owner).id, picture.id);
  assert.equal(b.files.size, 1, 'lost upload responses can be retried without creating another Drive file');
  assert.equal(b.call('sendMessage', { conversationId: dm.id, clientId: 'stolen', body: '', attachmentId: picture.id }, member).code, 'forbidden');
  const sent = b.ok('sendMessage', { conversationId: dm.id, clientId: 'photo-1', body: '', attachmentId: picture.id }, owner);
  assert.equal(sent.attachment.id, picture.id); assert.equal(sent.body, '');
  assert.equal(b.ok('sendMessage', { conversationId: dm.id, clientId: 'photo-1', body: '', attachmentId: picture.id }, owner).id, sent.id);
  const image = b.ok('getAttachment', { messageId: sent.id }, member);
  assert.equal(image.base64, png); assert.equal(image.mimeType, 'image/png');
  assert.equal(b.call('getAttachment', { messageId: sent.id }, outsider).code, 'forbidden');
  b.ok('deleteMessage', { messageId: sent.id }, owner);
  assert.equal(b.call('getAttachment', { messageId: sent.id }, member).code, 'forbidden');
  assert.equal(b.ok('listMessages', { conversationId: dm.id }, member).messages[0].attachment, null);
});

test('server rejects spoofed, oversized, malformed and unattached image data before creating files', () => {
  const b = backend(), owner = b.user('owner@hays.test');
  const id = b.ok('bootstrap', {}, owner).conversations[0].id;
  for (const extra of [
    { mimeType: 'image/svg+xml', base64: Buffer.from('<svg/>').toString('base64') },
    { mimeType: 'image/jpeg' }, { base64: 'not base64!' }, { base64: Buffer.from('<html>fake picture</html>').toString('base64') },
    { base64: Buffer.alloc(2 * 1024 * 1024 + 1).toString('base64') }, { fileName: '' },
  ]) assert.equal(b.call('uploadAttachment', upload(id, 'invalid', extra), owner).code, 'bad_request');
  assert.equal(b.files.size, 0);
  assert.equal(b.call('uploadAttachment', upload(id)).code, 'unauthorized');
  assert.equal(b.call('sendMessage', { conversationId: id, clientId: 'raw', body: '', attachment: { url: 'javascript:bad()' } }, owner).code, 'bad_request');
  assert.equal(b.call('sendMessage', { conversationId: id, clientId: 'raw', body: '', attachmentId: 'missing' }, owner).code, 'forbidden');
});

test('pictures and captions work in threads and group access is revoked after leaving or deletion', () => {
  const b = backend(), owner = b.user('owner@hays.test'), member = b.user('member@hays.test');
  const group = b.ok('createConversation', { kind: 'group', name: 'Crew', members: [member.user.email] }, owner);
  const parent = b.ok('sendMessage', { conversationId: group.id, clientId: 'parent', body: 'Inspection photos' }, owner);
  const picture = b.ok('uploadAttachment', upload(group.id, 'reply', { parentId: parent.id }), owner);
  assert.equal(b.call('sendMessage', { conversationId: group.id, clientId: 'reply', body: '', attachmentId: picture.id }, owner).code, 'forbidden');
  const sent = b.ok('sendMessage', { conversationId: group.id, parentId: parent.id, clientId: 'reply', body: 'Kitchen wall', attachmentId: picture.id }, owner);
  assert.equal(b.ok('getThread', { conversationId: group.id, parentId: parent.id }, member).messages[1].attachment.id, picture.id);
  assert.equal(b.ok('editMessage', { messageId: sent.id, body: '' }, owner).attachment.id, picture.id);
  b.ok('leaveConversation', { conversationId: group.id }, member);
  assert.equal(b.call('getAttachment', { messageId: sent.id }, member).code, 'forbidden');
  b.ok('deleteConversation', { conversationId: group.id }, owner);
  assert.equal(b.call('getAttachment', { messageId: sent.id }, owner).code, 'forbidden');
});

test('attachment identifiers cannot be reused in another message or with different picture bytes', () => {
  const b = backend(), owner = b.user('owner@hays.test');
  const [one, two] = b.ok('bootstrap', {}, owner).conversations;
  const picture = b.ok('uploadAttachment', upload(one.id), owner);
  assert.equal(b.call('uploadAttachment', upload(one.id, 'photo-1', { base64: png.slice(0, -4) + 'AAAA' }), owner).code, 'duplicate');
  for (const payload of [ { conversationId: two.id, clientId: 'photo-1' }, { conversationId: one.id, clientId: 'other-id' } ]) {
    assert.equal(b.call('sendMessage', { ...payload, body: '', attachmentId: picture.id }, owner).code, 'forbidden');
  }
  assert.ok(JSON.parse(fs.readFileSync('apps-script/appsscript.json', 'utf8')).oauthScopes.includes('https://www.googleapis.com/auth/drive'));
});
