import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync,readdirSync } from 'node:fs';
import { createHmac,createHash } from 'node:crypto';
import { createJournalService,normalizePhone } from './lib/journal-service.mjs';
import { tencentRequest } from './lib/sms.mjs';
import { diffRecords,operationBatches } from './public/sync.mjs';
import {emptyState,seedState,mergeStates,appendChanges,materialize} from './public/app/sync-state.mjs';
const origin='https://journal.test';
const phoneA='13900000001',phoneB='13900000002';
const env={PHONE_LOGIN_ENABLED:'true',AUTH_PEPPER:'test-only-pepper-with-at-least-32-characters',TENCENT_SMS_SECRET_ID:'test-id',TENCENT_SMS_SECRET_KEY:'test-secret',TENCENT_SMS_APP_ID:'test-app',TENCENT_SMS_SIGN_NAME:'test-sign',TENCENT_SMS_TEMPLATE_ID:'test-template'};
const sampleTask={id:'same-task-id',date:'2026-10-21',title:'完成阅读',category:'学习',minutes:25,note:'三个要点'};
function fixture(options={}){
 const sqlite=new DatabaseSync(':memory:');for(const name of readdirSync(new URL('./drizzle/',import.meta.url)).filter(n=>n.endsWith('.sql')).sort())sqlite.exec(readFileSync(new URL('./drizzle/'+name,import.meta.url),'utf8'));
 function prepared(sql,args=[]){return {bind(...values){return prepared(sql,values);},async first(){return sqlite.prepare(sql).get(...args)||null;},async all(){return {results:sqlite.prepare(sql).all(...args)};},async run(){const result=sqlite.prepare(sql).run(...args);return {meta:{changes:Number(result.changes)}};}};}
 const db={prepare:sql=>prepared(sql),async batch(statements){sqlite.exec('BEGIN');try{const values=[];for(const s of statements)values.push(await s.run());sqlite.exec('COMMIT');return values;}catch(e){sqlite.exec('ROLLBACK');throw e;}}};
 let time=1792558800;const sent=[];
 const service=createJournalService({db,env:{...env,...options.env},now:()=>time,sendSms:async(_env,phone,code)=>{if(options.failSms)throw Error('provider-error-with-sensitive-data');sent.push({phone,code});},platformUser:options.platformUser||null});
 async function request(path,body,cookie='',requestOrigin=origin){return service.handle(new Request(origin+path,{method:body===undefined?'GET':'POST',headers:{...(body===undefined?{}:{'Content-Type':'application/json',Origin:requestOrigin}),...(cookie?{Cookie:cookie}:{}),'cf-connecting-ip':'192.0.2.1'},body:body===undefined?undefined:JSON.stringify(body)}));}
 async function login(phone){assert.equal((await request('/api/auth/phone/send',{phone,consent:true})).status,200);const code=sent.at(-1).code;const result=await request('/api/auth/phone/verify',{phone,code});assert.equal(result.status,200);return result.headers.get('set-cookie').split(';')[0];}
 return {sqlite,db,service,sent,request,login,advance:n=>time+=n};
}
test('phone normalization and disabled provider fail clearly',async()=>{
 assert.equal(normalizePhone('+86 139-0000-0001'),'+8613900000001');assert.throws(()=>normalizePhone('123'));assert.throws(()=>normalizePhone(null));
 const f=fixture({env:{PHONE_LOGIN_ENABLED:'false'}});const r=await f.request('/api/auth/phone/send',{phone:phoneA,consent:true});assert.equal(r.status,503);assert.equal((await r.json()).code,'SMS_NOT_CONFIGURED');assert.equal(f.sent.length,0);
});
test('OTP creates a secure session, never exposes plaintext, and cannot be reused',async()=>{
 const f=fixture();const send=await f.request('/api/auth/phone/send',{phone:phoneA,consent:true});assert.equal(send.status,200);const result=await send.json();assert.equal('code' in result,false);assert.equal(f.sent[0].code.length,6);
 const row=f.sqlite.prepare('SELECT * FROM phone_challenges').get();assert.notEqual(row.code_hash,f.sent[0].code);assert.equal(JSON.stringify(row).includes(phoneA),false);
 const r=await f.request('/api/auth/phone/verify',{phone:phoneA,code:f.sent[0].code});assert.equal(r.status,200);const setCookie=r.headers.get('set-cookie');assert.match(setCookie,/HttpOnly; Secure; SameSite=Lax/);assert.match(setCookie,/__Host-daily_session=/);
 const cookie=setCookie.split(';')[0],me=await (await f.request('/api/me',undefined,cookie)).json();assert.equal(me.user.label,'139****0001');assert.equal(me.user.provider,'phone');assert.notEqual(f.sqlite.prepare('SELECT token_hash FROM sessions').get().token_hash,cookie.split('=')[1]);
 assert.equal((await f.request('/api/auth/phone/verify',{phone:phoneA,code:f.sent[0].code})).status,400);
 assert.equal((await f.request('/api/auth/logout',{},cookie)).status,200);assert.equal((await f.request('/api/records',undefined,cookie)).status,401);
});
test('wrong-code attempt limit, expiry and resend cooldown are enforced',async()=>{
 const f=fixture();await f.request('/api/auth/phone/send',{phone:phoneA,consent:true});assert.equal((await f.request('/api/auth/phone/send',{phone:phoneA,consent:true})).status,429);
 const correct=f.sent[0].code,bad=correct==='000000'?'111111':'000000';for(let i=0;i<5;i++)assert.equal((await f.request('/api/auth/phone/verify',{phone:phoneA,code:bad})).status,400);
 assert.equal((await f.request('/api/auth/phone/verify',{phone:phoneA,code:correct})).status,400);
 f.advance(61);await f.request('/api/auth/phone/send',{phone:phoneA,consent:true});f.advance(301);assert.equal((await f.request('/api/auth/phone/verify',{phone:phoneA,code:f.sent.at(-1).code})).status,400);
});
test('concurrent requests send once and consume a code once',async()=>{
 const f=fixture();const send=await Promise.all([f.request('/api/auth/phone/send',{phone:phoneA,consent:true}),f.request('/api/auth/phone/send',{phone:phoneA,consent:true})]);assert.deepEqual(send.map(r=>r.status).sort(),[200,429]);assert.equal(f.sent.length,1);
 const verify=await Promise.all([f.request('/api/auth/phone/verify',{phone:phoneA,code:f.sent[0].code}),f.request('/api/auth/phone/verify',{phone:phoneA,code:f.sent[0].code})]);assert.deepEqual(verify.map(r=>r.status).sort(),[200,400]);
});
test('failed SMS never enables its challenge; global and phone budgets cap sends',async()=>{
 const bad=fixture({failSms:true});assert.equal((await bad.request('/api/auth/phone/send',{phone:phoneA,consent:true})).status,502);assert.equal(bad.sqlite.prepare('SELECT ready FROM phone_challenges').get().ready,0);
 const limited=fixture({env:{SMS_DAILY_LIMIT:'1'}});await limited.request('/api/auth/phone/send',{phone:phoneA,consent:true});assert.equal((await limited.request('/api/auth/phone/send',{phone:phoneB,consent:true})).status,429);
 const f=fixture();for(let i=0;i<10;i++){assert.equal((await f.request('/api/auth/phone/send',{phone:phoneA,consent:true})).status,200);f.advance(61);}assert.equal((await f.request('/api/auth/phone/send',{phone:phoneA,consent:true})).status,429);assert.equal(f.sent.length,10);
});
test('cloud records are isolated by authenticated account on reads and writes',async()=>{
 const f=fixture(),cookieA=await f.login(phoneA),cookieB=await f.login(phoneB);
 assert.equal((await f.request('/api/records',{operations:[{type:'put-task',task:sampleTask},{type:'put-reflection',date:'2026-10-21',note:'A 的感想'}]},cookieA)).status,200);
 const dataB=await (await f.request('/api/records',undefined,cookieB)).json();assert.equal(dataB.data.tasks.length,0);assert.deepEqual(dataB.data.reflections,{});
 await f.request('/api/records',{userId:'other-account',operations:[{type:'put-task',task:{...sampleTask,title:'B 的任务'}}]},cookieB);
 const a=await (await f.request('/api/records',undefined,cookieA)).json();assert.equal(a.data.tasks[0].title,sampleTask.title);assert.equal(a.data.reflections['2026-10-21'],'A 的感想');
 await f.request('/api/records',{operations:[{type:'delete-task',id:sampleTask.id}]},cookieB);assert.equal((await (await f.request('/api/records',undefined,cookieA)).json()).data.tasks.length,1);
 assert.equal((await f.request('/api/records')).status,401);
 // A fresh login on another device resolves to the same account and cloud records.
 f.advance(61);const secondDevice=await f.login(phoneA);assert.equal((await (await f.request('/api/records',undefined,secondDevice)).json()).data.tasks[0].title,sampleTask.title);
});
test('cross-origin, invalid and oversized writes fail without partial changes',async()=>{
 const f=fixture(),cookie=await f.login(phoneA);const op={operations:[{type:'put-task',task:sampleTask}]};
 assert.equal((await f.request('/api/records',op,cookie,'https://attacker.test')).status,403);
 assert.equal((await f.request('/api/records',{operations:[...op.operations,{type:'put-task',task:{...sampleTask,id:'bad',date:'2026-02-30'}}]},cookie)).status,400);
 assert.equal((await f.request('/api/records',{padding:'x'.repeat(262145),...op},cookie)).status,413);
 assert.equal((await (await f.request('/api/records',undefined,cookie)).json()).data.tasks.length,0);
});
test('platform fallback uses its server-supplied identity',async()=>{
 const f=fixture({env:{PHONE_LOGIN_ENABLED:'false'},platformUser:{userId:'owner-id',displayName:'当前账号'}});const result=await (await f.request('/api/me')).json();assert.equal(result.user.id,'chatgpt:owner-id');assert.equal(result.smsEnabled,false);
});
test('session expires after 30 days',async()=>{const f=fixture(),cookie=await f.login(phoneA);f.advance(30*86400+1);assert.equal((await f.request('/api/records',undefined,cookie)).status,401);});
test('sync derives per-record changes and bounded import batches',()=>{
 const prev={version:1,tasks:[sampleTask],reflections:{'2026-10-21':'before'}},next={...prev,tasks:[],reflections:{}};
 assert.deepEqual(diffRecords(prev,next),[{type:'delete-task',id:sampleTask.id},{type:'put-reflection',date:'2026-10-21',note:''}]);assert.deepEqual(operationBatches(Array.from({length:123},(_,i)=>i)).map(x=>x.length),[50,50,23]);
});
test('Tencent request signature matches an independent Node crypto calculation',async()=>{
 const now=Date.UTC(2026,9,21,0,1),r=await tencentRequest(env,'+8613900000001','012345',now),hash=s=>createHash('sha256').update(s).digest('hex'),h=(k,s)=>createHmac('sha256',k).update(s).digest();
 const canonical=['POST','/','','content-type:application/json; charset=utf-8\nhost:sms.tencentcloudapi.com\nx-tc-action:sendsms\n','content-type;host;x-tc-action',hash(r.options.body)].join('\n');
 const key=h(h(h('TC3test-secret','2026-10-21'),'sms'),'tc3_request');const signature=h(key,`TC3-HMAC-SHA256\n${now/1000}\n2026-10-21/sms/tc3_request\n${hash(canonical)}`).toString('hex');
 assert.ok(r.options.headers.Authorization.endsWith('Signature='+signature));assert.deepEqual(JSON.parse(r.options.body).TemplateParamSet,['012345','5']);assert.equal(r.options.headers['X-TC-Version'],'2021-01-11');
});
test('email registration and login use a salted password hash and secure session',async()=>{
 const f=fixture(),email='Diary.User@example.com',password='A long diary passphrase 2026';
 const registered=await f.request('/api/auth/email/register',{email,password,confirmed:true});assert.equal(registered.status,200);
 const cookie=registered.headers.get('set-cookie').split(';')[0],me=await (await f.request('/api/me',undefined,cookie)).json();assert.equal(me.user.provider,'email');assert.equal(me.user.label,'di***@example.com');
 const credentials=f.sqlite.prepare('SELECT * FROM email_credentials').get();assert.equal(credentials.email,'diary.user@example.com');assert.match(credentials.password_hash,/^scrypt\$32768\$8\$3\$/);assert.equal(credentials.password_hash.includes(password),false);
 await f.request('/api/records',{operations:[{type:'put-task',task:sampleTask}]},cookie);
 await f.request('/api/auth/logout',{},cookie);assert.equal((await f.request('/api/records',undefined,cookie)).status,401);
 const loggedIn=await f.request('/api/auth/email/login',{email:' diary.user@EXAMPLE.com ',password});assert.equal(loggedIn.status,200);
 const secondCookie=loggedIn.headers.get('set-cookie').split(';')[0];assert.notEqual(secondCookie,cookie);assert.equal((await (await f.request('/api/records',undefined,secondCookie)).json()).data.tasks.length,1);
 assert.equal((await f.request('/api/auth/email/register',{email:email.toLowerCase(),password,confirmed:true})).status,409);
});
test('wrong or unknown email login is generic and creates no session',async()=>{
 const f=fixture(),password='A sufficiently long secret';await f.request('/api/auth/email/register',{email:'user@example.com',password,confirmed:true});
 const wrong=await f.request('/api/auth/email/login',{email:'user@example.com',password:'Another long password'}),unknown=await f.request('/api/auth/email/login',{email:'unknown@example.com',password});
 assert.equal(wrong.status,401);assert.equal(unknown.status,401);assert.deepEqual(await wrong.json(),await unknown.json());assert.equal(wrong.headers.get('set-cookie'),null);assert.equal(f.sqlite.prepare('SELECT count(*) AS n FROM sessions').get().n,1);
});
test('email validation, consent, rate limit and account isolation hold',async()=>{
 const f=fixture(),password='Safe long password for test';
 assert.equal((await f.request('/api/auth/email/register',{email:'wrong',password,confirmed:true})).status,400);
 assert.equal((await f.request('/api/auth/email/register',{email:'ok@example.com',password:'short',confirmed:true})).status,400);
 assert.equal((await f.request('/api/auth/email/register',{email:'ok@example.com',password})).status,400);
 const a=await f.request('/api/auth/email/register',{email:'one@example.com',password,confirmed:true}),b=await f.request('/api/auth/email/register',{email:'two@example.com',password,confirmed:true});
 const cookieA=a.headers.get('set-cookie').split(';')[0],cookieB=b.headers.get('set-cookie').split(';')[0];
 const hashes=f.sqlite.prepare('SELECT password_hash FROM email_credentials').all();assert.notEqual(hashes[0].password_hash,hashes[1].password_hash);
 await f.request('/api/records',{operations:[{type:'put-task',task:sampleTask}]},cookieA);assert.equal((await (await f.request('/api/records',undefined,cookieB)).json()).data.tasks.length,0);
 const hour=Math.floor(1792558800/3600),ip=createHash('sha256').update('192.0.2.1').digest('hex');f.sqlite.prepare('INSERT INTO auth_limits (bucket,hits,expires_at) VALUES (?,?,?)').run(`email-login-ip:${ip}:${hour}`,30,(hour+1)*3600);
 assert.equal((await f.request('/api/auth/email/login',{email:'one@example.com',password})).status,429);
});
test('invalid app sessions never silently switch to the platform account',async()=>{
 const f=fixture({platformUser:{userId:'owner-id',displayName:'Owner'}});assert.equal((await (await f.request('/api/me',undefined,'__Host-daily_session=invalid')).json()).user,null);
});

async function appRequest(f,path,{body,token,origin:requestOrigin='https://rpc66.github.io',method}={}){
 return f.service.handle(new Request(origin+'/api/app/'+path,{method:method||(body===undefined?'GET':'POST'),headers:{Origin:requestOrigin,...(body===undefined?{}:{'Content-Type':'application/json'}),...(token?{Authorization:'Bearer '+token}:{}),'cf-connecting-ip':'192.0.2.90'},body:body===undefined?undefined:JSON.stringify(body)}));
}
async function appRegister(f,email='app@example.com'){
 const response=await appRequest(f,'auth/email/register',{body:{email,password:'App only long passphrase 2026',confirmed:true}});assert.equal(response.status,200);return response.json();
}
test('installed app email sessions support exact GitHub origin CORS and never leak tokens to the old login API',async()=>{
 const f=fixture(),registered=await appRegister(f);
 assert.match(registered.token,/^[a-f0-9]{64}$/);assert.equal(registered.expiresAt,1792558800+30*86400);
 const preflight=await appRequest(f,'sync',{method:'OPTIONS'});assert.equal(preflight.status,204);assert.equal(preflight.headers.get('access-control-allow-origin'),'https://rpc66.github.io');assert.match(preflight.headers.get('access-control-allow-headers'),/Authorization/);
 const me=await appRequest(f,'me',{token:registered.token});assert.equal(me.status,200);assert.equal((await me.json()).user.id,registered.user.id);
 assert.equal((await appRequest(f,'me',{token:registered.token,origin:'https://attacker.test'})).status,403);
 assert.equal((await appRequest(f,'sync')).status,401);
 const old=await f.request('/api/auth/email/login',{email:'app@example.com',password:'App only long passphrase 2026'});assert.equal(old.status,200);assert.equal((await old.json()).token,undefined);
 await appRequest(f,'auth/logout',{token:registered.token,body:{}});assert.equal((await appRequest(f,'me',{token:registered.token})).status,401);
});
test('installed app sync merges concurrent offline edits, supports deletes and isolates account data',async()=>{
 const f=fixture(),a=await appRegister(f,'app-a@example.com'),b=await appRegister(f,'app-b@example.com');
 const one=appendChanges(emptyState(),[{type:'put-task',task:sampleTask}],()=> 'change-a');
 const two=appendChanges(emptyState(),[{type:'put-task',task:{...sampleTask,id:'phone-record',title:'手机记录'}}],()=> 'change-b');
 const results=await Promise.all([appRequest(f,'sync',{token:a.token,body:{state:one}}),appRequest(f,'sync',{token:a.token,body:{state:two}})]);assert.ok(results.every(r=>r.status===200));
 const merged=(await (await appRequest(f,'sync',{token:a.token})).json()).state;assert.equal(materialize(merged).tasks.length,2);
 const other=(await (await appRequest(f,'sync',{token:b.token})).json()).state;assert.equal(materialize(other).tasks.length,0);
 const deleted=appendChanges(merged,[{type:'delete-task',id:sampleTask.id}],()=> 'delete-a');await appRequest(f,'sync',{token:a.token,body:{state:deleted}});
 await appRequest(f,'sync',{token:a.token,body:{state:one}});const final=(await (await appRequest(f,'sync',{token:a.token})).json()).state;assert.equal(materialize(final).tasks.length,1);assert.ok(final.changes.some(c=>c.value?.title===sampleTask.title));
});
test('existing cloud account records are seeded into the installed app without deleting old tables',async()=>{
 const f=fixture(),a=await appRegister(f),id=a.user.id;
 f.sqlite.prepare('INSERT INTO tasks(user_id,id,date,title,category,minutes,note,updated_at) VALUES (?,?,?,?,?,?,?,?)').run(id,sampleTask.id,sampleTask.date,sampleTask.title,sampleTask.category,sampleTask.minutes,sampleTask.note,1792558800);
 const initial=await (await appRequest(f,'sync',{token:a.token})).json();assert.equal(materialize(initial.state).tasks[0].title,sampleTask.title);
 const saved=await appRequest(f,'sync',{token:a.token,body:{state:initial.state}});assert.equal(saved.status,200);assert.equal(f.sqlite.prepare('SELECT count(*) AS n FROM tasks WHERE user_id=?').get(id).n,1);
});
test('bad or conflicting sync states and oversized bodies never overwrite account history',async()=>{
 const f=fixture(),a=await appRegister(f),state=seedState({version:1,tasks:[sampleTask],reflections:{}},'test');
 assert.equal((await appRequest(f,'sync',{token:a.token,body:{state}})).status,200);
 assert.equal((await appRequest(f,'sync',{token:a.token,body:{state:{format:'broken'}}})).status,400);
 const conflict=structuredClone(state);conflict.changes[0].value.title='changed with same revision';assert.equal((await appRequest(f,'sync',{token:a.token,body:{state:conflict}})).status,409);
 assert.equal((await appRequest(f,'sync',{token:a.token,body:{state,padding:'x'.repeat(1024*1024)}})).status,413);
 const remaining=await (await appRequest(f,'sync',{token:a.token})).json();assert.equal(materialize(remaining.state).tasks[0].title,sampleTask.title);
});
test('platform identity and cookie sessions cannot impersonate the installed app bearer session',async()=>{
 const f=fixture({platformUser:{userId:'owner-id'}});assert.equal((await appRequest(f,'me')).status,401);
 const a=await appRegister(f);f.advance(30*86400+1);assert.equal((await appRequest(f,'sync',{token:a.token})).status,401);
});
