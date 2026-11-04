import {readSession,accountStorage,appApi,AUTH_KEY} from './account.mjs';
import {syncAccount,migrateBackup} from './cloud-sync.mjs';
import {readRecords,readSyncState,KEY,MIGRATION,CHECKPOINT} from './storage.mjs?v=3';
import {materialize,recoveryBackup,validateState} from './sync-state.mjs?v=1';
import {validateBackup} from './model.mjs';
import {createClient} from './legacy-github.mjs';
import './install.mjs';

export async function initializeAccount(){
 const session=readSession();if(!session){location.replace('./login.html');throw new Error('请登录邮箱账号');}
 try{const result=await appApi('me',{session});if(result.user.id!==session.user.id){localStorage.removeItem(AUTH_KEY);location.replace('./login.html');throw new Error('请重新登录');}}
 catch(error){if(error.status===401){localStorage.removeItem(AUTH_KEY);location.replace('./login.html');throw error;}}
 return {session,storage:accountStorage(session.user.id)};
}
export function setupCloudApp({session,storage,getBackup,onSynced}){
 const $=id=>document.getElementById(id),dialog=$('account-dialog');let busy=false,timer=null,stopped=false,pendingImport=null,dirty=false;
 $('account-label').textContent=session.user.label;$('account-email').textContent=session.user.label;
 function report(message){$('cloud-status').textContent=message;$('save-backup-status').textContent=message;}
 function schedule(delay=30000){clearTimeout(timer);if(!stopped)timer=setTimeout(()=>synchronize(),delay);}
 async function synchronize(manual=false){
  if(stopped||busy)return;if(document.hidden&&!manual){schedule();return;}
  if(navigator.onLine===false){report('离线记录已保存在本机，联网后自动同步');schedule();return;}
  busy=true;clearTimeout(timer);$('save-backup').disabled=true;$('cloud-sync-now').disabled=true;report('正在同步账号记录…');
  let failed=false;
  try{await getBackup({includeDrafts:manual});const result=await syncAccount({session,storage});dirty=result.pending;onSynced?.();report(result.pending?'本机有新修改，正在继续同步…':'✓ 已与账号同步 · '+new Date().toLocaleTimeString('zh-CN'));}
  catch(error){failed=true;if(error.status===401){stopped=true;localStorage.removeItem(AUTH_KEY);report('登录已过期，本机记录保留，请重新登录');location.replace('./login.html');}else report('暂未同步：'+error.message+' 本机修改保留。');}
  finally{busy=false;$('save-backup').disabled=false;$('cloud-sync-now').disabled=false;schedule(failed?60000:dirty?2000:30000);}
 }
 function changed(){dirty=true;report('已保存到本机，等待同步到账号…');if(!busy)schedule(2000);}
 window.addEventListener('daily-done-changed',changed);
 window.addEventListener('storage',event=>{if(event.key===storage.recordKey)changed();if(event.key===AUTH_KEY){stopped=true;location.replace('./login.html');}});
 document.addEventListener('visibilitychange',()=>{if(!document.hidden)synchronize();});window.addEventListener('online',()=>synchronize());
 $('account-settings').onclick=()=>dialog.showModal();$('account-close').onclick=()=>dialog.close();
 $('cloud-sync-now').onclick=()=>synchronize(true);$('save-backup').onclick=()=>synchronize(true);
 function download(data,name){const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'})),link=document.createElement('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
 $('download-migration').onclick=()=>{try{const raw=storage.getItem(MIGRATION);if(!raw)throw new Error('暂无迁移副本');download(validateBackup(JSON.parse(raw)),'日有所成-应用迁移前备份.json');}catch(error){report(error.message);}};
 $('download-history').onclick=()=>{try{download(recoveryBackup(readSyncState(storage)),'日有所成-账号历史版本.json');}catch(error){report(error.message);}};
 $('download-checkpoint').onclick=()=>{try{const raw=storage.getItem(CHECKPOINT);if(!raw)throw new Error('暂无导入前备份');download(validateBackup(JSON.parse(raw)),'日有所成-导入前备份.json');}catch(error){report(error.message);}};
 function preview(backup){pendingImport=backup;const records=backup.format?materialize(backup):validateBackup(backup);$('migration-summary').textContent=`找到 ${records.tasks.length} 件事项、${Object.values(records.reflections).filter(Boolean).length} 天感想。将合并到 ${session.user.label}，原网页记录和 GitHub 备份保留。冲突内容另存一份，迁移前可恢复。`;dialog.close();$('migration-dialog').showModal();}
 $('migrate-local').onclick=()=>{try{const raw=localStorage.getItem(KEY);if(!raw)throw new Error('这个浏览器尚未发现旧版记录。可从原网页导出后使用“导入”，或从 GitHub 迁移。');const old=JSON.parse(raw);preview(old._sync?validateState(old._sync):validateBackup(old));}catch(error){report(error.message);}};
 $('migrate-github').onclick=async()=>{
  if(busy)return;busy=true;$('migrate-github').disabled=true;report('正在读取原 GitHub 备份…');
  try{let saved;try{saved=JSON.parse(localStorage.getItem('daily-done:github-sync-auth')||'null');}catch{}
   const token=$('migration-token').value.trim()||saved?.token,repo=$('migration-repo').value.trim()||saved?.repository;
   if(!token)throw new Error('请填写原 GitHub 令牌，仅迁移时使用；日常账号同步不需要它。');
   const client=createClient(token),remote=await client.readState(repo);if(remote.state)preview(remote.state);else{const files=await client.list(repo);if(!files.length)throw new Error('原仓库暂无备份');preview(await client.restore(repo,files[0].path));}
  }catch(error){report(error.message);}finally{$('migration-token').value='';busy=false;$('migrate-github').disabled=false;}
 };
 $('migration-cancel').onclick=()=>{pendingImport=null;$('migration-dialog').close();};
 $('migration-confirm').onclick=async()=>{if(!pendingImport||busy)return;busy=true;$('migration-confirm').disabled=true;
  try{await getBackup();await migrateBackup(pendingImport,storage);pendingImport=null;$('migration-dialog').close();onSynced?.();changed();report('旧记录已合并到本机账号，正在上传。原记录保留。');}
  catch(error){$('migration-summary').textContent=error.message;}finally{busy=false;$('migration-confirm').disabled=false;if(dirty)schedule(0);}
 };
 $('logout-app').onclick=async()=>{if(busy)return;busy=true;clearTimeout(timer);stopped=true;
  try{await getBackup({includeDrafts:true});}catch(error){busy=false;stopped=false;report('退出前保存未完成：'+error.message);schedule();return;}
  try{if(navigator.onLine!==false){try{await syncAccount({session,storage});}catch{}try{await appApi('auth/logout',{session,body:{}});}catch{}}}
  finally{localStorage.removeItem(AUTH_KEY);location.replace('./login.html');}
 };
 report('记录保存在当前邮箱账号，正在检查同步…');synchronize();
}
