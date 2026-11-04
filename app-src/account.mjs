import {API_ORIGIN} from './config.mjs';
import {KEY} from './storage.mjs?v=3';
export const AUTH_KEY='daily-done:email-app-session';
export function readSession(storage=localStorage,now=Date.now()){
 try{const session=JSON.parse(storage.getItem(AUTH_KEY)||'null');if(!session||!/^[a-f0-9]{64}$/.test(session.token)||typeof session.user?.id!=='string'||!session.user.id.startsWith('email:')||!Number.isFinite(session.expiresAt)||session.expiresAt*1000<=now)return null;return session;}catch{return null;}
}
export function saveSession(session,storage=localStorage){
 if(!readSession({getItem:()=>JSON.stringify(session)}))throw new Error('登录信息格式异常，请重试');
 storage.setItem(AUTH_KEY,JSON.stringify(session));
}
export function accountStorage(accountId,storage=localStorage){
 if(typeof accountId!=='string'||!accountId.startsWith('email:'))throw new Error('请先登录邮箱账号');
 const prefix='daily-done:email-account:'+encodeURIComponent(accountId)+':';
 const key=name=>prefix+name;
 return {getItem:name=>storage.getItem(key(name)),setItem:(name,value)=>storage.setItem(key(name),value),removeItem:name=>storage.removeItem(key(name)),recordKey:key(KEY)};
}
export async function appApi(path,{session=null,body,request=fetch}={}){
 let response;try{response=await request(API_ORIGIN+'/api/app/'+path,{method:body===undefined?'GET':'POST',credentials:'omit',redirect:'error',cache:'no-store',headers:{...(body===undefined?{}:{'Content-Type':'application/json'}),...(session?{Authorization:'Bearer '+session.token}:{})},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(30000)});}catch{throw new Error('暂时无法连接账号服务，请检查网络。已有记录保存在本机。');}
 let result;try{result=await response.json();}catch{throw new Error('账号服务暂时不可用或访问受限，请稍后重试。已有记录保留。');}
 if(!response.ok){const error=new Error(result.error||'账号服务请求失败');error.status=response.status;throw error;}
 return result;
}
