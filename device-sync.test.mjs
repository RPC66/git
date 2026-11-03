import test from 'node:test';
import assert from 'node:assert/strict';
import {synchronizeDevice} from './docs/device-sync.mjs';
import {KEY,MIGRATION,readRecords,writeOperations,readSyncState} from './docs/storage.mjs';
import {emptyState,appendChanges,mergeStates,materialize,seedState,recoveryBackup} from './docs/sync-state.mjs';
import {createClient} from './docs/github-backup.mjs';
const task=(id,title=id)=>({id,title,date:'2026-11-03',category:'学习',minutes:10,note:''});
const records=(...tasks)=>({version:1,tasks,reflections:{}});
function memory(data){const map=new Map(data?[[KEY,JSON.stringify(data)]]:[]);return {getItem:key=>map.get(key)??null,setItem:(key,value)=>map.set(key,value)};}
function locks(){const tails=new Map();return {request(name,action){const next=(tails.get(name)||Promise.resolve()).catch(()=>{}).then(action);tails.set(name,next);return next;}};}
function server(legacy=records()){
 let state=null,revision=0;const snapshots=[];
 return {snapshots,get state(){return state;},async readState(){return {state:state?structuredClone(state):null,sha:state?String(revision):null};},async writeState(repo,next,sha){if(sha!==(state?String(revision):null)){const error=new Error('conflict');error.status=409;throw error;}state=structuredClone(next);revision++;},async list(){return [{path:'backups/original.json'}];},async restore(){return legacy;},async backup(repo,data){snapshots.push(structuredClone(data));}};
}
const sync=(client,storage,lock=locks())=>synchronizeDevice({client,repository:'RPC66/test-private',storage,locks:lock});

test('first phone migrates latest legacy backup; original local records and snapshots survive',async()=>{
 const remote=server(records(task('computer'))),phone=memory(records(task('phone')));
 await sync(remote,phone);assert.deepEqual(new Set(readRecords(phone).tasks.map(t=>t.id)),new Set(['phone','computer']));
 assert.deepEqual(JSON.parse(phone.getItem(MIGRATION)),records(task('phone')));assert.deepEqual(remote.snapshots,[records(task('phone'))]);
 await sync(remote,phone);assert.equal(remote.snapshots.length,1);
});
test('empty phone reads existing records and never clears the computer',async()=>{
 const remote=server(records(task('old'))),computer=memory();await sync(remote,computer);
 const phone=memory();await sync(remote,phone);assert.equal(readRecords(phone).tasks[0].id,'old');assert.equal(remote.snapshots.length,0);
});
test('different legacy values for the same ID survive migration as extra records',async()=>{
 const local=records(task('same','电脑原内容'));local.reflections['2026-11-03']='本机原感想';
 const old=records(task('same','GitHub 原内容'));old.reflections['2026-11-03']='GitHub 原感想';
 const remote=server(old),storage=memory(local);await sync(remote,storage);
 const result=readRecords(storage);assert.ok(result.tasks.some(t=>t.title==='电脑原内容'));assert.ok(result.tasks.some(t=>t.title==='GitHub 原内容'));
 assert.ok(result.tasks.some(t=>t.note==='本机原感想')||result.reflections['2026-11-03']==='本机原感想');
 assert.ok(result.tasks.some(t=>t.note==='GitHub 原感想')||result.reflections['2026-11-03']==='GitHub 原感想');
 const count=result.tasks.length;await sync(remote,storage);assert.equal(readRecords(storage).tasks.length,count);
});
test('two devices concurrently add records; edits, reflection changes and deletions travel both ways',async()=>{
 const remote=server(),a=memory(),b=memory();await sync(remote,a);await sync(remote,b);
 writeOperations(a,[{type:'put-task',task:task('a')},{type:'put-reflection',date:'2026-11-03',note:'电脑感想'}]);
 writeOperations(b,[{type:'put-task',task:task('b')}]);
 await Promise.all([sync(remote,a),sync(remote,b)]);await sync(remote,a);await sync(remote,b);
 assert.equal(readRecords(a).tasks.length,2);assert.deepEqual(readRecords(a),readRecords(b));
 writeOperations(b,[{type:'put-task',task:task('a','手机修改')},{type:'delete-task',id:'b'},{type:'put-reflection',date:'2026-11-03',note:''}]);
 await sync(remote,b);await sync(remote,a);
 assert.deepEqual(readRecords(a),records(task('a','手机修改')));
 // Repeated reads from an older device cannot resurrect a deleted task.
 await sync(remote,b);assert.equal(materialize(remote.state).tasks.length,1);
 assert.ok(recoveryBackup(remote.state).tasks.some(t=>t.title==='b'));
 assert.ok(recoveryBackup(remote.state).tasks.some(t=>t.note==='电脑感想'));
});
test('concurrent edits converge deterministically and both versions remain recoverable',()=>{
 const initial=seedState(records(task('same'))),a=appendChanges(initial,[{type:'put-task',task:task('same','电脑修改')}],()=> 'a'),b=appendChanges(initial,[{type:'put-task',task:task('same','手机修改')}],()=> 'b');
 assert.deepEqual(mergeStates(a,b),mergeStates(b,a));assert.equal(materialize(mergeStates(a,b)).tasks[0].title,'手机修改');
 assert.deepEqual(new Set(recoveryBackup(mergeStates(a,b)).tasks.map(t=>t.title)),new Set(['same','电脑修改','手机修改']));
});
test('edits made during upload remain local and are sent by the next sync',async()=>{
 const remote=server(),storage=memory();await sync(remote,storage);const original=remote.writeState.bind(remote);
 remote.writeState=async(...args)=>{writeOperations(storage,[{type:'put-task',task:task('late')}]);remote.writeState=original;await original(...args);};
 writeOperations(storage,[{type:'put-task',task:task('early')}]);const result=await sync(remote,storage);assert.equal(result.pending,true);assert.equal(readRecords(storage).tasks.length,2);
 await sync(remote,storage);assert.equal(materialize(remote.state).tasks.length,2);
});
test('network or invalid remote state cannot replace local records; retry retains all changes',async()=>{
 const storage=memory(records(task('local'))),remote=server();remote.writeState=async()=>{throw new Error('offline');};
 await assert.rejects(sync(remote,storage),/offline/);assert.deepEqual(readRecords(storage),records(task('local')));
 assert.ok(storage.getItem(MIGRATION));assert.equal(readSyncState(storage).changes.length,1);
 remote.readState=async()=>({state:{bad:true},sha:'bad'});await assert.rejects(sync(remote,storage));assert.deepEqual(readRecords(storage),records(task('local')));
});
test('failed first sync cannot hide the old cloud backup behind a newer migration snapshot',async()=>{
 const remote=server(records(task('cloud-original'))),storage=memory(records(task('local-original'))),write=remote.writeState.bind(remote);
 remote.list=async()=>[{path:remote.snapshots.length?'backups/new-local-copy.json':'backups/old-cloud.json'}];
 remote.restore=async(repo,path)=>path.includes('new-local-copy')?remote.snapshots.at(-1):records(task('cloud-original'));
 remote.writeState=async()=>{throw new Error('network interrupted');};
 await assert.rejects(sync(remote,storage),/interrupted/);
 assert.equal(readRecords(storage).tasks.length,2);
 remote.writeState=write;await sync(remote,storage);
 assert.deepEqual(new Set(materialize(remote.state).tasks.map(t=>t.id)),new Set(['cloud-original','local-original']));
});
test('CAS retry reads a competing writer again and merges rather than overwriting',async()=>{
 const remote=server(),storage=memory(records(task('mine')));let injected=false;const write=remote.writeState.bind(remote);
 remote.writeState=async(repo,state,sha)=>{if(!injected){injected=true;await write(repo,seedState(records(task('theirs'))),'initial-wrong-sha').catch(async()=>write(repo,seedState(records(task('theirs'))),null));const error=new Error('conflict');error.status=409;throw error;}return write(repo,state,sha);};
 await sync(remote,storage);assert.equal(readRecords(storage).tasks.length,2);
});
test('sync API provides SHA for conditional writes and uses private repositories only',async()=>{
 const calls=[];const state=seedState(records(task('one')));let sha=null,encoded=null;
 const client=createClient('fake-test-only',async(url,options)=>{calls.push({url,options});if(!url.includes('/contents/'))return Response.json({private:true,default_branch:'main'});
  if(options.method==='PUT'){const body=JSON.parse(options.body);assert.equal(body.sha,sha||undefined);encoded=body.content;sha='new-sha';return Response.json({content:{sha}});}
  if(!sha)return new Response('',{status:404});return Response.json({sha,content:encoded,encoding:'base64',size:500});});
 assert.deepEqual(await client.readState('RPC66/private'),{state:null,sha:null});await client.writeState('RPC66/private',state,null);
 assert.deepEqual(await client.readState('RPC66/private'),{state,sha:'new-sha'});await client.writeState('RPC66/private',state,'new-sha');
 assert.ok(calls.every(c=>c.options.redirect==='error'));
});
