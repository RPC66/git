import {weekStart,shiftDay,validDay} from './model.mjs';
export function weekRange(date){if(!validDay(date))throw Error('日期无效');const start=weekStart(date);return {start,end:shiftDay(start,6)};}
export function weekRecords(data,date){const {start,end}=weekRange(date);return {version:1,tasks:data.tasks.filter(t=>t.date>=start&&t.date<=end),reflections:Object.fromEntries(Object.entries(data.reflections).filter(([day])=>day>=start&&day<=end))};}
export function moveWeek(date,delta){return shiftDay(weekRange(date).start,delta*7);}
