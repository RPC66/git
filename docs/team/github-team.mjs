import {validateState} from './sync-state.mjs';
const apiOrigin='https://api.github.com';
const loginPattern=/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;
const repositoryPattern=/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
export function createTeamClient(token,request=fetch){
 if(typeof token!=='string'||!token.trim())throw Error('请填写自己的 GitHub 授权令牌');
 async function api(path,options={}){
  let response;try{response=await request(apiOrigin+path,{...options,headers:{Authorization:`Bearer ${token}`,Accept:'application/vnd.github+json','Content-Type':'application/json','X-GitHub-Api-Version':'2022-11-28'},redirect:'error',cache:'no-store',signal:AbortSignal.timeout(30000)});}catch{throw Error('无法连接 GitHub，本机记录保留');}
  if(!response.ok){const error=Error(response.status===401?'GitHub 授权已失效':response.status===404?'仓库不存在或没有访问权限':response.status===409?'记录有更新，请重新同步':'GitHub 请求未完成，请稍后重试');error.status=response.status;throw error;}
  return response.json();
 }
 async function account(){const user=await api('/user');if(!loginPattern.test(user.login))throw Error('无法确认 GitHub 账号');return user.login;}
 async function repo(name){if(!repositoryPattern.test(name))throw Error('请填写 owner/repository 格式的共享仓库');const data=await api('/repos/'+name);if(!data.private)throw Error('请使用私有共享仓库，避免把成员记录公开到互联网');return {name:data.full_name,branch:data.default_branch};}
 const validName=login=>{if(!loginPattern.test(login))throw Error('GitHub 用户名无效');return login.toLowerCase();};
 const path=(name,login)=>`/repos/${name}/contents/members/${validName(login)}/state-v1.json`;
 async function readState(name,login){const repository=await repo(name);let result;try{result=await api(path(repository.name,login)+'?ref='+encodeURIComponent(repository.branch));}catch(e){if(e.status===404)return {state:null,sha:null};throw e;}
  if(result.size>20*1024*1024)throw Error('记录文件过大，请联系维护者');if(result.encoding!=='base64'||!result.content)throw Error('记录文件无法读取，本机记录保留');
  const bytes=Uint8Array.from(atob(result.content.replace(/\s/g,'')),c=>c.charCodeAt(0));return {state:validateState(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes))),sha:result.sha};}
 async function writeState(name,state,sha){const login=await account(),repository=await repo(name),bytes=new TextEncoder().encode(JSON.stringify(validateState(state)));if(bytes.length>20*1024*1024)throw Error('记录历史过大，本机记录保留');let binary='';for(const b of bytes)binary+=String.fromCharCode(b);
  return api(path(repository.name,login),{method:'PUT',body:JSON.stringify({message:`Sync records for ${login}`,branch:repository.branch,content:btoa(binary),...(sha?{sha}:{})})});}
 async function listMembers(name){const repository=await repo(name);let entries;try{entries=await api(`/repos/${repository.name}/contents/members?ref=${encodeURIComponent(repository.branch)}`);}catch(e){if(e.status===404)return [];throw e;}return entries.filter(e=>e.type==='dir'&&loginPattern.test(e.name)).map(e=>e.name).sort((a,b)=>a.localeCompare(b));}
 return {account,repo,readState,writeState,listMembers};
}
