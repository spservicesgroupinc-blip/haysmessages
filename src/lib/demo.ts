import type { Bootstrap, Conversation, Message, Person, Session } from './types';

export const DEMO_USER: Person = { email: 'you@hays.example', name: 'You', role: 'admin' };
const PEOPLE: Person[] = [DEMO_USER,
  {email:'alex@hays.example',name:'Alex Morgan',role:'member'},
  {email:'jordan@hays.example',name:'Jordan Davis',role:'member'},
  {email:'casey@hays.example',name:'Casey Taylor',role:'member'},
  {email:'sam@hays.example',name:'Sam Wilson',role:'member'}];
const now = () => new Date().toISOString();
const id = () => crypto.randomUUID();
interface Store { conversations: Conversation[]; messages: Message[]; receipts: Record<string,string> }
function seed(): Store {
  const names = ['general','sales','project-managers','office'];
  const descriptions = ['Company-wide updates and everyday conversations.','Leads, estimates, handoffs, and sales wins.','Job progress, schedules, and field coordination.','Administration, billing, and office coordination.'];
  const conversations: Conversation[] = names.map((name,i)=>({id:name,name,description:descriptions[i],kind:'channel',members:[],createdBy:'SYSTEM',createdAt:now(),lastActivity:now(),unread:0}));
  const examples = [
    ['general',1,'Good morning, team! This is our space for updates, quick questions, and keeping everyone connected.'],
    ['general',2,'Field teams: share any schedule changes in #project-managers so the office can keep customers informed.'],
    ['general',3,'Thanks, everyone. A quick handoff here can save a lot of phone calls.'],
    ['sales',1,'New estimate ready for review. I will share the customer handoff details with the project team after approval.'],
    ['project-managers',2,'Use this channel for job progress, crew schedules, and anything the field team needs to know.'],
    ['office',3,'A place for billing questions, scheduling coordination, and office updates.']
  ] as const;
  const messages: Message[] = examples.map(([conversationId,person,body],i):Message=>({id:id(),conversationId,authorEmail:PEOPLE[person].email,authorName:PEOPLE[person].name,body,createdAt:new Date(Date.now()-(examples.length-i)*5*60000).toISOString(),updatedAt:'',deleted:false,parentId:'',reactions:i===0 ? {thumbsup:[PEOPLE[2].email,PEOPLE[3].email]} : {},clientId:id()}));
  return {conversations,messages,receipts:{}};
}
const KEY = 'hays.messages.demo.v1';
let fallback:Store|null=null;
function read(): Store { try { const value=localStorage.getItem(KEY); if(value){const parsed=JSON.parse(value);if(Array.isArray(parsed.conversations)&&Array.isArray(parsed.messages)&&parsed.receipts&&typeof parsed.receipts==='object')return parsed;} } catch {} return fallback||seed(); }
function save(store:Store) {fallback=store;try{localStorage.setItem(KEY,JSON.stringify(store));}catch{/* Demo continues in memory if storage is unavailable. */} }
function text(value:unknown,max:number,label:string){if(typeof value!=='string'||!value.trim()||value.length>max)throw new Error(`${label} is required and must be at most ${max} characters.`);return value.trim();}
export function demoSession(): Session { return {token:'local-demo',expiresAt:new Date(Date.now()+86400000).toISOString(),user:DEMO_USER,demo:true}; }
export async function demoRequest<T>(action:string,payload:Record<string,unknown>): Promise<T> {
  const store = read();
  let result: unknown;
  const conversationId = String(payload.conversationId||'');
  const messageId = String(payload.messageId||'');
  if(['listMessages','getThread','sendMessage','markRead'].includes(action)&&!store.conversations.some(c=>c.id===conversationId))throw new Error('This conversation is not available.');
  switch(action) {
    case 'session': result={user:DEMO_USER}; break;
    case 'bootstrap': result={user:DEMO_USER,people:PEOPLE,conversations:store.conversations.map(c=>({...c,lastActivity:store.messages.filter(m=>m.conversationId===c.id).at(-1)?.createdAt||c.createdAt,unread:store.messages.filter(m=>m.conversationId===c.id && !m.deleted && m.authorEmail!==DEMO_USER.email && m.createdAt>(store.receipts[c.id]||'')).length}))} satisfies Bootstrap; break;
    case 'listMessages': {
      const all=store.messages.filter(m=>m.conversationId===conversationId);
      const query=String(payload.query||'').trim().toLowerCase();
      const before=payload.beforeId?all.findIndex(m=>m.id===payload.beforeId):all.length;
      if(before<0)throw new Error('The history cursor is unavailable. Reload the conversation.');
      const candidates=all.filter((m,i)=>i<before&&(!payload.before||m.createdAt<String(payload.before))&&(query?(!m.deleted&&m.body.toLowerCase().includes(query)):!m.parentId));
      const requested=Number(payload.limit),count=Number.isFinite(requested)?Math.min(200,Math.max(1,Math.floor(requested))):100;
      const page=candidates.slice(-count),ids=new Set(page.map(m=>m.id));
      result={messages:query?page:all.filter(m=>ids.has(m.id)||ids.has(m.parentId)),hasMore:candidates.length>count,nextBeforeId:page[0]?.id||'',readThrough:all.at(-1)?.createdAt||''}; break;
    }
    case 'getThread': result={messages:store.messages.filter(m=>m.conversationId===conversationId && (m.id===payload.parentId || m.parentId===payload.parentId))}; break;
    case 'sendMessage': {
      const body=text(payload.body,4000,'Message'),clientId=text(payload.clientId,100,'Message identifier'),parentId=String(payload.parentId||'');
      const existing=store.messages.find(m=>m.authorEmail===DEMO_USER.email&&m.clientId===clientId);
      if(existing){if(existing.conversationId!==conversationId||existing.parentId!==parentId)throw new Error('This message identifier was already used in another conversation or thread.');result=existing;break;}
      if(parentId&&!store.messages.some(m=>m.id===parentId&&m.conversationId===conversationId&&!m.parentId&&!m.deleted))throw new Error('The thread message is not available.');
      const message: Message = {id:id(),conversationId,authorEmail:DEMO_USER.email,authorName:DEMO_USER.name,body,createdAt:now(),updatedAt:'',deleted:false,parentId,reactions:{},clientId};
      store.messages.push(message);result=message;break;
    }
    case 'createConversation': {
      const kind = payload.kind as Conversation['kind'];
      if(!['channel','group','dm'].includes(kind))throw new Error('Invalid conversation type.');
      const members = [...new Set([DEMO_USER.email,...Array.isArray(payload.members)?payload.members as string[]:[]])];
      if(kind!=='channel'&&(members.length<2||members.length>30||members.some(email=>!PEOPLE.some(p=>p.email===email))))throw new Error('Choose between 1 and 29 active teammates.');
      if(kind==='dm'&&members.length!==2)throw new Error('Direct messages have exactly two people.');
      const rawName=text(payload.name,80,'Conversation name');
      const name = kind==='channel' ? rawName.toLowerCase().replace(/\s+/g,'-') : rawName;
      if(kind==='channel' && !/^[a-z0-9][a-z0-9-]{0,79}$/.test(name))throw new Error('Channel names use letters, numbers, and hyphens.');
      if(kind==='channel' && store.conversations.some(c=>c.kind==='channel' && c.name===name))throw new Error('A channel with that name already exists.');
      const existing=kind==='dm' && store.conversations.find(c=>c.kind==='dm' && c.members.slice().sort().join('|')===members.slice().sort().join('|'));
      if(existing){result=existing;break;}
      const conversation: Conversation={id:id(),name,description:String(payload.description||''),kind,members:kind==='channel'?[]:members,createdBy:DEMO_USER.email,createdAt:now(),lastActivity:now(),unread:0};
      store.conversations.push(conversation);result=conversation;break;
    }
    case 'markRead': {const time=new Date(String(payload.through));if(!Number.isFinite(time.getTime())||time.getTime()>Date.now()+5000)throw new Error('Invalid read timestamp.');const through=time.toISOString();if(through>(store.receipts[conversationId]||''))store.receipts[conversationId]=through;result={ok:true};break;}
    case 'editMessage': case 'deleteMessage': case 'react': {
      const m=store.messages.find(m=>m.id===messageId);
      if(!m)throw new Error('Message not found.');
      if(m.deleted)throw new Error('This message has been removed.');
      if(action==='editMessage'&&m.authorEmail!==DEMO_USER.email)throw new Error('You can only edit your own messages.');
      if(action==='editMessage'){m.body=text(payload.body,4000,'Message');m.updatedAt=now();}
      if(action==='deleteMessage'){m.body='';m.deleted=true;m.reactions={};m.updatedAt=now();}
      if(action==='react') {const key=String(payload.emoji);if(!['thumbsup','heart','check','eyes'].includes(key))throw new Error('Unknown reaction.');const members=m.reactions[key]||[];m.reactions[key]=members.includes(DEMO_USER.email)?members.filter(e=>e!==DEMO_USER.email):[...members,DEMO_USER.email];}
      result=m;break;
    }
    case 'logout':result={ok:true};break;
    default: throw new Error('This action is not supported in demo mode.');
  }
  save(store);
  return result as T;
}
