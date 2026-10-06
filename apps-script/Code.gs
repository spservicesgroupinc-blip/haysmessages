/**
 * Hays + Sons Team Messaging - Enterprise Suite (Version 8.1 - Hardened)
 * 
 * SETUP INSTRUCTIONS:
 * 1. Deploy in an Apps Script project.
 * 2. Run setupMessaging() in the editor to initialize Google Sheet tables.
 * 3. Create your first admin with: createUser("admin@hays-sons.com", "Admin Name", "YourPassword123!", "admin")
 * 4. Deploy as Web App -> Execute as: "Me", Access: "Anyone".
 */

var SCHEMA = {
  Users: ['Email','Name','Role','Salt','PasswordHash','Active','FailedAttempts','LockedUntil'],
  Sessions: ['TokenHash','Email','ExpiresAt'],
  Conversations: ['Id','Name','Description','Kind','MembersJson','CreatedBy','CreatedAt'],
  Messages: ['Id','ConversationId','AuthorEmail','AuthorName','Body','CreatedAt','UpdatedAt','Deleted','ParentId','ReactionsJson','ClientId','AttachmentJson'],
  ReadReceipts: ['Email','ConversationId','ReadThrough']
};

var PUSH_SCHEMA = {
  PushSubscriptions: ['Id','Email','SessionHash','SubscriptionJson','ExpiresAt','CreatedAt','PublicKey'],
  PushQueue: ['MessageId','ConversationId','AuthorEmail','CreatedAt','TargetsJson','Attempts','NextAttemptAt']
};

var PASSWORD_ITERATIONS = 1500;

// Note: uploadAttachment and heartbeat are excluded to prevent blocking database lockouts
var MUTATIONS = [
  'login','register','logout','changePassword','updateProfile',
  'createConversation','leaveConversation','sendMessage','editMessage',
  'deleteMessage','react','markRead','subscribePush','unsubscribePush'
];

// ============================================================================
// 1. DATABASE & REQUEST-SCOPED CACHE
// ============================================================================

var REQUEST_CACHE_ = {};

function invalidateSheetCache_(name) {
  if (name) delete REQUEST_CACHE_[name];
  else REQUEST_CACHE_ = {};
}

function db_() {
  var id = PropertiesService.getScriptProperties().getProperty('MESSAGING_SPREADSHEET_ID');
  if (!id) fail_('not_configured', 'Run setupMessaging() in the Apps Script editor first.');
  return SpreadsheetApp.openById(id);
}

function sheet_(name) {
  var sheet = db_().getSheetByName(name);
  // Enforce mandatory SCHEMA tables only; optional push sheets return null gracefully
  if (!sheet && SCHEMA[name]) {
    fail_('not_configured', 'Run setupMessaging() in the Apps Script editor to create the messaging tables.');
  }
  return sheet;
}

function rows_(sheet) {
  if (!sheet) return [];
  var name = sheet.getName();
  if (REQUEST_CACHE_[name]) return REQUEST_CACHE_[name];
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) {
    REQUEST_CACHE_[name] = [];
    return [];
  }
  var data = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();
  REQUEST_CACHE_[name] = data;
  return data;
}

/** Atomic bulk cleanup: overwrites valid rows in place and clears trailing dead rows */
function bulkPruneSheet_(sheet, predicate) {
  if (!sheet) return 0;
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return 0;
  
  var values = sheet.getDataRange().getValues();
  var headers = values[0];
  var remaining = [];
  var removed = 0;
  
  for (var i = 1; i < values.length; i++) {
    if (predicate(values[i])) {
      remaining.push(values[i]);
    } else {
      removed++;
    }
  }
  
  if (removed > 0) {
    var payload = [headers].concat(remaining);
    sheet.getRange(1, 1, payload.length, headers.length).setValues(payload);
    if (values.length > payload.length) {
      sheet.getRange(payload.length + 1, 1, values.length - payload.length, headers.length).clearContent();
    }
    invalidateSheetCache_(sheet.getName());
  }
  return removed;
}

function setupMessaging() {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var props = PropertiesService.getScriptProperties();
    var id = props.getProperty('MESSAGING_SPREADSHEET_ID');
    var db = id ? SpreadsheetApp.openById(id) : SpreadsheetApp.create('Hays + Sons - Team Messaging Database');
    
    Object.keys(SCHEMA).forEach(function(name) {
      var sheet = db.getSheetByName(name) || db.insertSheet(name);
      if (!sheet.getLastRow()) {
        sheet.appendRow(SCHEMA[name]);
        sheet.getRange(1, 1, 1, SCHEMA[name].length).setBackground('#dc2626').setFontColor('#ffffff').setFontWeight('bold');
        sheet.setFrozenRows(1);
      } else {
        // Automatic column schema migration for existing deployments
        var existingCols = sheet.getLastColumn();
        if (existingCols < SCHEMA[name].length) {
          for (var c = existingCols; c < SCHEMA[name].length; c++) {
            sheet.getRange(1, c + 1).setValue(SCHEMA[name][c]).setBackground('#dc2626').setFontColor('#ffffff').setFontWeight('bold');
          }
        }
      }
    });
    
    props.setProperty('MESSAGING_SPREADSHEET_ID', db.getId());
    Logger.log('Messaging database initialized: ' + db.getUrl());
    return { spreadsheetUrl: db.getUrl() };
  } finally { lock.releaseLock(); }
}

// ============================================================================
// 2. SECURITY, VALIDATION & UTILITIES
// ============================================================================

function fail_(code, message) {
  var err = new Error(message);
  err.code = code;
  throw err;
}

function json_(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}

function digest_(value) {
  return Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(value)));
}

function hashPassword_(password, salt) {
  var hash = password;
  for (var i = 0; i < PASSWORD_ITERATIONS; i++) {
    hash = Utilities.base64Encode(Utilities.computeHmacSha256Signature(hash + salt, salt));
  }
  return hash;
}

function equal_(a, b) {
  a = String(a); b = String(b);
  var diff = a.length ^ b.length;
  for (var i = 0; i < Math.max(a.length, b.length); i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}

function text_(value, max, label) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) {
    fail_('bad_request', (label || 'Text') + ' is required and must be at most ' + max + ' characters.');
  }
  return value.trim();
}

function password_(value) {
  if (typeof value !== 'string' || !value.length || value.length > 256) {
    fail_('bad_request', 'Password is required and must be at most 256 characters.');
  }
  return value;
}

function email_(value) {
  var email = text_(value, 254, 'Email').toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail_('bad_request', 'Enter a valid email address.');
  return email;
}

function accountEmail_(payload) {
  var email = email_(payload.email === undefined ? payload.username : payload.email);
  if (payload.username !== undefined && email_(payload.username) !== email) {
    fail_('bad_request', 'Username must match your email address.');
  }
  return email;
}

function cell_(value) {
  if (value == null) return '';
  var str = String(value);
  return /^[=+\-@\t\r]/.test(str) ? "'" + str : str;
}

function person_(row) {
  return { email: String(row[0]), name: String(row[1]), role: String(row[2]) };
}

function activeUsers_() {
  return rows_(sheet_('Users')).filter(function(r) { return r[5] === true; });
}

function parseJson_(value, fallback) {
  if (value === '' || value == null) return fallback;
  try {
    var parsed = JSON.parse(value);
    return parsed == null ? fallback : parsed;
  } catch(err) {
    return fallback;
  }
}

function storedList_(value) {
  var list = parseJson_(value, []);
  return Array.isArray(list) ? list : [];
}

function storedMap_(value) {
  var map = parseJson_(value, {});
  return (map && typeof map === 'object' && !Array.isArray(map)) ? map : {};
}

function storedReactions_(value) {
  var reactions = storedMap_(value), safe = {};
  Object.keys(reactions).forEach(function(key) {
    if (Array.isArray(reactions[key])) {
      safe[key] = reactions[key].filter(function(e) { return typeof e === 'string'; });
    }
  });
  return safe;
}

// ============================================================================
// 3. AUTHENTICATION & USER MANAGEMENT
// ============================================================================

function createUser(email, name, password, role) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    return addUser_(email, name, password, role || 'member');
  } finally { lock.releaseLock(); }
}

function resetUserPassword(email, password) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    email = email_(email);
    password = password_(password);
    if (password.length < 10) fail_('weak_password', 'Password must be at least 10 characters.');
    var users = sheet_('Users'), records = rows_(users);
    var index = records.findIndex(function(r) { return r[0] === email; });
    if (index < 0) fail_('not_found', 'Account not found.');
    
    var salt = Utilities.getUuid() + Utilities.getUuid();
    users.getRange(index + 2, 4, 1, 2).setValues([[salt, hashPassword_(password, salt)]]);
    users.getRange(index + 2, 7, 1, 2).setValues([[0, '']]);
    invalidateSheetCache_('Users');
    
    bulkPruneSheet_(sheet_('Sessions'), function(r) { return r[1] !== email; });
    return { ok: true };
  } finally { lock.releaseLock(); }
}

function addUser_(email, name, password, role) {
  email = email_(email);
  name = text_(name, 80, 'Name');
  password = password_(password);
  if (password.length < 10) fail_('weak_password', 'Password must be at least 10 characters.');
  if (['admin', 'member'].indexOf(role) < 0) fail_('bad_request', 'Invalid role.');
  
  var users = sheet_('Users');
  if (rows_(users).some(function(r) { return r[0] === email; })) {
    fail_('user_exists', 'An account with that email already exists.');
  }
  var salt = Utilities.getUuid() + Utilities.getUuid();
  users.appendRow([email, cell_(name), role, salt, hashPassword_(password, salt), true, 0, '']);
  invalidateSheetCache_('Users');
  return { email: email, name: name, role: role };
}

function session_(user) {
  var token = Utilities.getUuid() + Utilities.getUuid();
  var expires = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString();
  sheet_('Sessions').appendRow([digest_(token), user.email, expires]);
  invalidateSheetCache_('Sessions');
  return { token: token, expiresAt: expires, user: user };
}

function authenticate_(payload) {
  if (typeof payload.sessionToken !== 'string' || !payload.sessionToken || payload.sessionToken.length > 200) {
    fail_('unauthorized', 'Please sign in.');
  }
  var hash = digest_(payload.sessionToken);
  var session = rows_(sheet_('Sessions')).find(function(r) {
    return equal_(r[0], hash) && new Date(r[2]).getTime() > Date.now();
  });
  if (!session) fail_('session_expired', 'Your session has expired. Please sign in again.');
  var user = activeUsers_().find(function(r) { return r[0] === session[1]; });
  if (!user) fail_('session_expired', 'Your account is no longer active.');
  return person_(user);
}

function login_(payload) {
  var email = accountEmail_(payload), password = password_(payload.password);
  var sheet = sheet_('Users'), records = rows_(sheet);
  var index = records.findIndex(function(r) { return r[0] === email; });
  if (index < 0) fail_('invalid_credentials', 'Incorrect email or password.');
  
  var row = records[index];
  if (row[5] !== true) fail_('invalid_credentials', 'Incorrect email or password.');
  if (new Date(row[7]).getTime() > Date.now()) fail_('account_locked', 'Too many failed attempts. Locked for 15 minutes.');
  
  if (!equal_(hashPassword_(password, row[3]), row[4])) {
    var attempts = (new Date(row[7]).getTime() <= Date.now() ? 0 : Number(row[6]) || 0) + 1;
    sheet.getRange(index + 2, 7, 1, 2).setValues([[attempts, attempts >= 5 ? new Date(Date.now() + 15 * 60 * 1000).toISOString() : '']]);
    invalidateSheetCache_('Users');
    fail_('invalid_credentials', 'Incorrect email or password.');
  }
  
  sheet.getRange(index + 2, 7, 1, 2).setValues([[0, '']]);
  invalidateSheetCache_('Users');
  return session_(person_(row));
}

function registrationInfo_() {
  var mode = PropertiesService.getScriptProperties().getProperty('REGISTRATION_MODE') || 'open';
  return {
    enabled: mode !== 'disabled',
    requiresInvite: mode === 'invite',
    minPasswordLength: 10,
    usernameType: 'email',
    registrationMode: mode
  };
}

function register_(payload) {
  var info = registrationInfo_();
  if (!info.enabled) fail_('forbidden', 'New user registrations are currently closed.');
  return session_(addUser_(accountEmail_(payload), payload.name, payload.password, 'member'));
}

function changePassword_(payload, user) {
  var oldPass = password_(payload.oldPassword);
  var newPass = password_(payload.newPassword);
  if (newPass.length < 10) fail_('weak_password', 'New password must be at least 10 characters.');
  
  var sheet = sheet_('Users'), records = rows_(sheet);
  var index = records.findIndex(function(r) { return r[0] === user.email; });
  if (index < 0) fail_('not_found', 'User record not found.');
  
  var row = records[index];
  if (!equal_(hashPassword_(oldPass, row[3]), row[4])) {
    fail_('invalid_credentials', 'Current password is incorrect.');
  }
  
  var salt = Utilities.getUuid() + Utilities.getUuid();
  sheet.getRange(index + 2, 4, 1, 2).setValues([[salt, hashPassword_(newPass, salt)]]);
  invalidateSheetCache_('Users');
  
  // Revoke other active sessions for security while preserving the current active session
  var currentHash = digest_(payload.sessionToken);
  bulkPruneSheet_(sheet_('Sessions'), function(r) {
    return r[1] !== user.email || equal_(r[0], currentHash);
  });
  
  return { ok: true, message: 'Password updated successfully.' };
}

function updateProfile_(payload, user) {
  var newName = text_(payload.name, 80, 'Display Name');
  var sheet = sheet_('Users'), records = rows_(sheet);
  var index = records.findIndex(function(r) { return r[0] === user.email; });
  if (index < 0) fail_('not_found', 'User record not found.');
  
  sheet.getRange(index + 2, 2).setValue(cell_(newName));
  invalidateSheetCache_('Users');
  return { ok: true, user: { email: user.email, name: newName, role: user.role } };
}

// ============================================================================
// 4. CONVERSATIONS & MESSAGING
// ============================================================================

function conversation_(row) {
  return {
    id: String(row[0]),
    name: String(row[1]),
    description: String(row[2]),
    kind: String(row[3]),
    members: storedList_(row[4]),
    createdBy: String(row[5]),
    createdAt: String(row[6]),
    lastActivity: String(row[6]),
    unread: 0
  };
}

function visible_(conversation, user) {
  return conversation.kind === 'channel' || conversation.members.indexOf(user.email) >= 0;
}

function requireConversation_(id, user) {
  var row = rows_(sheet_('Conversations')).find(function(r) { return r[0] === id; });
  if (!row || !visible_(conversation_(row), user)) fail_('forbidden', 'Conversation not found or access denied.');
  return conversation_(row);
}

function message_(row) {
  return {
    id: String(row[0]),
    conversationId: String(row[1]),
    authorEmail: String(row[2]),
    authorName: String(row[3]),
    body: row[7] === true ? '' : String(row[4]),
    createdAt: String(row[5]),
    updatedAt: String(row[6]),
    deleted: row[7] === true,
    parentId: String(row[8] || ''),
    reactions: row[7] === true ? {} : storedReactions_(row[9]),
    clientId: String(row[10] || ''),
    attachment: row[7] === true ? null : parseJson_(row[11], null)
  };
}

function bootstrap_(user) {
  var throughByConvo = Object.create(null);
  rows_(sheet_('ReadReceipts')).forEach(function(r) {
    if (r[0] === user.email) throughByConvo[String(r[1])] = String(r[2]);
  });
  
  var convos = rows_(sheet_('Conversations')).map(conversation_).filter(function(c) {
    return visible_(c, user);
  });
  
  var byId = Object.create(null);
  convos.forEach(function(c) { byId[c.id] = c; });
  
  rows_(sheet_('Messages')).forEach(function(r) {
    var c = byId[String(r[1])];
    if (!c) return;
    if (String(r[5]) > c.lastActivity) c.lastActivity = String(r[5]);
    if (r[7] !== true && r[2] !== user.email && String(r[5]) > (throughByConvo[c.id] || '')) {
      c.unread++;
    }
  });
  
  return {
    user: user,
    people: activeUsers_().map(person_),
    conversations: convos
  };
}

function createConversation_(payload, user) {
  var kind = payload.kind;
  if (['channel', 'group', 'dm'].indexOf(kind) < 0) fail_('bad_request', 'Invalid conversation type.');
  
  // Safe default naming for Direct Messages
  var name = (kind === 'dm' && !payload.name) ? 'Direct Message' : text_(payload.name, 80, 'Conversation name');
  var description = typeof payload.description === 'string' ? payload.description.trim().slice(0, 300) : '';
  
  if (kind !== 'channel' && (!Array.isArray(payload.members) || payload.members.some(function(e) { return typeof e !== 'string'; }))) {
    fail_('bad_request', 'Select valid teammates.');
  }
  
  var members = kind === 'channel' ? [] : Array.from(new Set([user.email].concat(payload.members)));
  var activeEmails = activeUsers_().map(function(r) { return r[0]; });
  
  if (kind !== 'channel' && (members.length < 2 || members.length > 30 || members.some(function(e) { return activeEmails.indexOf(e) < 0; }))) {
    fail_('bad_request', 'Choose between 1 and 29 active teammates.');
  }
  
  if (kind === 'dm') {
    if (members.length !== 2) fail_('bad_request', 'Direct messages require exactly two people.');
    var existing = rows_(sheet_('Conversations')).map(conversation_).find(function(c) {
      return c.kind === 'dm' && c.members.slice().sort().join('|') === members.slice().sort().join('|');
    });
    if (existing) return existing;
  }
  
  if (kind === 'channel') {
    name = name.toLowerCase().replace(/\s+/g, '-');
    if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(name)) fail_('bad_request', 'Channel names must use lowercase letters, numbers, and hyphens.');
    if (rows_(sheet_('Conversations')).some(function(r) { return r[3] === 'channel' && r[1] === name; })) {
      fail_('duplicate', 'A channel with that name already exists.');
    }
  }
  
  var row = [Utilities.getUuid(), cell_(name), cell_(description), kind, JSON.stringify(members), user.email, new Date().toISOString()];
  sheet_('Conversations').appendRow(row);
  invalidateSheetCache_('Conversations');
  return conversation_(row);
}

function leaveConversation_(payload, user) {
  var c = requireConversation_(payload.conversationId, user);
  if (c.kind !== 'group') fail_('bad_request', 'You can only leave group conversations.');
  
  var sheet = sheet_('Conversations'), records = rows_(sheet);
  var index = records.findIndex(function(r) { return r[0] === c.id; });
  if (index < 0) fail_('not_found', 'Conversation not found.');
  
  var members = c.members.filter(function(e) { return e !== user.email; });
  sheet.getRange(index + 2, 5).setValue(JSON.stringify(members));
  invalidateSheetCache_('Conversations');
  return { ok: true };
}

function listMessages_(payload, user) {
  requireConversation_(payload.conversationId, user);
  var query = String(payload.query || '').trim().toLowerCase().slice(0, 200);
  var all = rows_(sheet_('Messages')).filter(function(r) { return r[1] === payload.conversationId; });
  
  var before = payload.beforeId ? all.findIndex(function(r) { return r[0] === payload.beforeId; }) : all.length;
  if (before < 0) fail_('bad_request', 'Pagination cursor is invalid. Refresh conversation.');
  
  var candidates = all.filter(function(r, i) {
    return i < before && (!payload.before || String(r[5]) < payload.before) &&
           (query ? r[7] !== true && String(r[4]).toLowerCase().indexOf(query) >= 0 : !r[8]);
  });
  
  var requested = Number(payload.limit);
  var count = Number.isFinite(requested) ? Math.min(200, Math.max(1, Math.floor(requested))) : 100;
  var page = candidates.slice(-count);
  var ids = new Set(page.map(function(r) { return r[0]; }));
  
  var visible = query ? page : all.filter(function(r) { return ids.has(r[0]) || ids.has(r[8]); });
  
  return {
    messages: visible.map(message_),
    hasMore: candidates.length > count,
    nextBeforeId: page.length ? page[0][0] : '',
    readThrough: all.length ? String(all[all.length - 1][5]) : ''
  };
}

function searchMessages_(payload, user) {
  var query = text_(payload.query, 100, 'Search query').toLowerCase();
  var allowedConvos = rows_(sheet_('Conversations')).map(conversation_).filter(function(c) {
    return visible_(c, user);
  });
  var allowedIds = new Set(allowedConvos.map(function(c) { return c.id; }));
  
  var matches = rows_(sheet_('Messages')).filter(function(r) {
    return allowedIds.has(r[1]) && r[7] !== true && String(r[4]).toLowerCase().indexOf(query) >= 0;
  }).slice(-50);
  
  return { messages: matches.map(message_) };
}

function getThread_(payload, user) {
  requireConversation_(payload.conversationId, user);
  return {
    messages: rows_(sheet_('Messages')).filter(function(r) {
      return r[1] === payload.conversationId && (r[0] === payload.parentId || r[8] === payload.parentId);
    }).map(message_)
  };
}

function sendMessage_(payload, user) {
  requireConversation_(payload.conversationId, user);
  var body = payload.attachment ? String(payload.body || '').slice(0, 4000) : text_(payload.body, 4000, 'Message');
  var clientId = text_(payload.clientId, 100, 'Client Identifier');
  
  var messages = rows_(sheet_('Messages'));
  var existing = messages.find(function(r) { return r[2] === user.email && r[10] === clientId; });
  if (existing) {
    if (existing[1] !== payload.conversationId || String(existing[8]) !== String(payload.parentId || '')) {
      fail_('duplicate', 'Client ID collision across conversations or threads.');
    }
    return message_(existing);
  }
  
  var parent = payload.parentId || '';
  if (parent && !messages.some(function(r) { return r[0] === parent && r[1] === payload.conversationId && !r[8] && r[7] !== true; })) {
    fail_('bad_request', 'Thread parent message is unavailable.');
  }
  
  var attachmentJson = payload.attachment ? JSON.stringify(payload.attachment) : '';
  var now = new Date().toISOString();
  var row = [
    Utilities.getUuid(),
    payload.conversationId,
    user.email,
    cell_(user.name),
    cell_(body),
    now,
    now,
    false,
    parent,
    '{}',
    clientId,
    attachmentJson
  ];
  
  sheet_('Messages').appendRow(row);
  invalidateSheetCache_('Messages');
  
  try {
    if (typeof enqueuePush_ === 'function') enqueuePush_(row);
  } catch(err) {
    Logger.log('Push notification queueing failed: ' + err);
  }
  
  return message_(row);
}

function mutateMessage_(payload, user) {
  var sheet = sheet_('Messages'), records = rows_(sheet);
  var index = records.findIndex(function(r) { return r[0] === payload.messageId; });
  if (index < 0) fail_('not_found', 'Message not found.');
  
  var row = records[index];
  requireConversation_(row[1], user);
  if (row[7] === true) fail_('bad_request', 'This message has already been deleted.');
  
  if (payload.action === 'react') {
    var emoji = String(payload.emoji || '');
    if (['thumbsup','heart','check','eyes','tada','fire'].indexOf(emoji) < 0) fail_('bad_request', 'Unsupported reaction emoji.');
    var reactions = storedReactions_(row[9]);
    var people = reactions[emoji] || [];
    var pos = people.indexOf(user.email);
    if (pos >= 0) people.splice(pos, 1); else people.push(user.email);
    reactions[emoji] = people;
    row[9] = JSON.stringify(reactions);
  } else {
    if (row[2] !== user.email && !(payload.action === 'deleteMessage' && user.role === 'admin')) {
      fail_('forbidden', 'You can only edit or delete your own messages.');
    }
    if (payload.action === 'deleteMessage') {
      row[4] = '';
      row[7] = true;
      row[9] = '{}';
      row[11] = '';
    } else {
      row[4] = cell_(text_(payload.body, 4000, 'Message body'));
    }
    row[6] = new Date().toISOString();
  }
  
  sheet.getRange(index + 2, 1, 1, row.length).setValues([row]);
  invalidateSheetCache_('Messages');
  return message_(row);
}

function markRead_(payload, user) {
  requireConversation_(payload.conversationId, user);
  var time = new Date(payload.through);
  if (!Number.isFinite(time.getTime()) || time.getTime() > Date.now() + 5000) {
    fail_('bad_request', 'Invalid read timestamp.');
  }
  var through = time.toISOString();
  var sheet = sheet_('ReadReceipts'), records = rows_(sheet);
  var index = records.findIndex(function(r) { return r[0] === user.email && r[1] === payload.conversationId; });
  
  if (index < 0) {
    sheet.appendRow([user.email, payload.conversationId, through]);
  } else if (String(records[index][2]) < through) {
    sheet.getRange(index + 2, 3).setValue(through);
  }
  invalidateSheetCache_('ReadReceipts');
  return { ok: true };
}

// ============================================================================
// 5. ATTACHMENT / FILE UPLOADS
// ============================================================================

function getUploadsFolder_() {
  var props = PropertiesService.getScriptProperties();
  var folderId = props.getProperty('UPLOADS_FOLDER_ID');
  if (folderId) {
    try { return DriveApp.getFolderById(folderId); } catch(e) {}
  }
  var folder = DriveApp.createFolder('Hays + Sons Messaging Attachments');
  props.setProperty('UPLOADS_FOLDER_ID', folder.getId());
  return folder;
}

function uploadAttachment_(payload, user) {
  var base64 = text_(payload.base64, 15000000, 'Base64 data');
  var fileName = text_(payload.fileName, 255, 'Filename');
  var mimeType = text_(payload.mimeType, 100, 'MIME type');
  
  // Safely strip standard browser Data URI scheme prefix if present
  if (base64.indexOf(',') >= 0) {
    base64 = base64.split(',')[1];
  }
  
  var decoded = Utilities.base64Decode(base64);
  var blob = Utilities.newBlob(decoded, mimeType, fileName);
  var folder = getUploadsFolder_();
  var file = folder.createFile(blob);
  
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  
  return {
    id: file.getId(),
    name: file.getName(),
    size: file.getSize(),
    mimeType: file.getMimeType(),
    url: file.getUrl(),
    downloadUrl: 'https://drive.google.com/uc?export=download&id=' + file.getId()
  };
}

// ============================================================================
// 6. REAL-TIME PRESENCE (High-speed batch CacheService)
// ============================================================================

function heartbeat_(user) {
  var cache = CacheService.getScriptCache();
  cache.put('presence_' + user.email, String(Date.now()), 120);
  return { ok: true };
}

function getPresence_() {
  var cache = CacheService.getScriptCache();
  var users = activeUsers_();
  var keys = users.map(function(u) { return 'presence_' + u[0]; });
  var cached = cache.getAll(keys); // Single network call
  var online = [];
  users.forEach(function(u) {
    if (cached['presence_' + u[0]]) online.push(u[0]);
  });
  return { onlineEmails: online };
}

// ============================================================================
// 7. SALES DASHBOARD & REPORTING
// ============================================================================

function salesDashboard_(payload) {
  payload = payload || {};
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('SALES_SPREADSHEET_ID') || '1Ba1IEJEOb3ILhsZrOZSHCOT5-6pELnwGT-inUcVMcTk';
  var tab = props.getProperty('SALES_SHEET_NAME') || 'Estimator_Sales_Report.xls (6).csv';
  
  var db;
  try { db = SpreadsheetApp.openById(id); }
  catch(err) { fail_('sales_access', 'Deployment owner lacks permission to open the sales spreadsheet.'); }
  
  var sheet = db.getSheetByName(tab);
  if (!sheet) fail_('sales_configuration', 'Sales report tab "' + tab + '" was not found.');
  
  var count = sheet.getLastRow(), columns = sheet.getLastColumn();
  if (count > 25000) fail_('sales_limit', 'The sales report exceeds 25,000 rows. Narrow the source report.');
  if (!count || !columns) fail_('sales_headers', 'The sales sheet contains no data.');
  
  var values = sheet.getRange(1, 1, count, Math.min(columns, 60)).getValues();
  var headers = values[0].map(function(v) { return String(v || '').trim().toLowerCase(); });
  
  var required = ['Job Number','Customer','Estimator','Date Received','Division','Total Estimates','Job Status'];
  var missing = required.filter(function(h) { return headers.indexOf(h.toLowerCase()) < 0; });
  if (missing.length) fail_('sales_headers', 'Missing columns: ' + missing.join(', '));
  
  var timezone = db.getSpreadsheetTimeZone();
  var invalidDates = 0, invalidEstimates = 0, skippedRows = 0;
  
  function field(row, name) {
    var i = headers.indexOf(name.toLowerCase());
    return i < 0 ? '' : row[i];
  }
  function text(value, limit) {
    return value == null ? '' : String(value).trim().slice(0, limit || 300);
  }
  
  var jobs = [];
  var totalEstimatedSum = 0;
  var validEstimateCount = 0;
  var statusBreakdown = Object.create(null);
  var divisionBreakdown = Object.create(null);
  var estimatorBreakdown = Object.create(null);
  
  for (var index = 0; index < values.length - 1; index++) {
    var row = values[index + 1];
    var number = text(field(row, 'Job Number'));
    if (!number) {
      if (row.some(function(v) { return v !== '' && v != null; })) skippedRows++;
      continue;
    }
    
    var estimateValue = field(row, 'Total Estimates');
    var estimate = salesAmount_(estimateValue);
    if (estimate == null && estimateValue !== '' && estimateValue != null) invalidEstimates++;
    
    var received = salesDate_(field(row, 'Date Received'), timezone);
    if (!received && field(row, 'Date Received') !== '') invalidDates++;
    
    var inspected = salesDate_(field(row, 'Date Inspected'), timezone);
    var status = text(field(row, 'Job Status'));
    var division = text(field(row, 'Division'));
    var estimator = text(field(row, 'Estimator'));
    
    // Apply filters BEFORE accumulating aggregations so metrics reflect the filtered dataset
    if (payload.division && division.toLowerCase() !== payload.division.toLowerCase()) continue;
    if (payload.status && status.toLowerCase() !== payload.status.toLowerCase()) continue;
    if (payload.estimator && estimator.toLowerCase() !== payload.estimator.toLowerCase()) continue;
    
    if (estimate != null) {
      totalEstimatedSum += estimate;
      validEstimateCount++;
    }
    if (status) statusBreakdown[status] = (statusBreakdown[status] || 0) + 1;
    if (division) divisionBreakdown[division] = (divisionBreakdown[division] || 0) + 1;
    if (estimator) estimatorBreakdown[estimator] = (estimatorBreakdown[estimator] || 0) + 1;
    
    jobs.push({
      id: 'sales-row-' + (index + 2),
      sourceRow: index + 2,
      jobNumber: number,
      customer: text(field(row, 'Customer')),
      estimator: estimator,
      insuranceCarrier: text(field(row, 'Insurance Carrier')),
      primaryAdjuster: text(field(row, 'Primary Adjuster')),
      referredBy: text(field(row, 'Referred By')),
      foreman: text(field(row, 'Foreman')),
      receivedDate: received,
      division: division,
      inspectedDate: inspected,
      marketingPerson: text(field(row, 'Marketing Person')),
      estimate: estimate,
      status: status,
      closingReason: text(field(row, 'Reason For Closing')),
      journalNote: text(field(row, 'Last Journal Note Entered'), 12000)
    });
  }
  
  var totalMatching = jobs.length;
  if (payload.limit) {
    var lim = Math.max(1, Math.min(2000, Number(payload.limit)));
    var off = Math.max(0, Number(payload.offset) || 0);
    jobs = jobs.slice(off, off + lim);
  }
  
  return {
    source: {
      spreadsheetId: id,
      title: db.getName(),
      sheetName: tab,
      sheetId: sheet.getSheetId(),
      url: db.getUrl() + '#gid=' + sheet.getSheetId(),
      timezone: timezone
    },
    fetchedAt: new Date().toISOString(),
    today: Utilities.formatDate(new Date(), timezone, 'yyyy-MM-dd'),
    summary: {
      totalJobsCount: validEstimateCount + (invalidEstimates || 0),
      totalEstimatedRevenue: Math.round(totalEstimatedSum * 100) / 100,
      averageEstimate: validEstimateCount ? Math.round((totalEstimatedSum / validEstimateCount) * 100) / 100 : 0,
      statusBreakdown: statusBreakdown,
      divisionBreakdown: divisionBreakdown,
      estimatorBreakdown: estimatorBreakdown
    },
    totalMatchingJobs: totalMatching,
    jobs: jobs,
    quality: {
      invalidDates: invalidDates,
      invalidEstimates: invalidEstimates,
      skippedRows: skippedRows
    }
  };
}

function salesAmount_(value) {
  if (value === '' || value == null) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  var raw = String(value).trim().replace(/^\$/, '').replace(/,/g, '');
  if (/^\(\$?\d+(?:\.\d+)?\)$/.test(raw)) raw = '-' + raw.slice(1, -1).replace(/^\$/, '');
  return /^[+-]?\d+(?:\.\d+)?$/.test(raw) && Number.isFinite(Number(raw)) ? Number(raw) : null;
}

function salesDate_(value, timezone) {
  if (value === '' || value == null) return '';
  if (Object.prototype.toString.call(value) === '[object Date]') {
    return isNaN(value.getTime()) ? '' : Utilities.formatDate(value, timezone, 'yyyy-MM-dd');
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 1 || value > 2958465) return '';
    return new Date(Date.UTC(1899, 11, 30) + Math.floor(value) * 86400000).toISOString().slice(0, 10);
  }
  var raw = String(value).trim();
  var parts = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s]|$)/);
  var year, month, day;
  if (parts) {
    year = Number(parts[1]); month = Number(parts[2]); day = Number(parts[3]);
  } else {
    parts = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4}|\d{2})(?:\s|$)/);
    if (!parts) return '';
    year = Number(parts[3]);
    if (year < 100) year += year < 70 ? 2000 : 1900;
    month = Number(parts[1]); day = Number(parts[2]);
  }
  var date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? date.toISOString().slice(0, 10) : '';
}

// ============================================================================
// 8. WEB PUSH NOTIFICATIONS
// ============================================================================

function setupPushMessaging() {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var config = pushSettings_();
    if (!config.publicKey || !config.url || !config.secret) {
      fail_('not_configured', 'Set VAPID_PUBLIC_KEY, PUSH_RELAY_URL, and PUSH_RELAY_SECRET in Script Properties.');
    }
    var db = db_();
    Object.keys(PUSH_SCHEMA).forEach(function(name) {
      var sheet = db.getSheetByName(name) || db.insertSheet(name);
      if (!sheet.getLastRow()) {
        sheet.appendRow(PUSH_SCHEMA[name]);
        sheet.setFrozenRows(1);
      }
    });
    if (!ScriptApp.getProjectTriggers().some(function(t) { return t.getHandlerFunction() === 'deliverPushQueue'; })) {
      ScriptApp.newTrigger('deliverPushQueue').timeBased().everyMinutes(1).create();
    }
    return { ok: true };
  } finally { lock.releaseLock(); }
}

function pushSettings_() {
  var props = PropertiesService.getScriptProperties();
  var key = props.getProperty('VAPID_PUBLIC_KEY') || '';
  var url = props.getProperty('PUSH_RELAY_URL') || '';
  var secret = props.getProperty('PUSH_RELAY_SECRET') || '';
  if (key && !/^[A-Za-z0-9_-]{87}$/.test(key)) fail_('push_configuration', 'Invalid VAPID_PUBLIC_KEY.');
  if (url && !/^https:\/\/[a-z0-9.-]+(?::443)?(?:\/[^\s#]*)?$/i.test(url)) fail_('push_configuration', 'PUSH_RELAY_URL must use HTTPS.');
  if (secret && secret.length < 32) fail_('push_configuration', 'PUSH_RELAY_SECRET must be at least 32 characters.');
  return { publicKey: key, url: url, secret: secret };
}

function pushConfig_() {
  var c = pushSettings_(), db = db_();
  if (!c.publicKey || !c.url || !c.secret) {
    return { enabled: false, publicKey: '', reason: 'Web push not configured in script properties.' };
  }
  if (!db.getSheetByName('PushSubscriptions') || !db.getSheetByName('PushQueue') || 
      !ScriptApp.getProjectTriggers().some(function(t) { return t.getHandlerFunction() === 'deliverPushQueue'; })) {
    return { enabled: false, publicKey: c.publicKey, reason: 'Administrator needs to run setupPushMessaging().' };
  }
  return { enabled: true, publicKey: c.publicKey };
}

function pushEndpoint_(endpoint) {
  if (typeof endpoint !== 'string' || endpoint.length > 2048) fail_('bad_request', 'Invalid push endpoint.');
  var match = /^https:\/\/([^\/?#]+)(\/[^#]*)$/.exec(endpoint);
  var host = match && match[1].toLowerCase();
  if (!host || !(host === 'fcm.googleapis.com' || host === 'updates.push.services.mozilla.com' ||
      /^[a-z0-9-]+\.push\.services\.mozilla\.com$/.test(host) ||
      /^[a-z0-9-]+\.push\.apple\.com$/.test(host) ||
      /^[a-z0-9-]+\.notify\.windows\.com$/.test(host))) {
    fail_('bad_request', 'Unsupported push provider.');
  }
  return endpoint;
}

function validPushSubscription_(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail_('bad_request', 'Invalid push subscription.');
  var endpoint = pushEndpoint_(value.endpoint), keys = value.keys || {};
  if (!/^[A-Za-z0-9_-]{87}$/.test(keys.p256dh || '') || !/^[A-Za-z0-9_-]{22}$/.test(keys.auth || '')) {
    fail_('bad_request', 'Invalid push encryption keys.');
  }
  var expiry = value.expirationTime;
  if (expiry != null && (typeof expiry !== 'number' || !Number.isFinite(expiry) || expiry <= Date.now())) {
    fail_('bad_request', 'Push subscription expired.');
  }
  return { endpoint: endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth }, expirationTime: expiry == null ? null : expiry };
}

function pushStatus_(payload, user) {
  var config = pushConfig_(), sub = sheet_('PushSubscriptions');
  config.subscribed = !!(config.enabled && typeof payload.endpoint === 'string' && sub && rows_(sub).some(function(r) {
    return r[0] === digest_(payload.endpoint) && r[1] === user.email && equal_(r[2], digest_(payload.sessionToken)) &&
           r[6] === config.publicKey && new Date(r[4]).getTime() > Date.now();
  }));
  return config;
}

function subscribePush_(payload, user) {
  var config = pushConfig_();
  if (!config.enabled) fail_('push_unavailable', config.reason);
  prunePushSubscriptions_();
  
  var sub = validPushSubscription_(payload.subscription);
  var hash = digest_(payload.sessionToken);
  var sessions = rows_(sheet_('Sessions'));
  var session = sessions.find(function(r) { return equal_(r[0], hash); });
  if (!session) fail_('session_expired', 'Session expired. Please sign in again.');
  
  var expiry = new Date(session[2]).getTime();
  if (sub.expirationTime != null) expiry = Math.min(expiry, sub.expirationTime);
  
  var sheet = sheet_('PushSubscriptions'), records = rows_(sheet);
  var id = digest_(sub.endpoint);
  var index = records.findIndex(function(r) { return r[0] === id; });
  
  if (index < 0 && records.filter(function(r) { return r[1] === user.email; }).length >= 10) {
    fail_('push_limit', 'Limit of 10 notification subscriptions reached per user.');
  }
  
  var row = [id, user.email, hash, JSON.stringify(sub), new Date(expiry).toISOString(), new Date().toISOString(), config.publicKey];
  if (index < 0) sheet.appendRow(row);
  else sheet.getRange(index + 2, 1, 1, row.length).setValues([row]);
  
  invalidateSheetCache_('PushSubscriptions');
  return { ok: true, subscribed: true };
}

function unsubscribePush_(payload, user) {
  var endpoint = pushEndpoint_(payload.endpoint);
  var id = digest_(endpoint);
  var hash = digest_(payload.sessionToken);
  bulkPruneSheet_(sheet_('PushSubscriptions'), function(r) {
    return !(r[0] === id && r[1] === user.email && equal_(r[2], hash));
  });
  return { ok: true };
}

function revokePushSession_(hash) {
  var sheet = db_().getSheetByName('PushSubscriptions');
  if (!sheet) return;
  bulkPruneSheet_(sheet, function(r) { return !equal_(r[2], hash); });
}

function prunePushSubscriptions_() {
  var sheet = db_().getSheetByName('PushSubscriptions');
  if (!sheet) return;
  var sessions = rows_(sheet_('Sessions'));
  var users = activeUsers_();
  var key = PropertiesService.getScriptProperties().getProperty('VAPID_PUBLIC_KEY');
  var now = Date.now();
  
  bulkPruneSheet_(sheet, function(r) {
    return new Date(r[4]).getTime() > now &&
           r[6] === key &&
           users.some(function(u) { return u[0] === r[1]; }) &&
           sessions.some(function(s) { return equal_(s[0], r[2]) && s[1] === r[1] && new Date(s[2]).getTime() > now; });
  });
}

function enqueuePush_(messageRow) {
  try {
    var db = db_();
    var queue = db.getSheetByName('PushQueue');
    var subscriptions = db.getSheetByName('PushSubscriptions');
    if (!queue || !subscriptions) return;
    
    var convoRow = rows_(sheet_('Conversations')).find(function(r) { return r[0] === messageRow[1]; });
    if (!convoRow) return;
    
    var convo = conversation_(convoRow);
    var now = Date.now();
    var targets = rows_(subscriptions).filter(function(r) {
      return r[1] !== messageRow[2] && new Date(r[4]).getTime() > now && visible_(convo, { email: r[1] });
    }).map(function(r) {
      return { id: r[0], email: r[1], sessionHash: r[2], attempts: 0, nextAt: 0 };
    });
    
    if (targets.length) {
      queue.appendRow([messageRow[0], messageRow[1], messageRow[2], messageRow[5], JSON.stringify(targets), 0, new Date().toISOString()]);
      invalidateSheetCache_('PushQueue');
    }
  } catch(err) {
    Logger.log('Push enqueue error: ' + err);
  }
}

function deliverPushQueue() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return;
  try {
    var config = pushConfig_();
    if (!config.enabled) return;
    prunePushSubscriptions_();
    
    var queue = sheet_('PushQueue'), jobs = rows_(queue);
    var subscriptions = rows_(sheet_('PushSubscriptions'));
    var messages = rows_(sheet_('Messages'));
    var conversations = rows_(sheet_('Conversations'));
    var receipts = rows_(sheet_('ReadReceipts'));
    var deliveries = [], states = [], gone = [], now = Date.now();
    
    jobs.forEach(function(job, index) {
      try {
        if (new Date(job[6]).getTime() > now) return;
        var pending = storedList_(job[4]), remaining = [];
        var msg = messages.find(function(m) { return m[0] === job[0] && m[7] !== true; });
        var convoRow = conversations.find(function(c) { return c[0] === job[1]; });
        
        if (msg && convoRow && now - new Date(job[3]).getTime() < 86400000) {
          var convo = conversation_(convoRow);
          pending.forEach(function(target) {
            var id = target && target.id;
            if (!id) return;
            if (Number(target.attempts) >= 5) return;
            
            var sub = subscriptions.find(function(s) { return s[0] === id; });
            if (!sub || sub[1] !== target.email || !equal_(sub[2], target.sessionHash) || sub[1] === job[2] || !visible_(convo, { email: sub[1] })) return;
            if (receipts.some(function(r) { return r[0] === sub[1] && r[1] === job[1] && String(r[2]) >= String(job[3]); })) return;
            
            var subscription = parseJson_(sub[3], null);
            if (!subscription) { gone.push(id); return; }
            
            remaining.push(target);
            if (deliveries.length < 50 && (Number(target.nextAt) || 0) <= now) {
              deliveries.push({
                id: job[0] + '|' + id,
                subscription: subscription,
                payload: {
                  title: 'Hays + Sons',
                  body: 'You have a new message.',
                  tag: 'conversation-' + job[1],
                  data: { conversationId: job[1], messageId: job[0] }
                }
              });
            }
          });
        }
        states.push({ index: index, row: job, remaining: remaining });
      } catch(err) {
        states.push({ index: index, row: job, remaining: [] });
      }
    });
    
    var results = [];
    if (deliveries.length) {
      var settings = pushSettings_();
      try {
        var response = UrlFetchApp.fetch(settings.url, {
          method: 'post',
          contentType: 'application/json',
          headers: { Authorization: 'Bearer ' + settings.secret },
          payload: JSON.stringify({ deliveries: deliveries }),
          muteHttpExceptions: true,
          followRedirects: false
        });
        if (response.getResponseCode() === 200) {
          var reply = JSON.parse(response.getContentText());
          if (Array.isArray(reply.results)) results = reply.results;
        }
      } catch(err) {
        Logger.log('Relay network error: ' + err);
      }
    }
    
    states.reverse().forEach(function(state) {
      var remaining = state.remaining.filter(function(target) {
        var deliveryId = state.row[0] + '|' + target.id;
        if (!deliveries.some(function(d) { return d.id === deliveryId; })) return true;
        var res = results.find(function(r) { return r.id === deliveryId; });
        if (res && res.status === 'gone') { gone.push(target.id); return false; }
        if (res && res.status === 'delivered') return false;
        target.attempts = (Number(target.attempts) || 0) + 1;
        target.nextAt = now + Math.pow(2, target.attempts - 1) * 60000;
        return target.attempts < 5;
      });
      
      if (!remaining.length) {
        queue.deleteRow(state.index + 2);
      } else {
        state.row[4] = JSON.stringify(remaining);
        state.row[6] = new Date(Math.min.apply(null, remaining.map(function(t) { return t.nextAt; }))).toISOString();
        queue.getRange(state.index + 2, 1, 1, state.row.length).setValues([state.row]);
      }
    });
    
    if (gone.length) {
      bulkPruneSheet_(sheet_('PushSubscriptions'), function(r) { return gone.indexOf(r[0]) < 0; });
    }
    invalidateSheetCache_();
  } finally { lock.releaseLock(); }
}

// ============================================================================
// 9. SCHEDULED MAINTENANCE
// ============================================================================

function cleanupSessions() {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var now = Date.now();
    var removed = bulkPruneSheet_(sheet_('Sessions'), function(r) {
      return new Date(r[2]).getTime() > now;
    });
    prunePushSubscriptions_();
    if (removed) Logger.log('Cleaned up ' + removed + ' expired sessions.');
  } finally { lock.releaseLock(); }
}

// ============================================================================
// 10. REQUEST ROUTER & HTTP CONTROLLERS
// ============================================================================

function handle_(payload) {
  // Public routes
  if (payload.action === 'registrationInfo') return registrationInfo_();
  if (payload.action === 'login') return login_(payload);
  if (payload.action === 'register') return register_(payload);
  
  // Authenticated routes
  var user = authenticate_(payload);
  
  switch(payload.action) {
    case 'session': return { user: user };
    case 'changePassword': return changePassword_(payload, user);
    case 'updateProfile': return updateProfile_(payload, user);
    case 'bootstrap': return bootstrap_(user);
    case 'heartbeat': return heartbeat_(user);
    case 'getPresence': return getPresence_();
    case 'salesDashboard': return salesDashboard_(payload);
    
    case 'createConversation': return createConversation_(payload, user);
    case 'leaveConversation': return leaveConversation_(payload, user);
    case 'listMessages': return listMessages_(payload, user);
    case 'searchMessages': return searchMessages_(payload, user);
    case 'getThread': return getThread_(payload, user);
    case 'sendMessage': return sendMessage_(payload, user);
    case 'uploadAttachment': return uploadAttachment_(payload, user);
    
    case 'editMessage':
    case 'deleteMessage':
    case 'react': return mutateMessage_(payload, user);
    case 'markRead': return markRead_(payload, user);
    
    case 'pushConfig': return pushConfig_();
    case 'pushStatus': return pushStatus_(payload, user);
    case 'subscribePush': return subscribePush_(payload, user);
    case 'unsubscribePush': return unsubscribePush_(payload, user);
    
    case 'logout':
      var hash = digest_(payload.sessionToken);
      bulkPruneSheet_(sheet_('Sessions'), function(r) { return !equal_(r[0], hash); });
      revokePushSession_(hash);
      return { ok: true };
      
    default: fail_('unknown_action', 'Unknown action requested.');
  }
}

function doPost(e) {
  var lock = null;
  try {
    var contents = e && e.postData && e.postData.contents;
    if (!contents || contents.length > 25000000) fail_('bad_request', 'Invalid request body.');
    
    var payload;
    try { payload = JSON.parse(contents); } catch(err) { fail_('bad_request', 'Malformed JSON payload.'); }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload) || typeof payload.action !== 'string') {
      fail_('bad_request', 'Invalid payload structure.');
    }
    
    // Acquire concurrency lock only on database mutations
    if (MUTATIONS.indexOf(payload.action) >= 0) {
      var candidate = LockService.getScriptLock();
      try { candidate.waitLock(30000); }
      catch(lockErr) { fail_('busy', 'The workspace is currently busy. Please retry in a few moments.'); }
      lock = candidate;
    }
    
    return json_({ ok: true, data: handle_(payload) });
  } catch(err) {
    if (!err || !err.code) Logger.log('Unhandled error: ' + ((err && err.stack) ? err.stack : err));
    return json_({
      ok: false,
      error: (err && err.message) || 'Request failed.',
      code: (err && err.code) || 'server_error'
    });
  } finally {
    if (lock) lock.releaseLock();
  }
}

function doGet() {
  return json_({
    ok: true,
    data: {
      app: 'Hays + Sons Team Messaging',
      version: 8.1,
      configured: !!PropertiesService.getScriptProperties().getProperty('MESSAGING_SPREADSHEET_ID'),
      usernameType: 'email',
      features: [
        'email-password-auth','open-or-invite-registration','profile-management',
        'sales-dashboard','sales-aggregations','realtime-presence','drive-attachments',
        'global-search','batch-pruning','web-push-relay','thread-paging'
      ]
    }
  });
}
