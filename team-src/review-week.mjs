import {weekStart,shiftDay,validDay,CATEGORIES} from './model.mjs';
export function weekRange(date){if(!validDay(date))throw Error('日期无效');const start=weekStart(date);return {start,end:shiftDay(start,6)};}
export function weekRecords(data,date){const {start,end}=weekRange(date);return {version:1,tasks:data.tasks.filter(t=>t.date>=start&&t.date<=end),reflections:Object.fromEntries(Object.entries(data.reflections).filter(([day])=>day>=start&&day<=end))};}
export function moveWeek(date,delta){return shiftDay(weekRange(date).start,delta*7);}
export function weekCategoryCounts(data,date){const tasks=weekRecords(data,date).tasks;return CATEGORIES.map(category=>({category,count:tasks.filter(task=>task.category===category).length}));}
export function weekInsights(data,date){
 const {start}=weekRange(date),week=weekRecords(data,date),categories=weekCategoryCounts(data,date);
 const days=Array.from({length:7},(_,i)=>{const day=shiftDay(start,i);return {day,count:week.tasks.filter(task=>task.date===day).length};});
 const recordedDays=new Set([...week.tasks.map(task=>task.date),...Object.entries(week.reflections).filter(([,note])=>!!note).map(([day])=>day)]).size;
 const max=Math.max(0,...categories.map(item=>item.count));
 return {categories,days,total:week.tasks.length,recordedDays,topCategories:max?categories.filter(item=>item.count===max).map(item=>item.category):[]};
}
