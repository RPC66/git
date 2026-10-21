import test from 'node:test';
import assert from 'node:assert/strict';
import {KEY,CHECKPOINT,readRecords,writeOperations,writeRecordsLocked,mergeWithCheckpoint,restoreSummary} from './docs/storage.mjs';
const task={id:'a',date:'2026-10-21',title:'完成阅读',category:'学习',minutes:20,note:''};
const memory=()=>{const map=new Map();return {getItem:key=>map.get(key)??null,setItem:(key,value)=>map.set(key,value)};};
function locks(){let tail=Promise.resolve();return {request:(name,fn)=>{assert.equal(name,'daily-done:local-records');const result=tail.then(fn);tail=result.catch(()=>{});return result;}};}
test('concurrent local writes use the same lock and preserve both records',async()=>{const storage=memory(),lock=locks();await Promise.all([writeRecordsLocked(storage,[{type:'put-task',task}],lock),writeRecordsLocked(storage,[{type:'put-task',task:{...task,id:'b'}}],lock)]);assert.equal(readRecords(storage).tasks.length,2);});
test('restore previews conflicts and retains a recoverable checkpoint',async()=>{const storage=memory();writeOperations(storage,[{type:'put-task',task}]);const backup={version:1,tasks:[{...task,title:'旧版事项'}],reflections:{}};assert.equal(restoreSummary(readRecords(storage),backup).tasks,1);await mergeWithCheckpoint(storage,backup,locks());assert.equal(readRecords(storage).tasks[0].title,'旧版事项');assert.equal(JSON.parse(storage.getItem(CHECKPOINT)).tasks[0].title,task.title);});
test('checkpoint storage failure cancels restoration without changing records',async()=>{const storage=memory();writeOperations(storage,[{type:'put-task',task}]);const blocked={getItem:storage.getItem,setItem(key,value){if(key===CHECKPOINT)throw new Error('quota');storage.setItem(key,value);}};await assert.rejects(mergeWithCheckpoint(blocked,{version:1,tasks:[{...task,title:'旧版'}],reflections:{}},locks()),/取消恢复/);assert.equal(readRecords(storage).tasks[0].title,task.title);});
test('local records persist, update, delete and restore across reloads',()=>{
 const storage=memory();assert.equal(readRecords(storage).tasks.length,0);
 writeOperations(storage,[{type:'put-task',task},{type:'put-reflection',date:task.date,note:'有所收获'}]);
 assert.equal(readRecords(storage).tasks[0].title,task.title);
 writeOperations(storage,[{type:'put-task',task:{...task,title:'修改后的事项'}}]);
 assert.equal(readRecords(storage).tasks[0].title,'修改后的事项');
 writeOperations(storage,[{type:'delete-task',id:task.id}]);assert.equal(readRecords(storage).tasks.length,0);
 writeOperations(storage,[{type:'put-task',task}]);assert.equal(readRecords(storage).reflections[task.date],'有所收获');
});
test('writes preserve unrelated records saved by another tab',()=>{
 const storage=memory();writeOperations(storage,[{type:'put-task',task}]);
 writeOperations(storage,[{type:'put-task',task:{...task,id:'b'}}]);
 writeOperations(storage,[{type:'put-reflection',date:task.date,note:'感想'}]);
 assert.equal(readRecords(storage).tasks.length,2);
});
test('corrupt or unavailable storage is never silently overwritten',()=>{
 const storage=memory();storage.setItem(KEY,'broken');assert.throws(()=>writeOperations(storage,[{type:'put-task',task}]),/原始数据已保留/);assert.equal(storage.getItem(KEY),'broken');
 assert.throws(()=>readRecords({getItem(){throw new Error();}}),/禁止读取/);
 assert.throws(()=>writeOperations({getItem:()=>null,setItem(){throw new Error();}},[{type:'put-task',task}]),/保存失败/);
});
