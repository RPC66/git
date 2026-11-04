import {validateBackup,validDay} from './model.mjs';

// Immutable revisions make merging independent of device clocks. Keep superseded
// values too, so editing/deleting on one device never destroys recovery history.
export const emptyState=()=>({format:'daily-done-sync-1',changes:[]});
export function validateState(state){
 if(state?.format!=='daily-done-sync-1'||!Array.isArray(state.changes)||state.changes.length>200000)throw new Error('同步文件格式异常，已停止同步，原记录保留。');
 const seen=new Set();
 for(const change of state.changes){
  if(!change||typeof change.key!=='string'||!change.key||seen.has(change.key)||!Number.isSafeInteger(change.clock)||change.clock<0||typeof change.id!=='string'||!change.id||!['task','reflection'].includes(change.kind))throw new Error('同步历史格式异常');
  seen.add(change.key);
  if(change.kind==='task'&&change.value!==null){const record=validateBackup({version:1,tasks:[change.value],reflections:{}});if(record.tasks[0].id!==change.id)throw new Error('同步事项编号异常');}
  if(change.kind==='reflection'&&(!validDay(change.id)||(change.value!==null&&(typeof change.value!=='string'||change.value.length>4000))))throw new Error('同步感想格式异常');
 }
 return {format:state.format,changes:state.changes.map(c=>({key:c.key,clock:c.clock,kind:c.kind,id:c.id,value:c.value}))};
}
export function mergeStates(...states){
 const changes=new Map();
 for(const state of states)for(const change of validateState(state).changes){const prior=changes.get(change.key);if(prior&&JSON.stringify(prior)!==JSON.stringify(change))throw new Error('同步历史冲突，已保留本地记录');changes.set(change.key,change);}
 return {format:'daily-done-sync-1',changes:[...changes.values()].sort((a,b)=>a.key<b.key?-1:a.key>b.key?1:0)};
}
export function materialize(state){
 const winners=new Map();
 for(const c of validateState(state).changes){const key=c.kind+':'+c.id,prior=winners.get(key);if(!prior||c.clock>prior.clock||(c.clock===prior.clock&&c.key>prior.key))winners.set(key,c);}
 const tasks=[],reflections={};for(const c of winners.values())if(c.value!==null){if(c.kind==='task')tasks.push(c.value);else if(c.value)reflections[c.id]=c.value;}
 tasks.sort((a,b)=>a.id.localeCompare(b.id));return validateBackup({version:1,tasks,reflections});
}
export function seedState(records,source='legacy'){
 const state=emptyState(),data=validateBackup(records);
 for(const task of data.tasks)state.changes.push({key:source+':task:'+task.id,clock:0,kind:'task',id:task.id,value:task});
 for(const [date,note] of Object.entries(data.reflections))if(note)state.changes.push({key:source+':reflection:'+date,clock:0,kind:'reflection',id:date,value:note});
 return state;
}
export function preserveMigrationVariants(local,remote){
 const merged=mergeStates(local,remote),current=materialize(merged),tasks=new Map(current.tasks.map(t=>[t.id,t])),copies=[];
 for(const state of [local,remote]){
  const values=materialize(state);
  for(const task of values.tasks)if(JSON.stringify(tasks.get(task.id))!==JSON.stringify(task)){
   const revision=state.changes.filter(c=>c.kind==='task'&&c.id===task.id&&JSON.stringify(c.value)===JSON.stringify(task)).sort((a,b)=>b.clock-a.clock||(a.key>b.key?-1:1))[0];
   copies.push(seedState({version:1,tasks:[{...task,id:'migration-'+revision.key}],reflections:{}},'migration-copy'));
  }
  for(const [date,note] of Object.entries(values.reflections))if(note!==(current.reflections[date]||'')){
   const revision=state.changes.filter(c=>c.kind==='reflection'&&c.id===date&&c.value===note).sort((a,b)=>b.clock-a.clock||(a.key>b.key?-1:1))[0];
   const parts=[];for(let offset=0;offset<note.length;offset+=2000)parts.push({id:'migration-note-'+revision.key+'-'+offset,date,title:'迁移保留：每日感想'+(offset?'（续）':''),category:'其他',minutes:0,note:note.slice(offset,offset+2000)});
   copies.push(seedState({version:1,tasks:parts,reflections:{}},'migration-copy'));
  }
 }
 return mergeStates(merged,...copies);
}
export function appendChanges(state,operations,uuid=()=>crypto.randomUUID()){
 const next=validateState(state);let clock=next.changes.reduce((max,c)=>Math.max(max,c.clock),0);
 for(const op of operations){let kind,id,value;
  if(op.type==='put-task'){kind='task';id=op.task.id;value=op.task;}
  else if(op.type==='delete-task'){kind='task';id=op.id;value=null;}
  else if(op.type==='put-reflection'){kind='reflection';id=op.date;value=op.note||null;}
  else throw new Error('无法识别的同步操作');
  next.changes.push({key:uuid(),clock:++clock,kind,id,value});
 }
 return validateState(next);
}
export function recoveryBackup(state){
 // Recover every distinct non-empty revision as separate records. Long reflection
 // variants are split without truncating their contents.
 const tasks=[],seen=new Set();
 for(const c of validateState(state).changes){if(c.value===null)continue;const signature=c.kind+':'+c.id+':'+JSON.stringify(c.value);if(seen.has(signature))continue;seen.add(signature);
  if(c.kind==='task')tasks.push({...c.value,id:'history-'+c.key});
  else tasks.push({id:'history-'+c.key,date:c.id,title:'每日感想 · 历史版本',category:'其他',minutes:0,note:c.value.slice(0,2000)});
  if(c.kind==='reflection'&&c.value.length>2000)tasks.push({id:'history-'+c.key+'-part2',date:c.id,title:'每日感想 · 历史版本（续）',category:'其他',minutes:0,note:c.value.slice(2000)});
 }
 return validateBackup({version:1,tasks,reflections:{}});
}
