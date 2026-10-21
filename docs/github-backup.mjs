import {validateBackup} from './model.mjs';
import {createAutoBackup} from './auto-backup.mjs?v=2';
import {coordinatedBackup} from './backup-coordinator.mjs?v=1';
const API='https://api.github.com';
export function encodeBackup(data){const bytes=new TextEncoder().encode(JSON.stringify({...validateBackup(data),exportedAt:new Date().toISOString()},null,2));let binary='';for(const byte of bytes)binary+=String.fromCharCode(byte);return btoa(binary);}
export function decodeBackup(content){const binary=atob(content.replace(/\s/g,''));return validateBackup(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Uint8Array.from(binary,c=>c.charCodeAt(0)))));}
export function createClient(token,request=fetch){
 async function api(path,options={}){
  let response;try{response=await request(API+path,{...options,headers:{Authorization:`Bearer ${token}`,Accept:'application/vnd.github+json','Content-Type':'application/json','X-GitHub-Api-Version':'2026-03-10'},redirect:'error',cache:'no-store',signal:AbortSignal.timeout(30000)});}catch{throw new Error('无法连接 GitHub，请检查网络后重试。');}
  if(!response.ok){const messages={401:'授权已失效，请重新填写令牌。',403:'没有操作权限或请求过于频繁，请检查令牌权限后重试。',404:'仓库或备份不存在，或令牌没有该仓库的权限。',409:'仓库发生冲突，请重试。',422:'GitHub 无法保存该备份，请稍后重试。'};throw new Error(messages[response.status]||'GitHub 请求失败，请稍后重试。');}
  return response.json();
 }
 async function repository(name){if(!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(name))throw new Error('请填写 owner/repo 格式的仓库名称。');const repo=await api(`/repos/${name}`);if(repo.private!==true)throw new Error('请使用私有仓库，不能将个人记录备份到公开仓库。');return {base:`/repos/${name}`,branch:repo.default_branch};}
 return {
  async backup(name,data){const repo=await repository(name);const path=`backups/${new Date().toISOString().replace(/[:.]/g,'-')}-${crypto.randomUUID()}.json`;await api(`${repo.base}/contents/${path}`,{method:'PUT',body:JSON.stringify({message:'Back up Daily Done records',content:encodeBackup(data),branch:repo.branch})});return path;},
  async list(name){const repo=await repository(name);const entries=await api(`${repo.base}/contents?ref=${encodeURIComponent(repo.branch)}`);if(!entries.some(e=>e.type==='dir'&&e.name==='backups'))return [];
   const files=await api(`${repo.base}/contents/backups?ref=${encodeURIComponent(repo.branch)}`);return files.filter(f=>f.type==='file'&&/^backups\/[\w.-]+\.json$/.test(f.path)).sort((a,b)=>b.name.localeCompare(a.name));},
  async restore(name,path){if(!/^backups\/[\w.-]+\.json$/.test(path))throw new Error('无效的备份路径。');const repo=await repository(name);const file=await api(`${repo.base}/contents/${path}?ref=${encodeURIComponent(repo.branch)}`);if(file.size>20*1024*1024||file.encoding!=='base64'||!file.content)throw new Error('备份过大或格式不支持，请从 GitHub 下载后使用文件导入。');try{return decodeBackup(file.content);}catch{throw new Error('备份文件格式有误，本地记录未改变。');}}
 };
}
export function setupGitHubBackup({getBackup,onRestore}){
 const $=id=>document.getElementById(id),dialog=$('github-dialog');let token='',busy=false,enabled=false,enabledRepo='';
 const status=message=>$('github-status').textContent=message;
 async function upload(force=false){const remote=client(),repo=$('github-repo').value.trim();return coordinatedBackup({repository:repo,getData:getBackup,upload:data=>remote.backup(repo,data),storage:localStorage,locks:navigator.locks,force});}
 const auto=createAutoBackup({authorized:()=>enabled&&!!token&&enabledRepo===$('github-repo').value.trim(),report:message=>{$('github-auto-status').textContent=message;},backup:async()=>{if(busy)throw new Error('另一项 GitHub 操作正在进行');busy=true;try{await upload();}finally{busy=false;}}});
 window.addEventListener('daily-done-changed',()=>auto.changed());
 window.addEventListener('storage',event=>{if(event.key==='daily-done-v1')auto.changed();});
 auto.resume();
 function client(){const entered=$('github-token').value.trim();if(entered){token=entered;$('github-token').value='';}if(!token)throw new Error('请先填写仅允许此备份仓库的 GitHub 令牌。');return createClient(token);}
 async function run(action,saving=false){if(busy){if(saving)$('save-backup-status').textContent='GitHub 操作进行中，请稍后再试';return;}busy=true;$('save-backup').disabled=true;dialog.querySelectorAll('button,input,select').forEach(e=>e.disabled=true);status('正在连接 GitHub…');if(saving){$('save-backup').textContent='正在上传…';$('save-backup-status').textContent='正在保存并上传 GitHub，请暂时不要关闭页面';}try{await action();}catch(error){status(error.message);if(saving)$('save-backup-status').textContent='备份失败：'+error.message;}finally{busy=false;$('save-backup').disabled=false;$('save-backup').textContent='✓ 保存并备份';dialog.querySelectorAll('button,input,select').forEach(e=>e.disabled=false);}}
 $('github-open').onclick=()=>{status(token?'授权已在本次页面中就绪。':'首次使用请填写 GitHub 令牌。');dialog.showModal();};
 $('github-close').onclick=()=>{if(!busy){$('github-token').value='';dialog.close();}};
 dialog.addEventListener('cancel',event=>{if(busy)event.preventDefault();else $('github-token').value='';});
 $('github-disconnect').onclick=()=>{enabled=false;token='';$('github-token').value='';$('github-files').replaceChildren();auto.resume();status('已清除本次页面中的授权。');};
 $('github-enable-auto').onclick=()=>run(async()=>{enabled=false;auto.resume();const repo=$('github-repo').value.trim();const version=auto.version();await upload(true);enabledRepo=repo;enabled=true;auto.saved(version);auto.resume();status('已验证写入权限并完成首次备份。后续有修改时，最多等待 10 分钟自动备份。');});
 function saveNow(){return run(async()=>{const version=auto.version();const data=await upload(true);auto.saved(version);status(`备份成功：${data.tasks.length} 件事项。历史快照已保留。`);$('save-backup-status').textContent=auto.version()===version?'✓ 已上传 GitHub · '+new Date().toLocaleTimeString('zh-CN'):'已上传备份；期间有新修改，请再保存一次';},true);}
 $('github-save').onclick=saveNow;
 $('save-backup').onclick=()=>{if(!token&&!$('github-token').value.trim()){status('请先填写 GitHub 令牌，然后点击“备份到 GitHub”。');$('save-backup-status').textContent='请先在弹窗填写 GitHub 令牌';if(!dialog.open)dialog.showModal();return;}return saveNow();};
 window.addEventListener('daily-done-changed',()=>{$('save-backup-status').textContent='内容已更新，尚未上传这次修改';});
 window.addEventListener('storage',event=>{if(event.key==='daily-done-v1')$('save-backup-status').textContent='记录已更新，可点击保存并备份';});
 $('github-repo').addEventListener('input',()=>{enabled=false;$('github-files').replaceChildren();auto.resume();});
 $('github-token').addEventListener('input',()=>{enabled=false;auto.resume();});
 $('github-list').onclick=()=>run(async()=>{const files=await client().list($('github-repo').value.trim());$('github-files').replaceChildren();for(const file of files){const option=document.createElement('option');option.value=file.path;option.textContent=file.name;$('github-files').append(option);}status(files.length?`找到 ${files.length} 份备份，请选择后点击“恢复所选备份”。`:'仓库暂无备份，请先备份一次。');});
 $('github-restore').onclick=()=>run(async()=>{if(!$('github-files').value)throw new Error('请先读取列表并选择一份备份。');const backup=await client().restore($('github-repo').value.trim(),$('github-files').value);dialog.close();await onRestore(backup);});
}
