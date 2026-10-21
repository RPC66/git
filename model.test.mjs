import test from 'node:test';
import assert from 'node:assert/strict';
import {dayKey,validDay,shiftDay,weekStart,inRange,streak,validateBackup} from './public/model.mjs';
test('local dates, leap days, and month/year transitions',()=>{
 assert.equal(dayKey(new Date(2026,9,21,0,1)),'2026-10-21');
 assert.equal(shiftDay('2026-01-01',-1),'2025-12-31');
 assert.equal(shiftDay('2024-02-28',1),'2024-02-29');
 assert.equal(validDay('2025-02-29'),false);assert.equal(validDay('2024-02-29'),true);
});
test('Monday weeks span months and exclude following Monday',()=>{
 assert.equal(weekStart('2026-11-01'),'2026-10-26');
 assert.equal(inRange('2026-10-26','2026-11-01','week'),true);
 assert.equal(inRange('2026-11-02','2026-11-01','week'),false);
 assert.equal(inRange('2026-10-31','2026-11-01','month'),false);
});
test('streak allows today to be unrecorded and ignores future dates',()=>{
 assert.equal(streak([{date:'2026-10-20'},{date:'2026-10-19'},{date:'2026-10-22'}],'2026-10-21'),2);
 assert.equal(streak([{date:'2026-10-19'}],'2026-10-21'),0);
});
test('backup round trip preserves notes and rejects corrupt records',()=>{
 const task={id:'sample-id',date:'2026-10-21',title:'读书 & 练习',category:'学习',minutes:30,note:'记下收获\n明天继续'};
 const data={version:1,tasks:[task],reflections:{'2026-10-21':'一点点进步'}};
 assert.deepEqual(validateBackup(JSON.parse(JSON.stringify(data))),data);
 assert.throws(()=>validateBackup({...data,tasks:[task,task]}));
 assert.throws(()=>validateBackup({...data,tasks:[{...task,date:'2026-02-30'}]}));
 assert.throws(()=>validateBackup({...data,tasks:[{...task,minutes:-1}]}));
 assert.throws(()=>validateBackup({version:1,tasks:[],reflections:[]}));
});
