/** Hays + Sons Team Messaging. Deploy this in a NEW Apps Script project.
 * Run setupMessaging() in the editor, create the first admin with createUser(),
 * then deploy a web app executing as Me, accessible to Anyone.
 * All data requests require an application session; registration is invite-only.
 * Company email is the username. Passwords and session tokens are stored as hashes.
 * Setup creates empty tables and preserves the existing spreadsheet and accounts.
 */
var SCHEMA = {
  Users: ['Email','Name','Role','Salt','PasswordHash','Active','FailedAttempts','LockedUntil'],
  Sessions: ['TokenHash','Email','ExpiresAt'],
  Conversations: ['Id','Name','Description','Kind','MembersJson','CreatedBy','CreatedAt'],
  Messages: ['Id','ConversationId','AuthorEmail','AuthorName','Body','CreatedAt','UpdatedAt','Deleted','ParentId','ReactionsJson','ClientId'],
  ReadReceipts: ['Email','ConversationId','ReadThrough']
};
var PASSWORD_ITERATIONS = 1500; // Same iterated HMAC derivation as the document suite.
var MUTATIONS = ['login','register','logout','createConversation','sendMessage','editMessage','deleteMessage','react','markRead','subscribePush','unsubscribePush'];

function setupMessaging() {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var props = PropertiesService.getScriptProperties();
    var id = props.getProperty('MESSAGING_SPREADSHEET_ID');
    var db = id ? SpreadsheetApp.openById(id) : SpreadsheetApp.create('Hays + Sons - Team Messaging');
    Object.keys(SCHEMA).forEach(function(name) {
      var sheet = db.getSheetByName(name) || db.insertSheet(name);
      if (!sheet.getLastRow()) {
        sheet.appendRow(SCHEMA[name]);
        sheet.getRange(1,1,1,SCHEMA[name].length).setBackground('#dc2626').setFontColor('#ffffff').setFontWeight('bold');
        sheet.setFrozenRows(1);
      }
    });
    props.setProperty('MESSAGING_SPREADSHEET_ID', db.getId());
    if (!props.getProperty('REGISTRATION_MODE')) props.setProperty('REGISTRATION_MODE','invite');
    if (!props.getProperty('REGISTRATION_CODE')) props.setProperty('REGISTRATION_CODE',Utilities.getUuid());
    Logger.log('Messaging database: ' + db.getUrl());
    Logger.log('Registration invite code is in Project Settings > Script Properties > REGISTRATION_CODE.');
    return {spreadsheetUrl:db.getUrl()};
  } finally { lock.releaseLock(); }
}

function db_() {
  var id = PropertiesService.getScriptProperties().getProperty('MESSAGING_SPREADSHEET_ID');
  if (!id) fail_('not_configured','Run setupMessaging() in the Apps Script editor first.');
  return SpreadsheetApp.openById(id);
}
function sheet_(name) {
  var sheet=db_().getSheetByName(name);
  if(!sheet && SCHEMA[name])fail_('not_configured','Run setupMessaging() in the Apps Script editor to create the messaging tables.');
  return sheet;
}
function rows_(sheet) { var data = sheet.getDataRange().getValues(); return data.slice(1); }
function fail_(code,message) { var err = new Error(message); err.code = code; throw err; }
function json_(value) { return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON); }
function digest_(value) { return Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,value)); }
function hashPassword_(password,salt) {
  var hash = password;
  for (var i=0;i<PASSWORD_ITERATIONS;i++) hash = Utilities.base64Encode(Utilities.computeHmacSha256Signature(hash+salt,salt));
  return hash;
}
function equal_(a,b) { a=String(a); b=String(b); var diff=a.length ^ b.length; for(var i=0;i<Math.max(a.length,b.length);i++) diff |= (a.charCodeAt(i)||0) ^ (b.charCodeAt(i)||0); return diff===0; }
function text_(value,max,label) {
  if (typeof value !== 'string' || !value.trim() || value.length>max) fail_('bad_request',(label||'Text')+' is required and must be at most '+max+' characters.');
  return value.trim();
}
function password_(value) {
  if(typeof value!=='string' || !value.length || value.length>256)fail_('bad_request','Password is required and must be at most 256 characters.');
  return value;
}
function email_(value) {
  var email=text_(value,254,'Email').toLowerCase();
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail_('bad_request','Enter a valid email.');
  return email;
}
// Keep the existing email payload compatible, and accept username from other clients.
function accountEmail_(payload) {
  var email=email_(payload.email===undefined ? payload.username : payload.email);
  if(payload.username!==undefined && email_(payload.username)!==email)fail_('bad_request','Username must be your company email address.');
  return email;
}
// Prevent user text from being interpreted as a spreadsheet formula.
function cell_(value) { return /^[=+@-]/.test(String(value)) ? "'"+value : value; }
function person_(row) { return {email:String(row[0]),name:String(row[1]),role:String(row[2])}; }
function activeUsers_() { return rows_(sheet_('Users')).filter(function(r){return r[5]===true;}); }

/** Editor-only account administration; never exposed as an HTTP action. */
function createUser(email,name,password,role) {
  var lock=LockService.getScriptLock(); lock.waitLock(30000);
  try { return addUser_(email,name,password,role||'member'); }
  finally { lock.releaseLock(); }
}
/** Editor-only password reset. Existing sessions and notification access are revoked. */
function resetUserPassword(email,password) {
  var lock=LockService.getScriptLock();lock.waitLock(30000);
  try {
    email=email_(email);password=password_(password);
    if(password.length<10)fail_('weak_password','Password must be at least 10 characters.');
    var users=sheet_('Users'),records=rows_(users),index=records.findIndex(function(r){return r[0]===email;});
    if(index<0)fail_('not_found','Account not found.');
    var salt=Utilities.getUuid()+Utilities.getUuid();
    users.getRange(index+2,4,1,2).setValues([[salt,hashPassword_(password,salt)]]);
    users.getRange(index+2,7,1,2).setValues([[0,'']]);
    var sessions=sheet_('Sessions'),existing=rows_(sessions);
    for(var i=existing.length-1;i>=0;i--)if(existing[i][1]===email){revokePushSession_(existing[i][0]);sessions.deleteRow(i+2);}
    return {ok:true};
  } finally {lock.releaseLock();}
}
function addUser_(email,name,password,role) {
  email=email_(email); name=text_(name,80,'Name'); password=password_(password);
  if(password.length<10) fail_('weak_password','Password must be at least 10 characters.');
  if(['admin','member'].indexOf(role)<0) fail_('bad_request','Invalid role.');
  var users=sheet_('Users');
  if(rows_(users).some(function(r){return r[0]===email;})) fail_('user_exists','An account with that email already exists.');
  var salt=Utilities.getUuid()+Utilities.getUuid();
  users.appendRow([email,cell_(name),role,salt,hashPassword_(password,salt),true,0,'']);
  return {email:email,name:name,role:role};
}
function session_(user) {
  var token=Utilities.getUuid()+Utilities.getUuid();
  var expires=new Date(Date.now()+12*60*60*1000).toISOString();
  sheet_('Sessions').appendRow([digest_(token),user.email,expires]);
  return {token:token,expiresAt:expires,user:user};
}
function authenticate_(payload) {
  if(typeof payload.sessionToken!=='string' || !payload.sessionToken || payload.sessionToken.length>200) fail_('unauthorized','Please sign in.');
  var hash=digest_(payload.sessionToken);
  var session=rows_(sheet_('Sessions')).find(function(r){return equal_(r[0],hash) && new Date(r[2]).getTime()>Date.now();});
  if(!session) fail_('session_expired','Your session has expired. Please sign in again.');
  var user=activeUsers_().find(function(r){return r[0]===session[1];});
  if(!user) fail_('session_expired','Your account is no longer active.');
  return person_(user);
}
function login_(payload) {
  var email=accountEmail_(payload), password=password_(payload.password);
  var sheet=sheet_('Users'), rows=rows_(sheet), index=rows.findIndex(function(r){return r[0]===email;});
  if(index<0) fail_('invalid_credentials','Incorrect email or password.');
  var row=rows[index];
  if(row[5]!==true) fail_('invalid_credentials','Incorrect email or password.');
  if(new Date(row[7]).getTime()>Date.now()) fail_('account_locked','Too many attempts. Please try again in 15 minutes.');
  if(!equal_(hashPassword_(password,row[3]),row[4])) {
    var attempts=(new Date(row[7]).getTime()<=Date.now() ? 0 : Number(row[6])||0)+1;
    sheet.getRange(index+2,7,1,2).setValues([[attempts,attempts>=5 ? new Date(Date.now()+15*60*1000).toISOString() : '']]);
    fail_('invalid_credentials','Incorrect email or password.');
  }
  sheet.getRange(index+2,7,1,2).setValues([[0,'']]);
  return session_(person_(row));
}
function registrationInfo_() {
  var props=PropertiesService.getScriptProperties(), mode=(props.getProperty('REGISTRATION_MODE')||'invite').trim().toLowerCase();
  return {enabled:mode==='invite'||mode==='open',requiresInvite:mode!=='open',minPasswordLength:10,usernameType:'email'};
}
function register_(payload) {
  var info=registrationInfo_(), props=PropertiesService.getScriptProperties();
  if(!info.enabled) fail_('registration_closed','Registration is closed. Contact your administrator.');
  var code=props.getProperty('REGISTRATION_CODE');
  if(info.requiresInvite && (!code || !equal_(String(payload.inviteCode||''),code))) fail_('invalid_invite_code','The invite code is incorrect.');
  var domains=(props.getProperty('REGISTRATION_EMAIL_DOMAINS')||'').split(',').map(function(d){return d.trim().toLowerCase();}).filter(Boolean);
  var email=accountEmail_(payload);
  if(domains.length && domains.indexOf(email.split('@')[1])<0) fail_('domain_not_allowed','Use an approved company email address.');
  return session_(addUser_(email,payload.name,payload.password,'member'));
}
function conversation_(row) { return {id:String(row[0]),name:String(row[1]),description:String(row[2]),kind:String(row[3]),members:JSON.parse(row[4]||'[]'),createdBy:String(row[5]),createdAt:String(row[6]),lastActivity:String(row[6]),unread:0}; }
function visible_(conversation,user) { return conversation.kind==='channel' || conversation.members.indexOf(user.email)>=0; }
function requireConversation_(id,user) {
  var row=rows_(sheet_('Conversations')).find(function(r){return r[0]===id;});
  if(!row || !visible_(conversation_(row),user)) fail_('forbidden','This conversation is not available to you.');
  return conversation_(row);
}
function message_(row) { return {id:String(row[0]),conversationId:String(row[1]),authorEmail:String(row[2]),authorName:String(row[3]),body:row[7]===true ? '' : String(row[4]),createdAt:String(row[5]),updatedAt:String(row[6]),deleted:row[7]===true,parentId:String(row[8]),reactions:row[7]===true ? {} : JSON.parse(row[9]||'{}'),clientId:String(row[10])}; }
function bootstrap_(user) {
  var receipts=rows_(sheet_('ReadReceipts')).filter(function(r){return r[0]===user.email;});
  var messages=rows_(sheet_('Messages'));
  var conversations=rows_(sheet_('Conversations')).map(conversation_).filter(function(c){return visible_(c,user);});
  conversations.forEach(function(c){
    var receipt=receipts.find(function(r){return r[1]===c.id;}); var through=receipt ? String(receipt[2]) : '';
    messages.forEach(function(r){ if(r[1]===c.id){ if(String(r[5])>c.lastActivity)c.lastActivity=String(r[5]); if(r[7]!==true && r[2]!==user.email && String(r[5])>through)c.unread++; } });
  });
  return {user:user,people:activeUsers_().map(person_),conversations:conversations};
}
function createConversation_(payload,user) {
  var kind=payload.kind;
  if(['channel','group','dm'].indexOf(kind)<0) fail_('bad_request','Invalid conversation type.');
  var name=text_(payload.name,80,'Conversation name');
  var description=typeof payload.description==='string' ? payload.description.trim().slice(0,300) : '';
  if(kind!=='channel' && (!Array.isArray(payload.members) || payload.members.some(function(e){return typeof e!=='string';})))fail_('bad_request','Choose active teammates.');
  var members=kind==='channel' ? [] : Array.from(new Set([user.email].concat(payload.members)));
  var emails=activeUsers_().map(function(r){return r[0];});
  if(kind!=='channel' && (members.length<2 || members.length>30 || members.some(function(e){return emails.indexOf(e)<0;}))) fail_('bad_request','Choose between 1 and 29 active teammates.');
  if(kind==='dm') {
    if(members.length!==2) fail_('bad_request','Direct messages have exactly two people.');
    var existing=rows_(sheet_('Conversations')).map(conversation_).find(function(c){return c.kind==='dm' && c.members.slice().sort().join('|')===members.slice().sort().join('|');});
    if(existing)return existing;
  }
  if(kind==='channel') {
    name=name.toLowerCase().replace(/\s+/g,'-');
    if(!/^[a-z0-9][a-z0-9-]{0,79}$/.test(name))fail_('bad_request','Channel names use letters, numbers, and hyphens.');
    if(rows_(sheet_('Conversations')).some(function(r){return r[3]==='channel' && r[1]===name;}))fail_('duplicate','A channel with that name already exists.');
  }
  var row=[Utilities.getUuid(),cell_(name),cell_(description),kind,JSON.stringify(members),user.email,new Date().toISOString()];
  sheet_('Conversations').appendRow(row);
  return conversation_(row);
}
function listMessages_(payload,user) {
  requireConversation_(payload.conversationId,user);
  var query=String(payload.query||'').trim().toLowerCase().slice(0,200);
  var all=rows_(sheet_('Messages')).filter(function(r){return r[1]===payload.conversationId;});
  var before=payload.beforeId ? all.findIndex(function(r){return r[0]===payload.beforeId;}) : all.length;
  if(before<0)fail_('bad_request','The history cursor is unavailable. Reload the conversation.');
  var candidates=all.filter(function(r,i){return i<before && (!payload.before || String(r[5])<payload.before) && (query ? r[7]!==true && String(r[4]).toLowerCase().indexOf(query)>=0 : !r[8]);});
  var requested=Number(payload.limit),count=Number.isFinite(requested) ? Math.min(200,Math.max(1,Math.floor(requested))) : 100;
  var page=candidates.slice(-count),ids=new Set(page.map(function(r){return r[0];}));
  // Paginate root messages, then include their replies so an active thread cannot hide its parent.
  var visible=query ? page : all.filter(function(r){return ids.has(r[0]) || ids.has(r[8]);});
  return {messages:visible.map(message_),hasMore:candidates.length>count,nextBeforeId:page.length ? page[0][0] : '',readThrough:all.length ? String(all[all.length-1][5]) : ''};
}
function getThread_(payload,user) {
  requireConversation_(payload.conversationId,user);
  return {messages:rows_(sheet_('Messages')).filter(function(r){return r[1]===payload.conversationId && (r[0]===payload.parentId || r[8]===payload.parentId);}).map(message_)};
}
function sendMessage_(payload,user) {
  requireConversation_(payload.conversationId,user);
  var body=text_(payload.body,4000,'Message'), clientId=text_(payload.clientId,100,'Message identifier');
  var messages=rows_(sheet_('Messages'));
  var existing=messages.find(function(r){return r[2]===user.email && r[10]===clientId;});
  if(existing){
    if(existing[1]!==payload.conversationId || String(existing[8])!==String(payload.parentId||''))fail_('duplicate','This message identifier was already used in another conversation or thread.');
    return message_(existing);
  }
  var parent=payload.parentId || '';
  if(parent && !messages.some(function(r){return r[0]===parent && r[1]===payload.conversationId && !r[8] && r[7]!==true;}))fail_('bad_request','The thread message is not available.');
  var now=new Date().toISOString();
  var row=[Utilities.getUuid(),payload.conversationId,user.email,cell_(user.name),cell_(body),now,now,false,parent,'{}',clientId];
  sheet_('Messages').appendRow(row);
  enqueuePush_(row);
  return message_(row);
}
function mutateMessage_(payload,user) {
  var sheet=sheet_('Messages'), rows=rows_(sheet), index=rows.findIndex(function(r){return r[0]===payload.messageId;});
  if(index<0)fail_('not_found','Message not found.');
  var row=rows[index]; requireConversation_(row[1],user);
  if(row[7]===true)fail_('bad_request','This message has been removed.');
  if(payload.action==='react') {
    var emoji=String(payload.emoji||'');
    if(['thumbsup','heart','check','eyes'].indexOf(emoji)<0)fail_('bad_request','Unknown reaction.');
    var reactions=JSON.parse(row[9]||'{}'), people=reactions[emoji]||[], position=people.indexOf(user.email);
    if(position>=0)people.splice(position,1); else people.push(user.email);
    reactions[emoji]=people; row[9]=JSON.stringify(reactions);
  } else {
    if(row[2]!==user.email && !(payload.action==='deleteMessage' && user.role==='admin'))fail_('forbidden','You can only edit your own messages.');
    if(payload.action==='deleteMessage'){row[4]='';row[7]=true;row[9]='{}';} else row[4]=cell_(text_(payload.body,4000,'Message'));
    row[6]=new Date().toISOString();
  }
  sheet.getRange(index+2,1,1,SCHEMA.Messages.length).setValues([row]);
  return message_(row);
}
function markRead_(payload,user) {
  requireConversation_(payload.conversationId,user);
  var time=new Date(payload.through);
  if(!Number.isFinite(time.getTime()) || time.getTime()>Date.now()+5000)fail_('bad_request','Invalid read timestamp.');
  var through=time.toISOString(),sheet=sheet_('ReadReceipts'),rows=rows_(sheet),index=rows.findIndex(function(r){return r[0]===user.email && r[1]===payload.conversationId;});
  if(index<0)sheet.appendRow([user.email,payload.conversationId,through]);
  else if(String(rows[index][2])<through)sheet.getRange(index+2,3).setValue(through);
  return {ok:true};
}
function handle_(payload) {
  if(payload.action==='registrationInfo')return registrationInfo_();
  if(payload.action==='login')return login_(payload);
  if(payload.action==='register')return register_(payload);
  var user=authenticate_(payload);
  switch(payload.action) {
    case 'session':return {user:user};
    case 'bootstrap':return bootstrap_(user);
    case 'createConversation':return createConversation_(payload,user);
    case 'listMessages':return listMessages_(payload,user);
    case 'getThread':return getThread_(payload,user);
    case 'sendMessage':return sendMessage_(payload,user);
    case 'editMessage':case 'deleteMessage':case 'react':return mutateMessage_(payload,user);
    case 'markRead':return markRead_(payload,user);
    case 'pushConfig':return pushConfig_();
    case 'pushStatus':return pushStatus_(payload,user);
    case 'subscribePush':return subscribePush_(payload,user);
    case 'unsubscribePush':return unsubscribePush_(payload,user);
    case 'logout':
      var sheet=sheet_('Sessions'), rows=rows_(sheet), hash=digest_(payload.sessionToken);
      for(var i=rows.length-1;i>=0;i--)if(equal_(rows[i][0],hash))sheet.deleteRow(i+2);
      revokePushSession_(hash);
      return {ok:true};
    default:fail_('unknown_action','Unknown action.');
  }
}
function doPost(e) {
  var lock=null;
  try {
    var contents=e && e.postData && e.postData.contents;
    if(!contents || contents.length>25000)fail_('bad_request','Invalid request.');
    var payload=JSON.parse(contents);
    if(!payload || typeof payload!=='object' || Array.isArray(payload) || typeof payload.action!=='string' || !payload.action || payload.action.length>50)fail_('bad_request','Invalid request.');
    if(MUTATIONS.indexOf(payload.action)>=0){var candidate=LockService.getScriptLock();candidate.waitLock(30000);lock=candidate;}
    return json_({ok:true,data:handle_(payload)});
  } catch(err) { return json_({ok:false,error:err.message||'Request failed.',code:err.code||'server_error'}); }
  finally {if(lock)lock.releaseLock();}
}
function doGet() { return json_({ok:true,data:{app:'Hays + Sons Team Messaging',version:4,configured:!!PropertiesService.getScriptProperties().getProperty('MESSAGING_SPREADSHEET_ID'),usernameType:'email',features:['email-password-auth','empty-workspace-setup','message-id-pagination','root-message-pages','web-push']}}); }
/** Run periodically from the editor or an Apps Script time trigger. */
function cleanupSessions() {
  var lock=LockService.getScriptLock();lock.waitLock(30000);
  try {var sheet=sheet_('Sessions'), rows=rows_(sheet);for(var i=rows.length-1;i>=0;i--)if(new Date(rows[i][2]).getTime()<=Date.now())sheet.deleteRow(i+2);prunePushSubscriptions_();}
  finally {lock.releaseLock();}
}

// Push is optional and stored in this messaging project's own database only.
var PUSH_SCHEMA = {
  PushSubscriptions:['Id','Email','SessionHash','SubscriptionJson','ExpiresAt','CreatedAt','PublicKey'],
  PushQueue:['MessageId','ConversationId','AuthorEmail','CreatedAt','TargetsJson','Attempts','NextAttemptAt']
};
/** Editor-only: configure VAPID_PUBLIC_KEY, PUSH_RELAY_URL and PUSH_RELAY_SECRET first.
 * Creates the push tables and one minute delivery trigger. Safe to run again. */
function setupPushMessaging() {
  var lock=LockService.getScriptLock();lock.waitLock(30000);
  try {
    var config=pushSettings_();
    if(!config.publicKey || !config.url || !config.secret)fail_('not_configured','Set VAPID_PUBLIC_KEY, PUSH_RELAY_URL and PUSH_RELAY_SECRET in Script Properties first.');
    var db=db_();Object.keys(PUSH_SCHEMA).forEach(function(name){var sheet=db.getSheetByName(name)||db.insertSheet(name);if(!sheet.getLastRow()){sheet.appendRow(PUSH_SCHEMA[name]);sheet.setFrozenRows(1);}});
    if(!ScriptApp.getProjectTriggers().some(function(t){return t.getHandlerFunction()==='deliverPushQueue';}))ScriptApp.newTrigger('deliverPushQueue').timeBased().everyMinutes(1).create();
    return {ok:true};
  } finally {lock.releaseLock();}
}
function pushSettings_() {
  var props=PropertiesService.getScriptProperties(),key=props.getProperty('VAPID_PUBLIC_KEY')||'',url=props.getProperty('PUSH_RELAY_URL')||'',secret=props.getProperty('PUSH_RELAY_SECRET')||'';
  if(key && !/^[A-Za-z0-9_-]{87}$/.test(key))fail_('push_configuration','VAPID_PUBLIC_KEY must be a valid Web Push public key.');
  if(url && !/^https:\/\/[a-z0-9.-]+(?::443)?(?:\/[^\s#]*)?$/i.test(url))fail_('push_configuration','PUSH_RELAY_URL must use HTTPS.');
  if(secret && secret.length<32)fail_('push_configuration','PUSH_RELAY_SECRET must be at least 32 characters.');
  return {publicKey:key,url:url,secret:secret};
}
function pushConfig_() {
  var c=pushSettings_(),db=db_();
  if(!c.publicKey || !c.url || !c.secret)return {enabled:false,publicKey:'',reason:'Background notifications have not been configured by your administrator.'};
  if(!db.getSheetByName('PushSubscriptions') || !db.getSheetByName('PushQueue') || !ScriptApp.getProjectTriggers().some(function(t){return t.getHandlerFunction()==='deliverPushQueue';}))return {enabled:false,publicKey:c.publicKey,reason:'Your administrator needs to run setupPushMessaging() to start background delivery.'};
  return {enabled:true,publicKey:c.publicKey};
}
function pushEndpoint_(endpoint) {
  if(typeof endpoint!=='string' || endpoint.length>2048)fail_('bad_request','Invalid push endpoint.');
  var match=/^https:\/\/([^\/?#]+)(\/[^#]*)$/.exec(endpoint),host=match && match[1].toLowerCase();
  if(!host || !(host==='fcm.googleapis.com' || host==='updates.push.services.mozilla.com' || /^[a-z0-9-]+\.push\.services\.mozilla\.com$/.test(host) || /^[a-z0-9-]+\.push\.apple\.com$/.test(host) || /^[a-z0-9-]+\.notify\.windows\.com$/.test(host)))fail_('bad_request','Unsupported push provider.');
  return endpoint;
}
function validPushSubscription_(value) {
  if(!value || typeof value!=='object' || Array.isArray(value))fail_('bad_request','Invalid push subscription.');
  var endpoint=pushEndpoint_(value.endpoint),keys=value.keys||{};
  if(!/^[A-Za-z0-9_-]{87}$/.test(keys.p256dh||'') || !/^[A-Za-z0-9_-]{22}$/.test(keys.auth||''))fail_('bad_request','Invalid push encryption keys.');
  var expiry=value.expirationTime;
  if(expiry!=null && (typeof expiry!=='number' || !Number.isFinite(expiry) || expiry<=Date.now()))fail_('bad_request','The push subscription has expired.');
  return {endpoint:endpoint,keys:{p256dh:keys.p256dh,auth:keys.auth},expirationTime:expiry==null ? null : expiry};
}
function pushStatus_(payload,user) {
  var config=pushConfig_(),sub=sheet_('PushSubscriptions');
  config.subscribed=!!(config.enabled && typeof payload.endpoint==='string' && sub && rows_(sub).some(function(r){return r[0]===digest_(payload.endpoint) && r[1]===user.email && equal_(r[2],digest_(payload.sessionToken)) && r[6]===config.publicKey && new Date(r[4]).getTime()>Date.now();}));
  return config;
}
function subscribePush_(payload,user) {
  var config=pushConfig_();if(!config.enabled)fail_('push_unavailable',config.reason);
  prunePushSubscriptions_();
  var subscription=validPushSubscription_(payload.subscription),hash=digest_(payload.sessionToken),sessions=rows_(sheet_('Sessions'));
  var session=sessions.find(function(r){return equal_(r[0],hash);}),expiry=new Date(session[2]).getTime();
  if(subscription.expirationTime!=null)expiry=Math.min(expiry,subscription.expirationTime);
  var sheet=sheet_('PushSubscriptions'),records=rows_(sheet),id=digest_(subscription.endpoint),index=records.findIndex(function(r){return r[0]===id;});
  if(index<0 && records.filter(function(r){return r[1]===user.email;}).length>=10)fail_('push_limit','Remove an unused device before enabling more than 10 notification subscriptions.');
  var row=[id,user.email,hash,JSON.stringify(subscription),new Date(expiry).toISOString(),new Date().toISOString(),config.publicKey];
  if(index<0)sheet.appendRow(row);else sheet.getRange(index+2,1,1,PUSH_SCHEMA.PushSubscriptions.length).setValues([row]);
  return {ok:true,subscribed:true};
}
function unsubscribePush_(payload,user) {
  var endpoint=pushEndpoint_(payload.endpoint),sheet=sheet_('PushSubscriptions');if(!sheet)return {ok:true};
  var id=digest_(endpoint),records=rows_(sheet),hash=digest_(payload.sessionToken);
  for(var i=records.length-1;i>=0;i--)if(records[i][0]===id && records[i][1]===user.email && equal_(records[i][2],hash))sheet.deleteRow(i+2);
  return {ok:true};
}
function revokePushSession_(hash) {
  var sheet=sheet_('PushSubscriptions');if(!sheet)return;
  var records=rows_(sheet);for(var i=records.length-1;i>=0;i--)if(equal_(records[i][2],hash))sheet.deleteRow(i+2);
}
function prunePushSubscriptions_() {
  var sheet=sheet_('PushSubscriptions');if(!sheet)return;
  var records=rows_(sheet),sessions=rows_(sheet_('Sessions')),users=activeUsers_(),key=PropertiesService.getScriptProperties().getProperty('VAPID_PUBLIC_KEY');
  for(var i=records.length-1;i>=0;i--){var r=records[i];if(new Date(r[4]).getTime()<=Date.now() || r[6]!==key || !users.some(function(u){return u[0]===r[1];}) || !sessions.some(function(s){return equal_(s[0],r[2]) && s[1]===r[1] && new Date(s[2]).getTime()>Date.now();}))sheet.deleteRow(i+2);}
}
function enqueuePush_(messageRow) {
  // Never prevent a committed message from reaching the sender on push failures.
  try {
    var queue=sheet_('PushQueue'),subscriptions=sheet_('PushSubscriptions');if(!queue || !subscriptions)return;
    var convoRow=rows_(sheet_('Conversations')).find(function(r){return r[0]===messageRow[1];});if(!convoRow)return;
    var conversation=conversation_(convoRow),targets=rows_(subscriptions).filter(function(r){return r[1]!==messageRow[2] && new Date(r[4]).getTime()>Date.now() && visible_(conversation,{email:r[1]});}).map(function(r){return {id:r[0],email:r[1],sessionHash:r[2],attempts:0,nextAt:0};});
    if(targets.length)queue.appendRow([messageRow[0],messageRow[1],messageRow[2],messageRow[5],JSON.stringify(targets),0,new Date().toISOString()]);
  } catch(err) {Logger.log('A push job could not be queued; the message was saved.');}
}
/** Installed time trigger. Push payload contains identifiers only, never message content.
 * Each run caps the batch at 50 deliveries; read/expired/deleted items are discarded. */
function deliverPushQueue() {
  var lock=LockService.getScriptLock();if(!lock.tryLock(1000))return;
  try {
    var config=pushConfig_();if(!config.enabled)return;
    prunePushSubscriptions_();
    var queue=sheet_('PushQueue'),jobs=rows_(queue),subscriptions=rows_(sheet_('PushSubscriptions')),messages=rows_(sheet_('Messages')),conversations=rows_(sheet_('Conversations')),receipts=rows_(sheet_('ReadReceipts')),deliveries=[],states=[],now=Date.now();
    jobs.forEach(function(job,index){
      if(new Date(job[6]).getTime()>now)return;
      var pending=JSON.parse(job[4]||'[]'),remaining=[],message=messages.find(function(m){return m[0]===job[0] && m[7]!==true;}),convoRow=conversations.find(function(c){return c[0]===job[1];});
      if(message && convoRow && now-new Date(job[3]).getTime()<86400000){
        var conversation=conversation_(convoRow);
        pending.forEach(function(target){
          var id=target.id;if(target.attempts>=5)return;
          var sub=subscriptions.find(function(s){return s[0]===id;});if(!sub || sub[1]!==target.email || !equal_(sub[2],target.sessionHash) || sub[1]===job[2] || !visible_(conversation,{email:sub[1]}))return;
          if(receipts.some(function(r){return r[0]===sub[1] && r[1]===job[1] && String(r[2])>=String(job[3]);}))return;
          remaining.push(target);
          if(deliveries.length<50 && target.nextAt<=now)deliveries.push({id:job[0]+'|'+id,subscription:JSON.parse(sub[3]),payload:{title:'Hays + Sons',body:'You have a new team message.',tag:'conversation-'+job[1],data:{conversationId:job[1],messageId:job[0]}}});
        });
      }
      states.push({index:index,row:job,remaining:remaining});
    });
    var results=[];
    if(deliveries.length){
      var settings=pushSettings_();
      try {
        var response=UrlFetchApp.fetch(settings.url,{method:'post',contentType:'application/json',headers:{Authorization:'Bearer '+settings.secret},payload:JSON.stringify({deliveries:deliveries}),muteHttpExceptions:true,followRedirects:false});
        if(response.getResponseCode()===200){var reply=JSON.parse(response.getContentText());if(Array.isArray(reply.results))results=reply.results;}
      } catch(err) {Logger.log('Push relay unavailable; queued deliveries will retry.');}
    }
    var gone=[];
    states.reverse().forEach(function(state){
      var remaining=state.remaining.filter(function(target){
        var id=target.id;
        var deliveryId=state.row[0]+'|'+id;if(!deliveries.some(function(d){return d.id===deliveryId;}))return true;
        var result=results.find(function(r){return r.id===deliveryId;});
        if(result && result.status==='gone'){gone.push(id);return false;}
        if(result && result.status==='delivered')return false;
        target.attempts++;target.nextAt=now+Math.pow(2,target.attempts-1)*60000;
        return target.attempts<5;
      });
      if(!remaining.length){queue.deleteRow(state.index+2);return;}
      state.row[4]=JSON.stringify(remaining);
      state.row[6]=new Date(Math.min.apply(null,remaining.map(function(t){return t.nextAt;}))).toISOString();
      queue.getRange(state.index+2,1,1,PUSH_SCHEMA.PushQueue.length).setValues([state.row]);
    });
    if(gone.length){var sheet=sheet_('PushSubscriptions'),records=rows_(sheet);for(var i=records.length-1;i>=0;i--)if(gone.indexOf(records[i][0])>=0)sheet.deleteRow(i+2);}
  } finally {lock.releaseLock();}
}
