import test from 'node:test';
import assert from 'node:assert/strict';
import {createClient,encodeBackup,decodeBackup,checkEmptyBackup} from './docs/github-backup.mjs';
const data={version:1,tasks:[{id:'one',date:'2026-10-21',title:'完成阅读 📚',category:'学习',minutes:20,note:'中文笔记'}],reflections:{'2026-10-21':'今天有所收获 🌱'}};
test('empty device cannot silently create the latest empty snapshot',()=>{const empty={version:1,tasks:[],reflections:{}};assert.throws(()=>checkEmptyBackup(empty,[{}]),/请先恢复/);assert.doesNotThrow(()=>checkEmptyBackup(empty,[{}],true));assert.doesNotThrow(()=>checkEmptyBackup(empty,[]));assert.doesNotThrow(()=>checkEmptyBackup(data,[{}]));});
test('backup preserves Unicode and rejects invalid records',()=>{assert.deepEqual(decodeBackup(encodeBackup(data)),data);assert.throws(()=>decodeBackup(btoa('{}')));});
test('backup writes a unique snapshot into a verified private repository',async()=>{
 const calls=[];const client=createClient('test-only',async(url,options)=>{calls.push({url,options});return Response.json(options.method==='PUT'?{content:{}}:{private:true,default_branch:'main'});});
 const first=await client.backup('RPC66/daily-done-backups',data),second=await client.backup('RPC66/daily-done-backups',data);
 assert.notEqual(first,second);assert.match(first,/^backups\/.*\.json$/);
 const write=calls.find(c=>c.options.method==='PUT');assert.deepEqual(decodeBackup(JSON.parse(write.options.body).content),data);
 assert.equal(JSON.parse(write.options.body).sha,undefined);assert.equal(write.options.redirect,'error');
 assert.ok(calls.every(c=>c.url.startsWith('https://api.github.com/repos/RPC66/daily-done-backups')));
});
test('public repositories, invalid paths and API failures cannot upload or restore',async()=>{
 let puts=0;const client=createClient('test',async(url,options)=>{if(options.method==='PUT')puts++;return Response.json({private:false});});
 await assert.rejects(client.backup('RPC66/git',data),/私有仓库/);assert.equal(puts,0);
 await assert.rejects(client.restore('RPC66/git','../file'),/无效/);
 await assert.rejects(createClient('test',async()=>new Response('',{status:401})).list('RPC66/backups'),/授权已失效/);
});
test('listing and recovery validate the selected snapshot and keep newest first',async()=>{
 const client=createClient('test',async url=>Response.json(url.includes('/contents/backups/')?{content:encodeBackup(data),encoding:'base64',size:500}:url.includes('/contents/backups?')?[{type:'file',name:'2026-02.json',path:'backups/2026-02.json'},{type:'file',name:'2026-03.json',path:'backups/2026-03.json'}]:url.includes('/contents?')?[{type:'dir',name:'backups'}]:{private:true,default_branch:'main'}));
 assert.equal((await client.list('RPC66/backups'))[0].name,'2026-03.json');assert.deepEqual(await client.restore('RPC66/backups','backups/2026-03.json'),data);
});
