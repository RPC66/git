export const CATEGORIES = ['学习', '工作', '生活', '健康', '其他'];
export function dayKey(d = new Date()) { return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
export function parseDay(s) { const [y,m,d] = s.split('-').map(Number); return new Date(y,m-1,d,12); }
export function validDay(s) { return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && dayKey(parseDay(s)) === s; }
export function shiftDay(s,n) { const d=parseDay(s); d.setDate(d.getDate()+n); return dayKey(d); }
export function weekStart(s) { const d=parseDay(s); return shiftDay(s,-((d.getDay()+6)%7)); }
export function inRange(s,date,period) { if(period==='all') return true; if(period==='month') return s.slice(0,7)===date.slice(0,7); if(period==='week') {const start=weekStart(date);return s>=start&&s<=shiftDay(start,6);} return s===date; }
export function streak(tasks,today) { const days=new Set(tasks.map(t=>t.date));let date=days.has(today)?today:shiftDay(today,-1),n=0; while(days.has(date)){n++;date=shiftDay(date,-1);}return n; }
export function validateBackup(data) {
 if (!data || data.version!==1 || !Array.isArray(data.tasks) || data.tasks.length>100000 || !data.reflections || typeof data.reflections!=='object' || Array.isArray(data.reflections)) throw new Error('这不是有效的日有所成备份文件');
 const ids=new Set();
 const tasks=data.tasks.map(t=>{if(!t || typeof t.id!=='string'||!t.id||ids.has(t.id)||!validDay(t.date)||typeof t.title!=='string'||!t.title.trim()||t.title.length>150||!CATEGORIES.includes(t.category)||!Number.isInteger(t.minutes)||t.minutes<0||t.minutes>1440||typeof t.note!=='string'||t.note.length>2000) throw new Error('备份中的事项格式有误');ids.add(t.id);return {id:t.id,date:t.date,title:t.title,category:t.category,minutes:t.minutes,note:t.note};});
 const reflections={}; for(const [date,note] of Object.entries(data.reflections)){if(!validDay(date)||typeof note!=='string'||note.length>4000) throw new Error('备份中的回顾格式有误');reflections[date]=note;}
 return {version:1,tasks,reflections};
}
