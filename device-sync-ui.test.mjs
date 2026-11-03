import test from 'node:test';
import assert from 'node:assert/strict';
import {setupGitHubBackup,encodeBackup} from './docs/github-backup.mjs';
import {KEY,readRecords} from './docs/storage.mjs';

test('connection UI migrates old data, schedules sync, remembers only by choice and disconnects without deleting records',async()=>{
 const names=['document','window','navigator','localStorage','fetch','setTimeout','clearTimeout'],original=new Map(names.map(name=>[name,Object.getOwnPropertyDescriptor(globalThis,name)]));
 const timers=new Map(),memory=new Map(),nodes=new Map();let id=0,state=null,sha=0,snapshotCount=0,synced=0;
 const task={id:'old',title:'原有记录',date:'2026-11-03',category:'学习',minutes:5,note:''},backup={version:1,tasks:[task],reflections:{}};
 const storage={getItem:key=>memory.get(key)??null,setItem:(key,value)=>memory.set(key,value),removeItem:key=>memory.delete(key)};
 const node=name=>{if(!nodes.has(name))nodes.set(name,Object.assign(new EventTarget(),{value:'',checked:false,disabled:false,textContent:'',open:false,showModal(){this.open=true;},close(){this.open=false;},querySelectorAll(){return [...nodes.values()];},replaceChildren(){},append(){}}));return nodes.get(name);};
 const document=Object.assign(new EventTarget(),{hidden:false,getElementById:node,createElement:()=>({click(){}})}),window=new EventTarget();
 const navigator={onLine:true,locks:{request:async(name,fn)=>fn()}};
 const fetch=async(url,options)=>{
  assert.equal(options.headers.Authorization,'Bearer local-qa-fake-token');const path=new URL(url).pathname;
  if(path==='/repos/RPC66/daily-done-backups')return Response.json({private:true,default_branch:'main'});
  if(path.endsWith('/sync/state-v1.json')){
   if(options.method==='PUT'){const body=JSON.parse(options.body);assert.equal(body.sha,sha?String(sha):undefined);state=JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(body.content),c=>c.charCodeAt(0))));sha++;return Response.json({content:{sha:String(sha)}});}
   if(!state)return new Response('',{status:404});return Response.json({sha:String(sha),encoding:'base64',size:500,content:btoa(JSON.stringify(state))});
  }
  if(path.endsWith('/contents'))return Response.json([{name:'backups',type:'dir'}]);
  if(path.endsWith('/contents/backups'))return Response.json([{type:'file',name:'old.json',path:'backups/old.json'}]);
  if(options.method==='PUT'){snapshotCount++;return Response.json({});}
  return Response.json({encoding:'base64',size:500,content:encodeBackup(backup)});
 };
 try{
  for(const [name,value] of Object.entries({document,window,navigator,localStorage:storage,fetch,setTimeout:(fn,delay)=>{timers.set(++id,{fn,delay});return id;},clearTimeout:id=>timers.delete(id)}))Object.defineProperty(globalThis,name,{configurable:true,writable:true,value});
  node('github-repo').value='RPC66/daily-done-backups';
  setupGitHubBackup({getBackup:async()=>readRecords(storage),onRestore:async()=>{},onSynced:()=>synced++});
  await node('save-backup').onclick();assert.equal(node('github-dialog').open,true);assert.equal(sha,0);
  node('github-token').value='local-qa-fake-token';await node('github-enable-auto').onclick();
  assert.equal(synced,1);assert.equal(readRecords(storage).tasks[0].title,'原有记录');assert.equal(storage.getItem('daily-done:github-sync-auth'),null);
  assert.ok([...timers.values()].some(t=>t.delay===30000));assert.match(node('save-backup-status').textContent,/已同步/);
  assert.equal(node('github-token').value,'');assert.ok(!JSON.stringify(state).includes('local-qa-fake-token'));
  node('github-remember').checked=true;node('github-remember').onchange();assert.ok(storage.getItem('daily-done:github-sync-auth'));
  window.dispatchEvent(new Event('daily-done-changed'));assert.ok([...timers.values()].some(t=>t.delay===2000));
  const before=storage.getItem(KEY);node('github-disconnect').onclick();assert.equal(storage.getItem(KEY),before);assert.equal(storage.getItem('daily-done:github-sync-auth'),null);assert.equal(timers.size,0);assert.equal(snapshotCount,0);
 }finally{for(const [name,descriptor] of original)if(descriptor)Object.defineProperty(globalThis,name,descriptor);else delete globalThis[name];}
});
