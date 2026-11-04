import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import {accountStorage,saveSession,readSession,appApi,AUTH_KEY} from './app-src/account.mjs';
import {syncAccount,migrateBackup} from './app-src/cloud-sync.mjs';
import {KEY,readRecords,writeOperations} from './app-src/storage.mjs?v=3';
import {emptyState,mergeStates,materialize} from './app-src/sync-state.mjs?v=1';
const task=id=>({id,title:id,date:'2026-11-04',category:'学习',minutes:12,note:''});
function memory(){const map=new Map();return {getItem:key=>map.get(key)??null,setItem:(key,value)=>map.set(key,value),removeItem:key=>map.delete(key)};}
function locks(){const tails=new Map();return {request(name,fn){const pending=(tails.get(name)||Promise.resolve()).catch(()=>{}).then(fn);tails.set(name,pending);return pending;}};}
const session=id=>({token:'a'.repeat(64),user:{id:'email:'+id,label:id+'@example.com'},expiresAt:Math.floor(Date.now()/1000)+86400});

test('account storage and persisted sessions isolate people and preserve original website records',()=>{
 const shared=memory(),a=accountStorage('email:a',shared),b=accountStorage('email:b',shared);
 shared.setItem(KEY,JSON.stringify({version:1,tasks:[task('old')],reflections:{}}));writeOperations(a,[{type:'put-task',task:task('a')}]);
 assert.equal(readRecords(b).tasks.length,0);assert.equal(JSON.parse(shared.getItem(KEY)).tasks[0].id,'old');
 const auth=session('a');saveSession(auth,shared);assert.deepEqual(readSession(shared),auth);shared.removeItem(AUTH_KEY);assert.equal(readRecords(a).tasks[0].id,'a');assert.equal(readSession(shared),null);
 assert.equal(readSession({getItem:()=>JSON.stringify({...auth,expiresAt:1})}),null);assert.throws(()=>saveSession({...auth,expiresAt:undefined},shared));
});
test('account sync transfers additions, edits and deletions after offline use on both devices',async()=>{
 const remote=new Map();const api=async(path,{session,body})=>{const current=remote.get(session.user.id)||emptyState();if(body)remote.set(session.user.id,mergeStates(current,body.state));return {state:remote.get(session.user.id)||current};};
 const a=accountStorage('email:one',memory()),b=accountStorage('email:one',memory()),auth=session('one'),lock=locks();
 writeOperations(a,[{type:'put-task',task:task('computer')}]);writeOperations(b,[{type:'put-task',task:task('phone')}]);
 await Promise.all([syncAccount({session:auth,storage:a,locks:lock,api}),syncAccount({session:auth,storage:b,locks:lock,api})]);await syncAccount({session:auth,storage:a,locks:lock,api});assert.equal(readRecords(a).tasks.length,2);
 writeOperations(b,[{type:'delete-task',id:'computer'}]);await syncAccount({session:auth,storage:b,locks:lock,api});await syncAccount({session:auth,storage:a,locks:lock,api});assert.deepEqual(readRecords(a).tasks.map(t=>t.id),['phone']);
 const other=accountStorage('email:other',memory());await syncAccount({session:session('other'),storage:other,locks:lock,api});assert.equal(readRecords(other).tasks.length,0);
});
test('network failure keeps offline changes and migration preserves conflicting old values',async()=>{
 const storage=accountStorage('email:a',memory());writeOperations(storage,[{type:'put-task',task:task('same')}]);
 await assert.rejects(syncAccount({session:session('a'),storage,locks:locks(),api:async()=>{throw new Error('offline');}}),/offline/);assert.equal(readRecords(storage).tasks.length,1);
 await migrateBackup({version:1,tasks:[{...task('same'),title:'old distinct title'}],reflections:{}},storage,locks());const records=readRecords(storage);assert.equal(records.tasks.length,2);assert.ok(records.tasks.some(t=>t.title==='old distinct title'));assert.ok(records.tasks.some(t=>t.title==='same'));
});
test('API only sends a bearer session to the configured service and handles an edge block without deleting data',async()=>{
 let seen;await appApi('sync',{session:session('a'),request:async(url,options)=>{seen={url,options};return Response.json({state:emptyState()});}});
 assert.equal(seen.url,'https://daily-done-oct21.pengchengruan47.chatgpt.site/api/app/sync');assert.equal(seen.options.credentials,'omit');assert.equal(seen.options.redirect,'error');assert.match(seen.options.headers.Authorization,/^Bearer /);
 await assert.rejects(appApi('me',{request:async()=>new Response('<html>Blocked</html>',{status:403})}),/访问受限/);
});
test('install manifest, offline worker and original record UI are packaged together without caching private API data',async()=>{
 const manifest=JSON.parse(await readFile('docs/app/manifest.webmanifest','utf8'));assert.equal(manifest.display,'standalone');assert.equal(manifest.start_url,'./');assert.equal(manifest.scope,'./');assert.ok(manifest.icons.some(i=>i.sizes==='512x512'));
 const html=await readFile('docs/app/index.html','utf8'),original=await readFile('docs/index.html','utf8');
 for(const text of ['今天，也有所成。','时光回顾','今天，你完成了什么？','留给今天的一句话','record-date','review-list','category-bars']){assert.ok(html.includes(text));assert.ok(original.includes(text));}
 assert.ok(original.includes('id="github-open"'));assert.ok(!original.includes('id="account-settings"'));assert.ok(html.includes('id="account-settings"'));
 const sw=await readFile('docs/app/sw.js','utf8');assert.ok(sw.includes("event.request.method!=='GET'"));assert.ok(sw.includes('url.origin!==scope.origin'));assert.ok(!sw.includes('Authorization'));assert.ok(!sw.includes('api/app'));
 assert.ok((await readFile('docs/app/icons/icon-192.png')).length>100);
});
test('installed worker serves offline home and canonical login navigation without intercepting account API requests',async()=>{
 const listeners={},scope='https://rpc66.github.io/git/app/',cached=new Map([[scope+'index.html',new Response('offline home')],[scope+'login.html',new Response('offline login')]]);
 const cache={match:async url=>cached.get(url),addAll:async()=>{}};
 runInNewContext(await readFile('docs/app/sw.js','utf8'),{URL,Promise,self:{registration:{scope},clients:{claim:async()=>{}},addEventListener:(name,fn)=>listeners[name]=fn},caches:{open:async()=>cache,keys:async()=>[],delete:async()=>{}},fetch:async()=>{throw new Error('offline');}});
 async function offline(url){let result;listeners.fetch({request:new Request(url),respondWith:value=>result=value});return result;}
 assert.equal(await (await offline(scope)).text(),'offline home');assert.equal(await (await offline(scope+'login')).text(),'offline login');assert.equal(await offline('https://rpc66.github.io/api/app/sync'),undefined);assert.equal(await offline('https://daily-done-oct21.pengchengruan47.chatgpt.site/api/app/sync'),undefined);
});
