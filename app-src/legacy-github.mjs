import {validateBackup} from './model.mjs';
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
