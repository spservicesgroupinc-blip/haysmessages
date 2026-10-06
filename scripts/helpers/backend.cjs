const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');

function backend({ channels = true, withoutPushEnqueue = false } = {}) {
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
  let source = fs.readFileSync('apps-script/Code.gs', 'utf8');
  if (withoutPushEnqueue) source = source.replace('function enqueuePush_(', 'function unavailablePushModule_(');
  vm.runInContext(source, context);
  context.setupMessaging();
  // Test-only channels. Production setup creates empty tables.
  if (channels) for (const name of ['general', 'sales']) {
    context.createConversation_({kind: 'channel', name}, {email: 'test-setup@hays.test', name: 'Test setup', role: 'admin'});
  }
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

module.exports = { backend };
