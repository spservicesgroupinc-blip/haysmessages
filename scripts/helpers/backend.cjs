const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');

function backend({ channels = true, withoutPushEnqueue = false, salesRows = null } = {}) {
  const properties = new Map();
  const sheets = new Map(), files = new Map(), folders = new Map();
  class Sheet {
    constructor(name = '') { this.name = name; this.data = []; }
    getName() { return this.name; }
    appendRow(row) { this.data.push([...row]); return this; }
    getLastRow() { return this.data.length; }
    getLastColumn() { return Math.max(0, ...this.data.map(row => row.length)); }
    getSheetId() { return 383974699; }
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
  const salesSheet = new Sheet();
  if (salesRows) salesSheet.data = salesRows.map(row => [...row]);
  const salesDb = { getSheetByName: name => name === 'Estimator_Sales_Report.xls (6).csv' ? salesSheet : null, getName: () => 'Sales test report', getSpreadsheetTimeZone: () => 'America/Los_Angeles', getUrl: () => 'https://docs.google.com/spreadsheets/d/1Ba1IEJEOb3ILhsZrOZSHCOT5-6pELnwGT-inUcVMcTk/edit' };
  let locked = false;
  const blob = (bytes, mimeType, name) => ({ getBytes: () => [...bytes], getContentType: () => mimeType, getName: () => name });
  const drive = {
    Access: { PRIVATE: 'PRIVATE', ANYONE_WITH_LINK: 'ANYONE_WITH_LINK' }, Permission: { NONE: 'NONE', VIEW: 'VIEW' },
    createFolder(name) {
      const id = crypto.randomUUID();
      const folder = { getId: () => id, setSharing: () => folder, createFile(data) {
        assert.equal(locked, true, 'picture uploads must be serialized');
        const id = crypto.randomUUID();
        const file = { bytes: data.getBytes(), mimeType: data.getContentType(), name: data.getName(), access: 'PRIVATE', trashed: false,
          getId: () => id, getName: () => file.name, getSize: () => file.bytes.length, getMimeType: () => file.mimeType,
          getBlob: () => blob(file.bytes, file.mimeType, file.name), getUrl: () => `https://drive.google.com/file/d/${id}/view`,
          setSharing: access => { file.access = access; return file; }, setTrashed: value => { file.trashed = value; return file; } };
        files.set(id, file); return file;
      } };
      folders.set(id, folder); return folder;
    },
    getFolderById(id) { if (!folders.has(id)) throw new Error('Folder unavailable'); return folders.get(id); },
    getFileById(id) { const file = files.get(id); if (!file || file.trashed) throw new Error('File unavailable'); return file; },
  };
  const context = vm.createContext({
    DriveApp: drive,
    PropertiesService: { getScriptProperties: () => ({ getProperty: key => properties.get(key) || null, setProperty: (key, value) => properties.set(key, value) }) },
    SpreadsheetApp: { flush: () => { assert.equal(locked, true); }, create: () => db, openById: id => { if (salesRows && id === '1Ba1IEJEOb3ILhsZrOZSHCOT5-6pELnwGT-inUcVMcTk') return salesDb; assert.equal(id, 'messaging-test-db'); return db; } },
    Utilities: {
      getUuid: () => crypto.randomUUID(), base64Encode: bytes => Buffer.from(bytes).toString('base64'),
      base64Decode: value => [...Buffer.from(value, 'base64')].map(byte => byte > 127 ? byte - 256 : byte),
      newBlob: blob,
      DigestAlgorithm: { SHA_256: 'sha256' }, computeDigest: (_, value) => crypto.createHash('sha256').update(Array.isArray(value) ? Buffer.from(value) : value).digest(),
      computeHmacSha256Signature: (value, salt) => crypto.createHmac('sha256', salt).update(value).digest(),
      formatDate: (value, timezone) => {
        const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(value);
        const field = type => parts.find(part => part.type === type).value;
        return `${field('year')}-${field('month')}-${field('day')}`;
      },
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
  // Code.gs caches sheet reads for the lifetime of one execution. Every simulated
  // request starts and ends with an empty cache, like a fresh Apps Script run.
  function resetRequestCache() { if (typeof context.invalidateSheetCache_ === 'function') context.invalidateSheetCache_(); }
  function call(action, payload = {}, session) {
    resetRequestCache();
    const result = JSON.parse(context.doPost({ postData: { contents: JSON.stringify({ ...payload, action, sessionToken: session?.token }) } }));
    assert.equal(locked, false, 'request must release its lock');
    resetRequestCache();
    return result;
  }
  function ok(action, payload, session) { const result = call(action, payload, session); assert.equal(result.ok, true, JSON.stringify(result)); return result.data; }
  function user(email, role = 'member', password = 'correct password') {
    context.createUser(email, email.split('@')[0], password, role);
    return ok('login', { email, password });
  }
  return { context, properties, sheets, salesSheet, files, folders, call, ok, user };
}

module.exports = { backend };
