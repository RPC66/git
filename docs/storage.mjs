import {validateBackup} from './model.mjs';
export const KEY='daily-done-v1';
export const CHECKPOINT='daily-done:before-restore';
export async function writeRecordsLocked(storage,operations,locks=navigator.locks){
 if(!locks)throw new Error('浏览器不支持安全的并发保存，请更新浏览器。');
 return locks.request('daily-done:local-records',()=>writeOperations(storage,operations));
}
export function restoreSummary(current,backup){
 const tasks=new Map(current.tasks.map(task=>[task.id,task]));
 return {tasks:backup.tasks.filter(task=>tasks.has(task.id)&&JSON.stringify(tasks.get(task.id))!==JSON.stringify(task)).length,reflections:Object.entries(backup.reflections).filter(([date,note])=>Object.hasOwn(current.reflections,date)&&current.reflections[date]!==note).length};
}
export async function mergeWithCheckpoint(storage,backup,locks=navigator.locks){
 if(!locks)throw new Error('浏览器不支持安全恢复，请更新浏览器。');
 const valid=validateBackup(backup);
 return locks.request('daily-done:local-records',()=>{
  const current=readRecords(storage);
  try{storage.setItem(CHECKPOINT,JSON.stringify({...current,exportedAt:new Date().toISOString()}));}catch{throw new Error('无法保存恢复前备份，已取消恢复；请先导出并释放存储空间。');}
  return writeOperations(storage,[...valid.tasks.map(task=>({type:'put-task',task})),...Object.entries(valid.reflections).map(([date,note])=>({type:'put-reflection',date,note}))]);
 });
}
export function readRecords(storage){
 let raw;
 try{raw=storage.getItem(KEY);}catch{throw new Error('浏览器禁止读取本地存储，请允许网站存储数据后重试。');}
 if(raw===null)return {version:1,tasks:[],reflections:{}};
 try{return validateBackup(JSON.parse(raw));}catch{throw new Error('本地记录格式异常，原始数据已保留。请先备份浏览器数据再处理。');}
}
export function writeOperations(storage,operations){
 const next=readRecords(storage);
 const tasks=new Map(next.tasks.map(task=>[task.id,task]));
 for(const op of operations){
  if(op.type==='put-task')tasks.set(op.task.id,op.task);
  else if(op.type==='delete-task')tasks.delete(op.id);
  else if(op.type==='put-reflection'){if(op.note)next.reflections[op.date]=op.note;else delete next.reflections[op.date];}
  else throw new Error('无法识别的记录操作');
 }
 next.tasks=[...tasks.values()];
 const valid=validateBackup(next);
 try{storage.setItem(KEY,JSON.stringify(valid));}catch{throw new Error('保存失败：浏览器存储空间不足或存储被禁用。请先导出备份。');}
 return valid;
}
