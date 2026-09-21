import http from 'node:http';
import { readFileSync, mkdirSync, chmodSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, randomUUID, createHash, createHmac, createCipheriv, createDecipheriv, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { resolve } from 'node:path';

// One private household; one process; a durable /data volume. Never put data in source.
const scrypt = promisify(scryptCallback);
const port = Number(process.env.PORT || 3000);
const origin = new URL(process.env.APP_ORIGIN || `http://localhost:${port}`).origin;
const production = process.env.NODE_ENV === 'production';
if (production && !origin.startsWith('https://')) throw new Error('APP_ORIGIN must be HTTPS');
const key = Buffer.from(process.env.DATA_KEY || '', 'base64');
if (key.length !== 32) throw new Error('DATA_KEY must contain 32 random bytes, base64 encoded');
process.umask(0o077);
const directory = resolve(process.env.DATA_DIR || './data');
if (production && directory !== '/data') throw new Error('Production requires the /data volume');
mkdirSync(directory, { recursive: true, mode: 0o700 });
chmodSync(directory, 0o700);
const db = new DatabaseSync(`${directory}/family.sqlite`);
chmodSync(`${directory}/family.sqlite`, 0o600);
db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
CREATE TABLE IF NOT EXISTS records(id TEXT PRIMARY KEY, kind TEXT NOT NULL, version INTEGER NOT NULL, body TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS records_kind ON records(kind);
CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY, lookup TEXT UNIQUE NOT NULL, password TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS invites(hash TEXT PRIMARY KEY, person TEXT NOT NULL, expires INTEGER NOT NULL, used INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS sessions(hash TEXT PRIMARY KEY, person TEXT NOT NULL, expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS oauth(hash TEXT PRIMARY KEY, person TEXT NOT NULL, session TEXT NOT NULL, verifier TEXT NOT NULL, expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS limits(id TEXT PRIMARY KEY, count INTEGER NOT NULL, expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS meta(id TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY, at TEXT NOT NULL, actor TEXT NOT NULL, action TEXT NOT NULL, target TEXT NOT NULL);`);
const sha = value => createHash('sha256').update(String(value)).digest('hex');
const hmac = value => createHmac('sha256', key).update(value).digest('hex');
const token = () => randomBytes(32).toString('base64url');
const safe = (a, b) => typeof a === 'string' && typeof b === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
function seal(value, id) {
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(id));
  return Buffer.concat([iv, cipher.update(JSON.stringify(value)), cipher.final(), cipher.getAuthTag()]).toString('base64');
}
function unseal(value, id) {
  const raw = Buffer.from(value, 'base64'), decipher = createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12));
  decipher.setAAD(Buffer.from(id)); decipher.setAuthTag(raw.subarray(-16));
  return JSON.parse(Buffer.concat([decipher.update(raw.subarray(12, -16)), decipher.final()]).toString());
}
function record(row) { return row ? { ...unseal(row.body, row.id), id: row.id, version: row.version } : null; }
const get = id => record(db.prepare('SELECT * FROM records WHERE id=?').get(id));
const all = kind => db.prepare('SELECT * FROM records WHERE kind=?').all(kind).map(record);
function put(kind, id, value, version) {
  const previous = db.prepare('SELECT * FROM records WHERE id=?').get(id);
  if (version !== undefined && (!previous || previous.version !== version)) fail(409, 'Someone changed this item. Refresh and try again.');
  const next = (previous?.version || 0) + 1;
  const { version: ignored, id: ignoredId, ...payload } = value;
  // Changed arrangements require a fresh acceptance; old completion cannot cover a rescheduled task.
  if (kind === 'task' && previous) {
    const old = unseal(previous.body, id);
    if (['owner','date','time','title','place','location'].some(field => old[field] !== payload[field])) {
      payload.accepted = Boolean(payload.owner && payload.owner === payload.updatedBy);
      payload.done = false;
    }
  }
  db.prepare('INSERT INTO records VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET version=excluded.version,body=excluded.body').run(id, kind, next, seal(payload, id));
  return get(id);
}
function transaction(fn) { db.exec('BEGIN IMMEDIATE'); try { const result = fn(); db.exec('COMMIT'); return result; } catch (error) { db.exec('ROLLBACK'); throw error; } }
const audit = (actor, action, target) => db.prepare('INSERT INTO audit(at,actor,action,target) VALUES(?,?,?,?)').run(new Date().toISOString(), actor, action, target);
const role = user => user?.role || 'helper';
const coordinator = user => ['owner','coordinator'].includes(role(user));
const text = (value, max = 200, required = false) => {
  if (value == null && !required) return '';
  if (typeof value !== 'string' || value.length > max || (required && !value.trim()) || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value)) fail(400, 'Check the text fields.');
  return value.trim();
};
const validDate = value => /^\d{4}-\d{2}-\d{2}$/.test(value || '') && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value;
const nzDate = () => new Intl.DateTimeFormat('en-CA',{timeZone:'Pacific/Auckland',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const shift = (date, days) => { const d = new Date(`${date}T12:00Z`); d.setUTCDate(d.getUTCDate()+days); return d.toISOString().slice(0,10); };
const canView = (user, task) => role(user) !== 'helper' || task.owner === user.id;
function validateTask(body, user, old = null) {
  const date = body.date, time = body.time;
  if (!validDate(date) || (time !== '' && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time || ''))) fail(400, 'Choose a valid date and time.');
  const owner = text(body.owner,100), place = text(body.place,100);
  if (owner && !get(owner)?.active) fail(400, 'Choose an active helper.');
  if (place && !all('place').some(p => p.id === place)) fail(400, 'Choose a saved location.');
  return { title:text(body.title,160,true), date,time, category:text(body.category,50,true), owner, place,
    location:text(body.location,400), notes:text(body.notes,2000), done:old?.done || false,
    accepted: old?.owner === owner ? old.accepted : owner === user.id,
    createdBy:old?.createdBy || user.id, updatedBy:user.id, updatedAt:new Date().toISOString(),
    source: old?.source || null, allDay: time === '' };
}
// Seed invitation hashes once, never public accounts or pre-set passwords.
if (!db.prepare("SELECT value FROM meta WHERE id='initialised'").get()) {
  const seeds = JSON.parse(process.env.INITIAL_INVITES || '[]');
  if (!seeds.some(s => s.role === 'owner')) throw new Error('INITIAL_INVITES requires an owner invitation');
  transaction(() => {
    for (const seed of seeds) {
      if (!['owner','coordinator','member'].includes(seed.role) || !/^[a-f0-9]{64}$/.test(seed.hash)) throw new Error('Invalid initial invitation');
      const id = randomUUID();
      put('person', id, { name:text(seed.name,80,true), role:seed.role, active:true, joined:false });
      db.prepare('INSERT INTO invites VALUES(?,?,?,0)').run(seed.hash,id,Date.now()+7*86400000);
    }
    db.prepare("INSERT INTO meta VALUES('initialised','1')").run();
    db.prepare("INSERT INTO meta VALUES('keycheck',?)").run(seal({ok:true},'keycheck'));
  });
}
if (!unseal(db.prepare("SELECT value FROM meta WHERE id='keycheck'").get().value,'keycheck').ok) throw new Error('Wrong data key');
let passwordWork = 0;
async function passwordHash(password, salt = randomBytes(16).toString('hex')) {
  if (typeof password !== 'string' || password.length < 14 || password.length > 256) fail(400,'Use a passphrase of 14–256 characters.');
  if (passwordWork >= 2) fail(429,'Sign-in is busy. Please try again shortly.');
  passwordWork++;
  try { const hash = await scrypt(password,salt,64,{N:65536,r:8,p:2,maxmem:96*1024*1024}); return `${salt}:${hash.toString('hex')}`; }
  finally { passwordWork--; }
}
function throttle(id, max = 12, milliseconds = 900000) {
  const now = Date.now(), lookup = hmac(`limit:${id}`);
  db.prepare('DELETE FROM limits WHERE expires<?').run(now);
  const item = db.prepare('SELECT * FROM limits WHERE id=?').get(lookup);
  if (item && item.count >= max) fail(429,'Too many attempts. Please try again later.');
  db.prepare('INSERT INTO limits VALUES(?,1,?) ON CONFLICT(id) DO UPDATE SET count=count+1').run(lookup,now+milliseconds);
}
function session(req) {
  const raw = (req.headers.cookie || '').split(';').map(s=>s.trim()).find(s=>s.startsWith('family_session='))?.slice(15);
  if (!raw || !/^[A-Za-z0-9_-]{43}$/.test(raw)) return null;
  const hash = sha(raw), saved = db.prepare('SELECT * FROM sessions WHERE hash=? AND expires>?').get(hash,Date.now());
  if (!saved || !db.prepare('SELECT active FROM users WHERE id=? AND active=1').get(saved.person)) return null;
  const person = get(saved.person);
  return person?.active ? { ...person, session:hash, csrf:hmac(`csrf:${hash}`) } : null;
}
const cookie = (value, age = 604800) => `family_session=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${production ? '; Secure' : ''}`;
function createSession(id) { const raw = token(); db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(sha(raw),id,Date.now()+7*86400000); return raw; }
const publicPerson = p => ({id:p.id,name:p.name,role:p.role,active:p.active,joined:p.joined});
const scopes = ['https://www.googleapis.com/auth/calendar.calendarlist.readonly','https://www.googleapis.com/auth/calendar.events.readonly'];
const configured = () => Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
const connectionId = user => `google:${user.id}`;
async function googleToken(user) {
  const connection = get(connectionId(user));
  if (!connection) fail(409,'Connect your Google account first.');
  if (connection.expires > Date.now()+60000) return connection.access;
  const response = await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:process.env.GOOGLE_CLIENT_ID,client_secret:process.env.GOOGLE_CLIENT_SECRET,refresh_token:connection.refresh,grant_type:'refresh_token'}),signal:AbortSignal.timeout(15000)});
  const result = await response.json();
  if (!response.ok || !result.access_token) fail(409,'Google access expired or was revoked. Disconnect and reconnect.');
  put('google',connection.id,{...connection,access:result.access_token,expires:Date.now()+(result.expires_in || 3600)*1000});
  return result.access_token;
}
async function googleGet(user, path, params = {}) {
  const access = await googleToken(user);
  const url = new URL(`https://www.googleapis.com/calendar/v3/${path}`);
  Object.entries(params).forEach(([k,v])=>{if(v) url.searchParams.set(k,v);});
  const response = await fetch(url,{headers:{authorization:`Bearer ${access}`},signal:AbortSignal.timeout(15000)});
  if (!response.ok) fail(response.status === 401 ? 409 : 502,'Google Calendar could not be read. Check access and reconnect if needed.');
  return response.json();
}
const assets = new Map([['/',['index.html','text/html']],['/app.js',['app.js','text/javascript']],['/styles.css',['styles.css','text/css']]]);
const headers = { 'cache-control':'no-store', 'x-robots-tag':'noindex, nofollow, noarchive', 'x-content-type-options':'nosniff','x-frame-options':'DENY','referrer-policy':'no-referrer','permissions-policy':'camera=(), microphone=(), geolocation=()',
  'content-security-policy':"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; form-action 'self'; base-uri 'none'; frame-ancestors 'none'; object-src 'none'", ...(production ? {'strict-transport-security':'max-age=31536000'}:{}) };
const server = http.createServer(async (req,res) => {
  const send = (status,body,type='application/json; charset=utf-8',extra={}) => { res.writeHead(status,{...headers,'content-type':type,...extra}); res.end(req.method === 'HEAD' ? undefined : typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body)); };
  const ok = (body={ok:true},extra={}) => send(200,body,undefined,extra);
  try {
    const url = new URL(req.url,origin), path = url.pathname;
    if (req.url.length > 4096) fail(414,'Request too long');
    if (['GET','HEAD'].includes(req.method) && path === '/healthz') { db.prepare('SELECT 1').get(); return ok({status:'ok',mode:'private'}); }
    if (['GET','HEAD'].includes(req.method) && path === '/robots.txt') return send(200,'User-agent: *\nDisallow: /\n','text/plain');
    if (['GET','HEAD'].includes(req.method) && assets.has(path)) { const [name,type] = assets.get(path); return send(200,readFileSync(new URL(`./public/${name}`,import.meta.url)),`${type}; charset=utf-8`); }
    if (!path.startsWith('/api/') && path !== '/auth/google/callback') fail(404,'Not found');
    const user = session(req);
    let body = {};
    if (req.method === 'POST') {
      if (req.headers.origin !== origin || !String(req.headers['content-type']).startsWith('application/json')) fail(403,'Request origin not allowed');
      let data = ''; for await (const chunk of req) { data+=chunk; if(Buffer.byteLength(data)>32768) fail(413,'Request too large'); }
      try { body=JSON.parse(data || '{}'); } catch { fail(400,'Invalid JSON'); }
      if (!body || typeof body !== 'object' || Array.isArray(body)) fail(400,'Invalid request');
    } else if (req.method !== 'GET') fail(405,'Method not allowed');
    if (req.method === 'GET' && path === '/api/me') return ok(user ? {user:publicPerson(user),csrf:user.csrf} : {user:null});
    if (req.method === 'POST' && ['/api/login','/api/join','/api/invitation'].includes(path)) {
      throttle('anonymous',80,60000);
      if (path === '/api/invitation') {
        throttle('invitation-lookup',40,60000);
        const invite=db.prepare('SELECT * FROM invites WHERE hash=? AND used=0 AND expires>?').get(sha(text(body.token,100,true)),Date.now());
        const person=invite && get(invite.person);
        if(!person?.active) fail(400,'This invitation has expired or already been used. Ask the coordinator for a new link.');
        return ok({name:person.name,role:person.role});
      }
      const username=text(body.username,80,true).toLowerCase();
      if(!/^[a-z0-9][a-z0-9._@+-]{2,79}$/.test(username)) fail(400,'Use a username of 3–80 letters, numbers, dots or email characters.');
      throttle(`account:${username}`);
      if(path === '/api/login') {
        const saved=db.prepare('SELECT * FROM users WHERE lookup=?').get(hmac(`username:${username}`));
        const calculated=await passwordHash(body.password,saved?.password.split(':')[0] || '00000000000000000000000000000000');
        if(!saved?.active || !safe(calculated,saved.password) || !get(saved.id)?.active) fail(401,'Username or passphrase not recognised.');
        const raw=createSession(saved.id); audit(saved.id,'sign-in',saved.id); return ok({ok:true},{'set-cookie':cookie(raw)});
      }
      const invitationHash=sha(text(body.token,100,true));
      const invite=db.prepare('SELECT * FROM invites WHERE hash=? AND used=0 AND expires>?').get(invitationHash,Date.now());
      if(!invite || !get(invite.person)?.active) fail(400,'Invitation expired or already used.');
      const password=await passwordHash(body.password);
      transaction(()=>{
        const updated=db.prepare('UPDATE invites SET used=1 WHERE hash=? AND used=0 AND expires>?').run(invitationHash,Date.now());
        if(updated.changes!==1) fail(409,'This invitation has already been used.');
        if(db.prepare('SELECT id FROM users WHERE lookup=? AND id!=?').get(hmac(`username:${username}`),invite.person)) fail(409,'That username is unavailable.');
        db.prepare('INSERT INTO users VALUES(?,?,?,1) ON CONFLICT(id) DO UPDATE SET lookup=excluded.lookup,password=excluded.password,active=1').run(invite.person,hmac(`username:${username}`),password);
        put('person',invite.person,{...get(invite.person),joined:true,username});
        db.prepare('DELETE FROM sessions WHERE person=?').run(invite.person);
        db.prepare('UPDATE invites SET used=1 WHERE person=?').run(invite.person);
        audit(invite.person,'account-activated',invite.person);
      });
      return ok({ok:true},{'set-cookie':cookie(createSession(invite.person))});
    }
    if(!user) fail(401,'Please sign in.');
    if(req.method === 'POST' && !safe(req.headers['x-csrf-token'],user.csrf)) fail(403,'Refresh before saving.');
    if(path === '/auth/google/callback' && req.method === 'GET') {
      if(!configured()) fail(503,'Google Calendar is not configured.');
      const saved=db.prepare('SELECT * FROM oauth WHERE hash=? AND session=? AND person=? AND expires>?').get(sha(url.searchParams.get('state') || ''),user.session,user.id,Date.now());
      if(!saved) fail(400,'Google connection expired. Start again from Calendar.');
      db.prepare('DELETE FROM oauth WHERE hash=?').run(saved.hash);
      if(url.searchParams.has('error')) return send(303,'','text/plain',{location:'/#calendar=denied'});
      const response=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:process.env.GOOGLE_CLIENT_ID,client_secret:process.env.GOOGLE_CLIENT_SECRET,code:url.searchParams.get('code') || '',code_verifier:unseal(saved.verifier,saved.hash),redirect_uri:`${origin}/auth/google/callback`,grant_type:'authorization_code'}),signal:AbortSignal.timeout(15000)});
      const result=await response.json();
      if(!response.ok || !result.access_token || !result.refresh_token || !scopes.every(s=>(result.scope || '').split(' ').includes(s))) fail(400,'Google did not grant the required read-only access. Reconnect and approve Calendar access.');
      put('google',connectionId(user),{access:result.access_token,refresh:result.refresh_token,expires:Date.now()+(result.expires_in || 3600)*1000,calendar:null});
      audit(user.id,'google-connected',user.id);
      return send(303,'','text/plain',{location:'/#calendar=connected'});
    }
    if(path === '/api/state' && req.method === 'GET') {
      const tasks=all('task').filter(t=>canView(user,t));
      const places=all('place').filter(p=>role(user)!=='helper' || tasks.some(t=>t.place===p.id));
      const people=all('person').filter(p=>role(user)!=='helper' || p.id===user.id).map(publicPerson);
      return ok({user:publicPerson(user),csrf:user.csrf,tasks,places,people,today:nzDate(),serverTime:new Date().toISOString(),google:{configured:configured(),connected:Boolean(get(connectionId(user))),calendar:get(connectionId(user))?.calendar || null},notes:role(user)==='helper'?[]:all('note').slice(-100)});
    }
    if(path === '/api/logout' && req.method === 'POST') { db.prepare('DELETE FROM sessions WHERE hash=?').run(user.session); return ok({ok:true},{'set-cookie':cookie('',0)}); }
    if(path === '/api/password' && req.method === 'POST') {
      throttle(`password:${user.id}`,6);
      const saved=db.prepare('SELECT password FROM users WHERE id=?').get(user.id);
      if(!safe(await passwordHash(body.current,saved.password.split(':')[0]),saved.password)) fail(403,'Current passphrase not recognised.');
      const replacement=await passwordHash(body.password);
      transaction(()=>{db.prepare('UPDATE users SET password=? WHERE id=?').run(replacement,user.id);db.prepare('DELETE FROM sessions WHERE person=?').run(user.id);audit(user.id,'password-changed',user.id);});
      return ok({ok:true},{'set-cookie':cookie(createSession(user.id))});
    }
    if(path === '/api/task' && req.method === 'POST') {
      if(role(user)==='helper') fail(403,'Helpers can only update their assigned tasks.');
      const old=body.id?get(text(body.id,100,true)):null;
      if(body.id && !all('task').some(t=>t.id===body.id)) fail(404,'Task not found');
      if(old && !coordinator(user) && old.createdBy!==user.id) fail(403,'Ask the coordinator to edit this task.');
      const value=validateTask(body,user,old);
      if(!coordinator(user) && value.owner && value.owner!==user.id) fail(403,'Only the coordinator can assign someone else.');
      if(all('task').length>=5000 && !old) fail(409,'Task limit reached; archive old tasks first.');
      const result=put('task',old?.id || randomUUID(),value,old?Number(body.version):undefined); audit(user.id,old?'task-edited':'task-created',result.id); return ok(result);
    }
    if(path === '/api/task-action' && req.method === 'POST') {
      const task=all('task').find(t=>t.id===body.id); if(!task || !canView(user,task)) fail(404,'Task not found');
      if(task.version!==body.version) fail(409,'Someone changed this task. The roster has refreshed; try again.');
      if(body.action==='claim') { if(role(user)==='helper' || task.owner) fail(409,'This task is already assigned.'); task.owner=user.id;task.accepted=true; }
      else if(body.action==='accept') { if(task.owner!==user.id) fail(403,'Only the assigned person can confirm.');task.accepted=true; }
      else if(['done','release'].includes(body.action)) { if(task.owner!==user.id && !coordinator(user)) fail(403,'Only the assigned person or coordinator can do this.'); if(body.action==='done') task.done=!task.done; else {task.owner='';task.accepted=false;task.done=false;} }
      else if(body.action==='delete') { if(!coordinator(user) && task.createdBy!==user.id) fail(403,'Ask the coordinator to delete this.'); db.prepare('DELETE FROM records WHERE id=?').run(task.id);audit(user.id,'task-deleted',task.id);return ok(); }
      else fail(400,'Unknown task action');
      task.updatedBy=user.id;task.updatedAt=new Date().toISOString();put('task',task.id,task,body.version);audit(user.id,`task-${body.action}`,task.id);return ok();
    }
    if(path === '/api/place' && req.method === 'POST') {
      if(!coordinator(user)) fail(403,'Only a coordinator can edit locations.');
      if(body.id && !all('place').some(p=>p.id===body.id)) fail(404,'Location not found');
      if(all('place').length>=100 && !body.id) fail(409,'Location limit reached.');
      const item=put('place',body.id || randomUUID(),{label:text(body.label,80,true),address:text(body.address,400,true),notes:text(body.notes,500)},body.id?Number(body.version):undefined);audit(user.id,'place-saved',item.id);return ok(item);
    }
    if(path === '/api/note' && req.method === 'POST') { if(role(user)==='helper') fail(403,'Not permitted');const item=put('note',randomUUID(),{text:text(body.text,1200,true),person:user.id,at:new Date().toISOString()});audit(user.id,'handover-added',item.id);return ok(item); }
    if(path === '/api/invite' && req.method === 'POST') {
      if(!coordinator(user)) fail(403,'Only coordinators can invite helpers.');
      throttle(`invites:${user.id}`,30,3600000);
      let person=body.person?get(text(body.person,100,true)):null;
      if(person && (person.id===user.id || person.role==='owner' || (user.role!=='owner' && person.role==='coordinator'))) fail(403,'This account can only be managed by its owner.');
      if(body.person && !all('person').some(p=>p.id===body.person)) fail(404,'Person not found');
      const requested=text(body.role,30) || 'member';
      if(!person && !['member','helper',...(user.role==='owner'?['coordinator']:[])].includes(requested)) fail(400,'Choose a valid role');
      const raw=token();
      transaction(()=>{ if(!person) person=put('person',randomUUID(),{name:text(body.name,80,true),role:requested,active:true,joined:false}); else {person=put('person',person.id,{...person,active:true});db.prepare('UPDATE users SET active=0 WHERE id=?').run(person.id);db.prepare('DELETE FROM sessions WHERE person=?').run(person.id);}
        db.prepare('UPDATE invites SET used=1 WHERE person=?').run(person.id);db.prepare('INSERT INTO invites VALUES(?,?,?,0)').run(sha(raw),person.id,Date.now()+7*86400000);audit(user.id,'invitation-created',person.id); });
      return ok({url:`${origin}/#join=${raw}`,name:person.name});
    }
    if(path === '/api/revoke' && req.method === 'POST') {
      const person=all('person').find(p=>p.id===body.person);
      if(!coordinator(user) || !person || person.id===user.id || person.role==='owner' || (person.role==='coordinator' && user.role!=='owner')) fail(403,'This account cannot be removed by you.');
      transaction(()=>{put('person',person.id,{...person,active:false});db.prepare('UPDATE users SET active=0 WHERE id=?').run(person.id);db.prepare('DELETE FROM sessions WHERE person=?').run(person.id);db.prepare('UPDATE invites SET used=1 WHERE person=?').run(person.id);db.prepare('DELETE FROM records WHERE id=?').run(connectionId(person));db.prepare('DELETE FROM oauth WHERE person=?').run(person.id);for(const t of all('task').filter(t=>t.owner===person.id && !t.done))put('task',t.id,{...t,owner:'',accepted:false});audit(user.id,'access-revoked',person.id);});return ok();
    }
    if(path === '/api/google/connect' && req.method === 'POST') {
      if(role(user)==='helper') fail(403,'Calendar import is for family members.');
      if(!configured()) fail(503,'Google Calendar needs the app’s Google OAuth client ID and secret.');
      throttle(`google:${user.id}`,10,60000);
      const state=token(),verifier=token(),hash=sha(state);
      db.prepare('DELETE FROM oauth WHERE person=? OR expires<?').run(user.id,Date.now());
      db.prepare('INSERT INTO oauth VALUES(?,?,?,?,?)').run(hash,user.id,user.session,seal(verifier,hash),Date.now()+600000);
      const target=new URL('https://accounts.google.com/o/oauth2/v2/auth');
      Object.entries({client_id:process.env.GOOGLE_CLIENT_ID,redirect_uri:`${origin}/auth/google/callback`,response_type:'code',scope:scopes.join(' '),access_type:'offline',prompt:'consent select_account',state,code_challenge:Buffer.from(sha(verifier),'hex').toString('base64url'),code_challenge_method:'S256'}).forEach(([k,v])=>target.searchParams.set(k,v));return ok({url:target.href});
    }
    if(path === '/api/google/disconnect' && req.method === 'POST') {
      const conn=get(connectionId(user)); let revoked=true;
      if(conn) {try {const r=await fetch('https://oauth2.googleapis.com/revoke',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({token:conn.refresh}),signal:AbortSignal.timeout(10000)});revoked=r.ok;}catch{revoked=false;} }
      db.prepare('DELETE FROM records WHERE id=?').run(connectionId(user));db.prepare('DELETE FROM oauth WHERE person=?').run(user.id);audit(user.id,'google-disconnected',user.id);return ok({ok:true,revoked});
    }
    if(path.startsWith('/api/google/') && role(user)==='helper') fail(403,'Not permitted');
    if(path === '/api/google/calendars' && req.method === 'GET') {
      const result=await googleGet(user,'users/me/calendarList',{maxResults:'100',pageToken:text(url.searchParams.get('page'),2000)});
      return ok({calendars:(result.items||[]).map(c=>({id:c.id,name:c.summary,role:c.accessRole})),next:result.nextPageToken||null});
    }
    if(path === '/api/google/select' && req.method === 'POST') {
      const calendarId=text(body.id,500,true);const calendar=await googleGet(user,`users/me/calendarList/${encodeURIComponent(calendarId)}`);
      const conn=get(connectionId(user));put('google',conn.id,{...conn,calendar:{id:calendar.id,name:calendar.summary}});return ok();
    }
    if(path === '/api/google/events' && req.method === 'GET') {
      const conn=get(connectionId(user));if(!conn?.calendar) fail(400,'Choose a calendar first.');
      const result=await googleGet(user,`calendars/${encodeURIComponent(conn.calendar.id)}/events`,{singleEvents:'true',orderBy:'startTime',maxResults:'100',timeMin:new Date(Date.now()-86400000).toISOString(),timeMax:new Date(Date.now()+31*86400000).toISOString(),timeZone:'Pacific/Auckland',pageToken:text(url.searchParams.get('page'),2000)});
      // Calendar previews stay private to the connected account. No attendees or descriptions are copied.
      const events=(result.items||[]).filter(e=>e.status!=='cancelled').map(e=>({id:e.id,title:e.summary || 'Calendar event',start:e.start,end:e.end,location:e.location || '',updated:e.updated}));
      return ok({events,next:result.nextPageToken||null});
    }
    if(path === '/api/google/import' && req.method === 'POST') {
      const conn=get(connectionId(user));if(!conn?.calendar) fail(400,'Choose a calendar first.');
      const event=await googleGet(user,`calendars/${encodeURIComponent(conn.calendar.id)}/events/${encodeURIComponent(text(body.event,1024,true))}`);
      if(event.status==='cancelled' || !event.start) fail(409,'This event was cancelled.');
      const sourceHash=hmac(`calendar:${conn.calendar.id}:${event.id}`);
      if(all('task').some(t=>t.source?.hash===sourceHash)) fail(409,'This event has already been copied to the shared roster. Edit its existing task instead.');
      let date=event.start.date,time='';
      if(event.start.dateTime) {const parts=Object.fromEntries(new Intl.DateTimeFormat('en-NZ',{timeZone:'Pacific/Auckland',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(event.start.dateTime)).map(p=>[p.type,p.value]));date=`${parts.year}-${parts.month}-${parts.day}`;time=`${parts.hour}:${parts.minute}`;}
      const value=validateTask({title:String(event.summary || 'Calendar event').slice(0,160),date,time,owner:'',place:'',location:String(event.location || '').slice(0,400),category:'Appointment',notes:'Copied from Google Calendar. This is a snapshot; later Google changes do not update this task automatically.'},user);
      value.source={hash:sourceHash,copiedAt:new Date().toISOString()};const item=put('task',randomUUID(),value);audit(user.id,'google-event-copied',item.id);return ok(item);
    }
    if(path === '/api/export' && req.method === 'POST') {if(user.role!=='owner')fail(403,'Owner only');audit(user.id,'data-export',user.id);return ok({exportedAt:new Date().toISOString(),people:all('person').map(publicPerson),tasks:all('task'),places:all('place'),notes:all('note')});}
    fail(404,'Not found');
  } catch(error) { const status=error.status || 500; if(status===500) console.error('Request failed',error.code || error.name); send(status,{error:status===500?'The server could not complete this request. Try again.':error.message}); }
});
server.requestTimeout=20000;server.headersTimeout=20000;server.maxHeadersCount=40;
server.listen(port,'0.0.0.0',()=>console.log(`Private family hub listening on ${port}`));
setInterval(()=>{db.prepare('DELETE FROM sessions WHERE expires<?').run(Date.now());db.prepare('DELETE FROM oauth WHERE expires<?').run(Date.now());db.prepare('DELETE FROM limits WHERE expires<?').run(Date.now());},3600000).unref();
for(const signal of ['SIGINT','SIGTERM']) process.on(signal,()=>{server.close(()=>{db.exec('PRAGMA wal_checkpoint(TRUNCATE)');db.close();process.exit(0);});setTimeout(()=>process.exit(0),10000).unref();});
