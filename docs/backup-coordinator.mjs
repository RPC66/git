export async function coordinatedBackup({repository,getData,upload,storage,locks,force=false}){
 if(!locks)throw new Error('当前浏览器不支持安全的多标签页备份，请使用最新版浏览器。');
 return locks.request('daily-done:backup:'+repository.toLowerCase(),async()=>{
  const data=await getData();
  const bytes=new TextEncoder().encode(JSON.stringify(data));
  const fingerprint=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),x=>x.toString(16).padStart(2,'0')).join('');
  const key='daily-done:backed-up:'+repository.toLowerCase();
  let previous;try{previous=storage.getItem(key);}catch{}
  if(force||previous!==fingerprint){await upload(data);try{storage.setItem(key,fingerprint);}catch{}}
  return data;
 });
}
