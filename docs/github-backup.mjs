import {validateBackup} from './model.mjs';
import {synchronizeDevice} from './device-sync.mjs?v=2';
import {readSyncState,MIGRATION} from './storage.mjs?v=3';
import {recoveryBackup} from './sync-state.mjs?v=1';
import {validateState} from './sync-state.mjs?v=1';
const API='https://api.github.com';
export function checkEmptyBackup(data,files,allowEmpty=false){if(!allowEmpty&&!data.tasks.length&&!Object.values(data.reflections).some(Boolean)&&files.length)throw new Error('当前浏览器没有记录，但 GitHub 已有备份。请先恢复；若确实需要空备份，请勾选“允许上传空记录”。');}
export function encodeBackup(data){const bytes=new TextEncoder().encode(JSON.stringify({...validateBackup(data),exportedAt:new Date().toISOString()},null,2));let binary='';for(const byte of bytes)binary+=String.fromCharCode(byte);return btoa(binary);}
export function decodeBackup(content){const binary=atob(content.replace(/\s/g,''));return validateBackup(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Uint8Array.from(binary,c=>c.charCodeAt(0)))));}
export function createClient(token,request=fetch){
 async function api(path,options={}){
  let response;try{response=await request(API+path,{...options,headers:{Authorization:`Bearer ${token}`,Accept:'application/vnd.github+json','Content-Type':'application/json','X-GitHub-Api-Version':'2026-03-10',...options.headers},redirect:'error',cache:'no-store',signal:AbortSignal.timeout(30000)});}catch{throw new Error('无法连接 GitHub，请检查网络后重试。');}
  if(!response.ok){const messages={401:'授权已失效，请重新填写令牌。',403:'没有操作权限或请求过于频繁，请检查令牌权限后重试。',404:'仓库或备份不存在，或令牌没有该仓库的权限。',409:'仓库发生冲突，请重试。',422:'GitHub 无法保存该备份，请稍后重试。'};const error=new Error(messages[response.status]||'GitHub 请求失败，请稍后重试。');error.status=response.status;throw error;}
  return response.json();
 }
 async function repository(name){if(!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(name))throw new Error('请填写 owner/repo 格式的仓库名称。');const repo=await api(`/repos/${name}`);if(repo.private!==true)throw new Error('请使用私有仓库，不能将个人记录备份到公开仓库。');return {base:`/repos/${name}`,branch:repo.default_branch};}
 return {
  async readState(name){const repo=await repository(name);let file;try{file=await api(`${repo.base}/contents/sync/state-v1.json?ref=${encodeURIComponent(repo.branch)}`);}catch(error){if(error.status===404)return {state:null,sha:null};throw error;}
   if(file.size>20*1024*1024)throw new Error('同步历史超过 20 MB，请先导出历史并联系维护者处理。');
   let state;if(file.encoding==='base64'&&file.content){const binary=atob(file.content.replace(/\s/g,''));state=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Uint8Array.from(binary,c=>c.charCodeAt(0))));}
   else state=await api(`${repo.base}/contents/sync/state-v1.json?ref=${encodeURIComponent(repo.branch)}`,{headers:{Authorization:`Bearer ${token}`,Accept:'application/vnd.github.raw+json'}});
   return {state:validateState(state),sha:file.sha};},
  async writeState(name,state,sha){const repo=await repository(name),bytes=new TextEncoder().encode(JSON.stringify(validateState(state)));if(bytes.length>20*1024*1024)throw new Error('同步历史超过 20 MB，本地记录已保留。');let binary='';for(const byte of bytes)binary+=String.fromCharCode(byte);
   return api(`${repo.base}/contents/sync/state-v1.json`,{method:'PUT',body:JSON.stringify({message:'Sync Daily Done devices (preserve history)',content:btoa(binary),branch:repo.branch,...(sha?{sha}:{})})});},
  async backup(name,data){const repo=await repository(name);const path=`backups/${new Date().toISOString().replace(/[:.]/g,'-')}-${crypto.randomUUID()}.json`;await api(`${repo.base}/contents/${path}`,{method:'PUT',body:JSON.stringify({message:'Back up Daily Done records',content:encodeBackup(data),branch:repo.branch})});return path;},
  async list(name){const repo=await repository(name);const entries=await api(`${repo.base}/contents?ref=${encodeURIComponent(repo.branch)}`);if(!entries.some(e=>e.type==='dir'&&e.name==='backups'))return [];
   const files=await api(`${repo.base}/contents/backups?ref=${encodeURIComponent(repo.branch)}`);return files.filter(f=>f.type==='file'&&/^backups\/[\w.-]+\.json$/.test(f.path)).sort((a,b)=>b.name.localeCompare(a.name));},
  async restore(name,path){if(!/^backups\/[\w.-]+\.json$/.test(path))throw new Error('无效的备份路径。');const repo=await repository(name);const file=await api(`${repo.base}/contents/${path}?ref=${encodeURIComponent(repo.branch)}`);if(file.size>20*1024*1024)throw new Error('备份过大，请从 GitHub 下载后使用文件导入。');try{if(file.encoding==='base64'&&file.content)return decodeBackup(file.content);return validateBackup(await api(`${repo.base}/contents/${path}?ref=${encodeURIComponent(repo.branch)}`,{headers:{Accept:'application/vnd.github.raw+json'}}));}catch{throw new Error('备份文件无法读取或格式有误，本地记录未改变。');}}
 };
}
export function setupGitHubBackup({getBackup,onRestore,onSynced}){
 const $=id=>document.getElementById(id),dialog=$('github-dialog'),AUTH='daily-done:github-sync-auth';
 let token='',busy=false,enabled=false,enabledRepo='',timer=null,failures=0,dirty=false;
 const status=message=>$('github-status').textContent=message;
 function report(message){$('github-auto-status').textContent=message;$('save-backup-status').textContent=message;$('account-label').textContent=enabled?'GitHub 双向同步':'本机记录 · 未连接同步';}
 function clearTimer(){if(timer!==null)clearTimeout(timer);timer=null;}
 function schedule(delay=30000){clearTimer();if(enabled)timer=setTimeout(()=>syncNow(false),delay);}
 function credentials(){const entered=$('github-token').value.trim();if(entered){token=entered;$('github-token').value='';}if(!token)throw new Error('请先填写仅允许此备份仓库的 GitHub 令牌。');return createClient(token);}
 function remember(){if($('github-remember').checked)localStorage.setItem(AUTH,JSON.stringify({repository:enabledRepo,token}));else localStorage.removeItem(AUTH);}
 async function run(action){if(busy)return;busy=true;clearTimer();$('save-backup').disabled=true;dialog.querySelectorAll('button,input,select').forEach(e=>e.disabled=true);try{return await action();}catch(error){status(error.message);report('同步未完成：'+error.message+' 本机记录保留。'+(enabled?'将稍后重试。':'请连接后重试。'));failures++;}finally{busy=false;$('save-backup').disabled=false;dialog.querySelectorAll('button,input,select').forEach(e=>e.disabled=false);if(enabled)schedule(dirty&&!failures?2000:Math.min(120000,30000*2**Math.min(failures,2)));}}
 async function perform(includeDrafts=false){
  const client=credentials(),repository=$('github-repo').value.trim();
  if(!enabled||repository!==enabledRepo){clearTimer();enabledRepo=repository;}enabled=true;
  report('正在合并手机、电脑和 GitHub 上的记录…');await getBackup({includeDrafts});
  const result=await synchronizeDevice({client,repository,storage:localStorage,locks:navigator.locks});
  enabled=true;enabledRepo=repository;failures=0;dirty=result.pending;
  try{remember();}catch{status('同步成功，但无法记住授权；刷新后请重新连接。');}
  onSynced?.(result.records);
  const message=result.pending?'本机有新修改，即将继续同步':'✓ 手机与电脑已同步 · '+new Date().toLocaleTimeString('zh-CN');
  report(message);status(`当前共 ${result.records.tasks.length} 件事项。旧备份和修改历史保留。`);if(result.pending)schedule(2000);return result;
 }
 async function syncNow(includeDrafts=false){if(!enabled&&!includeDrafts)return;if(document.hidden&&!includeDrafts)return schedule();if(navigator.onLine===false){report('当前离线，记录保存在本机，联网后继续同步');schedule();return;}return run(()=>perform(includeDrafts));}
 function changed(){dirty=true;report(enabled?'已保存到本机，正在等待同步…':'已保存到本机 · 请连接 GitHub 双向同步');if(enabled&&!busy)schedule(2000);}
 window.addEventListener('daily-done-changed',changed);
 window.addEventListener('storage',event=>{if(event.key==='daily-done-v1')changed();});
 window.addEventListener('online',()=>{if(enabled)syncNow();});
 document.addEventListener('visibilitychange',()=>{if(!document.hidden&&enabled)syncNow();});
 $('github-open').onclick=()=>{status(token?'已授权，可立即同步。':'手机和电脑分别连接同一个私有仓库，首次连接会自动迁移旧备份。');dialog.showModal();};
 $('github-close').onclick=()=>{if(!busy){$('github-token').value='';dialog.close();}};
 dialog.addEventListener('cancel',event=>{if(busy)event.preventDefault();else $('github-token').value='';});
 $('github-disconnect').onclick=()=>{enabled=false;token='';enabledRepo='';clearTimer();$('github-token').value='';$('github-remember').checked=false;localStorage.removeItem(AUTH);report('已断开同步，本机记录和 GitHub 备份均保留');status('已清除本设备保存的授权。');};
 $('github-enable-auto').onclick=()=>run(()=>perform(true));
 $('github-save').onclick=()=>run(async()=>{const result=await perform(true);await credentials().backup(enabledRepo,result.records);status('双向同步完成，并已创建独立备份快照。');});
 $('save-backup').onclick=()=>{if(!token&&!$('github-token').value.trim()){status('请填写 GitHub 令牌，然后点击“连接并同步”。');if(!dialog.open)dialog.showModal();return;}return syncNow(true);};
 for(const id of ['github-repo','github-token'])$(id).addEventListener('input',()=>{enabled=false;clearTimer();report('连接配置已修改，请重新连接并同步');});
 $('github-remember').onchange=()=>{if(enabled)try{remember();}catch{status('浏览器不允许保存授权，请每次打开后重新填写令牌。');}};
 $('github-list').onclick=()=>run(async()=>{const files=await credentials().list($('github-repo').value.trim());$('github-files').replaceChildren();for(const file of files){const option=document.createElement('option');option.value=file.path;option.textContent=file.name;$('github-files').append(option);}status(files.length?`找到 ${files.length} 份历史备份。日常跨设备更新请使用“连接并同步”。`:'暂无独立备份。同步记录保存在私有仓库中。');});
 $('github-restore').onclick=()=>run(async()=>{if(!$('github-files').value)throw new Error('请先选择历史备份');const backup=await credentials().restore($('github-repo').value.trim(),$('github-files').value);dialog.close();await onRestore(backup);});
 function download(data,name){const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
 $('download-migration').onclick=()=>{try{const raw=localStorage.getItem(MIGRATION);if(!raw)throw new Error('尚未开始迁移，原记录仍在当前浏览器。');download(validateBackup(JSON.parse(raw)),'日有所成-同步迁移前备份.json');}catch(error){status(error.message);}};
 $('download-history').onclick=()=>{try{download(recoveryBackup(readSyncState(localStorage)),'日有所成-全部历史版本.json');status('已导出各条记录的历史版本，可通过“导入”恢复。');}catch(error){status(error.message);}};
 report('本机记录保留 · 连接 GitHub 后自动同步手机与电脑');
 try{const saved=JSON.parse(localStorage.getItem(AUTH)||'null');if(saved?.token&&saved?.repository){token=saved.token;$('github-repo').value=saved.repository;$('github-remember').checked=true;run(()=>perform());}}catch{status('无法读取已保存授权，请重新填写令牌。');}
}
