import { sha256, hmac, smsConfigured, sendTencentSms } from './sms.mjs';
import { validDay, validateBackup } from '../public/model.mjs';
import { hashPassword,verifyPassword,DUMMY_HASH } from './passwords.mjs';
import {mergeStates,validateState,seedState} from '../public/app/sync-state.mjs';
const SESSION_AGE=30*86400,COOKIE='__Host-daily_session';
export class ApiError extends Error {
  constructor(status,message,extra={}) {super(message);this.status=status;this.extra=extra;}
}
const fail=(status,message,extra)=>{throw new ApiError(status,message,extra);};
export function normalizePhone(value) {
  if(typeof value!=='string') fail(400,'请输入中国大陆手机号码');
  const phone=value.replace(/[\s-]/g,'').replace(/^(\+86|0086)/,'');
  if(!/^1[3-9]\d{9}$/.test(phone)) fail(400,'请输入有效的中国大陆手机号码');
  return '+86'+phone;
}
function randomToken(){return [...crypto.getRandomValues(new Uint8Array(32))].map(x=>x.toString(16).padStart(2,'0')).join('');}
function randomCode(){let n;do{n=crypto.getRandomValues(new Uint32Array(1))[0];}while(n>=4294000000);return String(n%1000000).padStart(6,'0');}
function sameOrigin(request){
  if(request.headers.get('origin')!==new URL(request.url).origin || request.headers.get('sec-fetch-site')==='cross-site') fail(403,'请求来源不匹配，请刷新页面后重试');
  if(request.headers.get('content-type')?.split(';')[0].trim().toLowerCase()!=='application/json') fail(415,'请使用 JSON 请求');
}
async function jsonBody(request,max=262144){
  if(Number(request.headers.get('content-length')||0)>max) fail(413,'一次提交的数据过多，请分批导入');
  const reader=request.body?.getReader();if(!reader)fail(400,'请求内容为空');
  const chunks=[];let size=0;
  while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>max){await reader.cancel();fail(413,'一次提交的数据过多，请分批导入');}chunks.push(value);}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
  try{return JSON.parse(new TextDecoder().decode(bytes));}catch{fail(400,'请求内容格式不正确');}
}
function cookieValue(request,name){const entry=request.headers.get('cookie')?.split(';').map(x=>x.trim()).find(x=>x.startsWith(name+'='));return entry?.slice(name.length+1);}
function response(value,status=200,extra={}){return Response.json(value,{status,headers:{'Cache-Control':'no-store, private','Vary':'Cookie','X-Content-Type-Options':'nosniff','Referrer-Policy':'same-origin',...extra}});}

/** @param {{db:any,env:any,platformUser?:{userId:string,displayName?:string}|null,now?:()=>number,sendSms?:(env:any,phone:string,code:string)=>Promise<void>}} options */
export function createJournalService({db,env,platformUser=null,now=()=>Math.floor(Date.now()/1000),sendSms=sendTencentSms}) {
  const statement=(sql,...args)=>db.prepare(sql).bind(...args);
  const hasDb=()=>{if(!db)fail(503,'云端数据库暂时不可用，请稍后再试');};
  async function rateLimit(bucket,limit,expiresAt){
    const row=await statement('INSERT INTO auth_limits (bucket,hits,expires_at) VALUES (?,1,?) ON CONFLICT(bucket) DO UPDATE SET hits=auth_limits.hits+1 WHERE auth_limits.hits<? RETURNING hits',bucket,expiresAt,limit).first();
    if(!row)fail(429,'请求过于频繁，请稍后重试',{retryAfter:Math.max(1,expiresAt-now())});
  }
  async function identity(request) {
    hasDb();
    const token=new URL(request.url).pathname.startsWith('/api/app/')?request.headers.get('authorization')?.match(/^Bearer ([a-f0-9]{64})$/)?.[1]:cookieValue(request,COOKIE);
    if(token && /^[a-f0-9]{64}$/.test(token)) {
      const account=await statement('SELECT accounts.id,accounts.label FROM sessions JOIN accounts ON accounts.id=sessions.user_id WHERE sessions.token_hash=? AND sessions.expires_at>?',await sha256(token),now()).first();
      if(account)return {...account,provider:account.id.startsWith('email:')?'email':'phone'};
      return null;
    }
    if(token||new URL(request.url).pathname.startsWith('/api/app/'))return null;
    // Only the dispatch-owned server helper may supply platform identity.
    if(platformUser){const id='chatgpt:'+platformUser.userId,label=platformUser.displayName||'当前账号';await statement('INSERT INTO accounts (id,label,created_at) VALUES (?,?,?) ON CONFLICT(id) DO NOTHING',id,label,now()).run();return {id,label,provider:'chatgpt'};}
    return null;
  }
  async function requireIdentity(request){const account=await identity(request);if(!account)fail(401,'请先登录后再查看自己的记录');return account;}
  async function sessionResponse(id,label,provider,app=false){
    const token=randomToken();await statement('INSERT INTO sessions (token_hash,user_id,expires_at) VALUES (?,?,?)',await sha256(token),id,now()+SESSION_AGE).run();
    return response({ok:true,user:{id,label,provider},...(app?{token,expiresAt:now()+SESSION_AGE}:{})},200,app?{}:{'Set-Cookie':`${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_AGE}`});
  }
  async function emailAuth(request,register,app=false){
    hasDb();const body=await jsonBody(request,8192);
    const email=typeof body?.email==='string'?body.email.trim().toLowerCase():'';
    const password=body?.password;
    if(email.length>254||!/^[-a-z0-9.!#$%&'*+/=?^_`{|}~]+@(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/.test(email)||email.split('@')[0].length>64)fail(400,'请输入有效的邮箱地址');
    if(typeof password!=='string'||password.length<12||password.length>128)fail(400,'密码需要 12 至 128 个字符，可使用长密码短语');
    const time=now(),hour=Math.floor(time/3600),emailKey=await sha256(email),ipKey=await sha256(request.headers.get('cf-connecting-ip')||'unknown');
    await rateLimit(`email-${register?'register':'login'}-ip:${ipKey}:${hour}`,register?5:30,(hour+1)*3600);
    await rateLimit(`email-login-account:${emailKey}:${hour}`,15,(hour+1)*3600);
    if(register){
      if(body.confirmed!==true)fail(400,'请确认邮箱填写正确，并了解账号说明');
      await rateLimit(`email-register-global:${hour}`,100,(hour+1)*3600);
      if(await statement('SELECT user_id FROM email_credentials WHERE email=?',email).first())fail(409,'该邮箱已注册，请切换到登录');
      const id='email:'+crypto.randomUUID(),[local,domain]=email.split('@'),label=local.slice(0,2)+'***@'+domain;
      const passwordHash=await hashPassword(password);
      try{await db.batch([statement('INSERT INTO accounts (id,label,created_at) VALUES (?,?,?)',id,label,time),statement('INSERT INTO email_credentials (user_id,email,password_hash,created_at) VALUES (?,?,?,?)',id,email,passwordHash,time)]);}catch(error){if(await statement('SELECT user_id FROM email_credentials WHERE email=?',email).first())fail(409,'该邮箱已注册，请切换到登录');throw error;}
      return sessionResponse(id,label,'email',app);
    }
    const credential=await statement('SELECT email_credentials.user_id,email_credentials.password_hash,accounts.label FROM email_credentials JOIN accounts ON accounts.id=email_credentials.user_id WHERE email_credentials.email=?',email).first();
    const valid=await verifyPassword(password,credential?.password_hash||DUMMY_HASH);
    if(!credential||!valid)fail(401,'邮箱或密码不正确');
    return sessionResponse(credential.user_id,credential.label,'email',app);
  }
  async function getData(userId){
    const taskResult=await statement('SELECT id,date,title,category,minutes,note FROM tasks WHERE user_id=? ORDER BY date DESC,updated_at DESC,id',userId).all();
    const noteResult=await statement('SELECT date,note FROM reflections WHERE user_id=?',userId).all();
    return {version:1,tasks:taskResult.results,reflections:Object.fromEntries(noteResult.results.map(n=>[n.date,n.note]))};
  }
  async function sendCode(request){
    hasDb();if(!smsConfigured(env))fail(503,'短信登录尚未开通。站点管理员需要先接入短信服务。',{code:'SMS_NOT_CONFIGURED'});
    const body=await jsonBody(request,4096),phone=normalizePhone(body?.phone);
    if(body?.consent!==true)fail(400,'请先同意用于身份验证的短信发送说明');
    const phoneKey=await hmac(env.AUTH_PEPPER,'phone:'+phone),ip=request.headers.get('cf-connecting-ip')||'unknown';
    const ipKey=await hmac(env.AUTH_PEPPER,'ip:'+ip),time=now();
    const existing=await statement('SELECT sent_at FROM phone_challenges WHERE phone_key=?',phoneKey).first();
    if(existing && existing.sent_at>time-60)fail(429,'请等待 60 秒后再获取验证码',{retryAfter:existing.sent_at+60-time});
    const hour=Math.floor(time/3600),day=Math.floor((time+8*3600)/86400);
    await rateLimit(`send-phone:${phoneKey}:${day}`,10,(day+1)*86400-8*3600);
    await rateLimit(`send-ip:${ipKey}:${hour}`,20,(hour+1)*3600);
    const globalLimit=Math.min(1000,Math.max(1,Number(env.SMS_DAILY_LIMIT)||100));
    await rateLimit(`send-global:${day}`,globalLimit,(day+1)*86400-8*3600);
    const code=randomCode(),codeHash=await hmac(env.AUTH_PEPPER,`${phoneKey}:${code}`);
    const reserved=await statement('INSERT INTO phone_challenges (phone_key,code_hash,expires_at,sent_at,attempts,ready) VALUES (?,?,?,?,0,0) ON CONFLICT(phone_key) DO UPDATE SET code_hash=excluded.code_hash,expires_at=excluded.expires_at,sent_at=excluded.sent_at,attempts=0,ready=0 WHERE phone_challenges.sent_at<=? RETURNING phone_key',phoneKey,codeHash,time+300,time,time-60).first();
    if(!reserved)fail(429,'请等待 60 秒后再获取验证码',{retryAfter:60});
    try {await sendSms(env,phone,code);}catch{await statement('UPDATE phone_challenges SET expires_at=0,ready=0 WHERE phone_key=? AND code_hash=?',phoneKey,codeHash).run();fail(502,'短信未发送成功，请稍后重试或联系站点管理员');}
    await statement('UPDATE phone_challenges SET ready=1 WHERE phone_key=? AND code_hash=?',phoneKey,codeHash).run();
    await db.batch([statement('DELETE FROM auth_limits WHERE bucket IN (SELECT bucket FROM auth_limits WHERE expires_at<? LIMIT 100)',time),statement('DELETE FROM sessions WHERE token_hash IN (SELECT token_hash FROM sessions WHERE expires_at<? LIMIT 100)',time)]);
    return response({ok:true,retryAfter:60,expiresIn:300});
  }
  async function verifyCode(request){
    hasDb();if(!smsConfigured(env))fail(503,'短信登录尚未开通',{code:'SMS_NOT_CONFIGURED'});
    const body=await jsonBody(request,4096),phone=normalizePhone(body?.phone);
    if(typeof body.code!=='string'||!/^\d{6}$/.test(body.code))fail(400,'请输入短信中的 6 位验证码');
    const time=now(),phoneKey=await hmac(env.AUTH_PEPPER,'phone:'+phone);
    const ipKey=await hmac(env.AUTH_PEPPER,'ip:'+(request.headers.get('cf-connecting-ip')||'unknown'));
    await rateLimit(`verify-ip:${ipKey}:${Math.floor(time/3600)}`,60,(Math.floor(time/3600)+1)*3600);
    const challenge=await statement('UPDATE phone_challenges SET attempts=attempts+1 WHERE phone_key=? AND ready=1 AND expires_at>? AND attempts<5 RETURNING code_hash',phoneKey,time).first();
    const codeHash=await hmac(env.AUTH_PEPPER,`${phoneKey}:${body.code}`);
    if(!challenge || challenge.code_hash!==codeHash)fail(400,'验证码错误、已过期或尝试次数过多，请重新获取');
    const consumed=await statement('DELETE FROM phone_challenges WHERE phone_key=? AND code_hash=? AND expires_at>? AND ready=1 RETURNING phone_key',phoneKey,codeHash,time).first();
    if(!consumed)fail(400,'验证码已使用，请重新获取');
    const id='phone:'+phoneKey,label=phone.slice(3,6)+'****'+phone.slice(-4),token=randomToken();
    await db.batch([statement('INSERT INTO accounts (id,label,created_at) VALUES (?,?,?) ON CONFLICT(id) DO NOTHING',id,label,time),statement('INSERT INTO sessions (token_hash,user_id,expires_at) VALUES (?,?,?)',await sha256(token),id,time+SESSION_AGE)]);
    return response({ok:true,user:{id,label,provider:'phone'}},200,{'Set-Cookie':`${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_AGE}`});
  }
  function checkedOperations(body){
    if(!body || !Array.isArray(body.operations)||!body.operations.length||body.operations.length>50)fail(400,'每次需要提交 1 至 50 条操作');
    return body.operations.map(op=>{
      if(!op||typeof op!=='object')fail(400,'记录格式不正确');
      if(op.type==='put-task'){
        try{const t=validateBackup({version:1,tasks:[op.task],reflections:{}}).tasks[0];if(t.id.length>120)fail(400,'事项编号过长');return {type:op.type,task:t};}catch{fail(400,'事项格式不正确');}
      }
      if(op.type==='delete-task' && typeof op.id==='string' && op.id.length>0 && op.id.length<=120)return {type:op.type,id:op.id};
      if(op.type==='put-reflection' && validDay(op.date) && typeof op.note==='string' && op.note.length<=4000)return {type:op.type,date:op.date,note:op.note};
      fail(400,'记录格式不正确');
    });
  }
  async function writeRecords(request){
    const account=await requireIdentity(request),operations=checkedOperations(await jsonBody(request)),time=now();
    const changes=operations.map(op=>{
      if(op.type==='put-task'){const t=op.task;return statement('INSERT INTO tasks (user_id,id,date,title,category,minutes,note,updated_at) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(user_id,id) DO UPDATE SET date=excluded.date,title=excluded.title,category=excluded.category,minutes=excluded.minutes,note=excluded.note,updated_at=excluded.updated_at',account.id,t.id,t.date,t.title,t.category,t.minutes,t.note,time);}
      if(op.type==='delete-task')return statement('DELETE FROM tasks WHERE user_id=? AND id=?',account.id,op.id);
      if(!op.note)return statement('DELETE FROM reflections WHERE user_id=? AND date=?',account.id,op.date);
      return statement('INSERT INTO reflections (user_id,date,note,updated_at) VALUES (?,?,?,?) ON CONFLICT(user_id,date) DO UPDATE SET note=excluded.note,updated_at=excluded.updated_at',account.id,op.date,op.note,time);
    });
    await db.batch(changes);return response({ok:true,data:await getData(account.id)});
  }
  const APP_LIMIT=1024*1024;
  async function readSync(userId){
    const row=await statement('SELECT state,revision FROM device_sync WHERE user_id=?',userId).first();
    return row?{state:validateState(JSON.parse(row.state)),revision:row.revision}:{state:seedState(await getData(userId),'cloud-legacy'),revision:0};
  }
  async function appSync(request){
    const user=await requireIdentity(request);if(user.provider!=='email')fail(403,'请使用邮箱账号登录应用');
    if(request.method==='GET')return response(await readSync(user.id));
    const body=await jsonBody(request,APP_LIMIT);let incoming;try{incoming=validateState(body?.state);}catch{fail(400,'同步记录格式有误，本机记录保留');}
    for(let attempt=0;attempt<5;attempt++){
      const current=await readSync(user.id);let state;try{state=mergeStates(current.state,incoming);}catch{fail(409,'同步历史存在冲突，请导出备份后重试');}
      const serialized=JSON.stringify(state);if(new TextEncoder().encode(serialized).length>APP_LIMIT-4096)fail(413,'记录历史超过当前容量，请先导出备份并联系维护者扩容。原记录保留。');
      if(current.revision&&serialized===JSON.stringify(mergeStates(current.state)))return response(current);
      const saved=current.revision?await statement('UPDATE device_sync SET state=?,revision=revision+1,updated_at=? WHERE user_id=? AND revision=? RETURNING revision',serialized,now(),user.id,current.revision).first():await statement('INSERT INTO device_sync (user_id,revision,state,updated_at) VALUES (?,1,?,?) ON CONFLICT(user_id) DO NOTHING RETURNING revision',user.id,serialized,now()).first();
      if(saved)return response({state,revision:saved.revision});
    }
    fail(409,'另一台设备正在保存，本机记录保留，请稍后重试');
  }
  async function appHandle(request){
    const origin=request.headers.get('origin'),own=new URL(request.url).origin;
    if(origin&&origin!==own&&origin!=='https://rpc66.github.io')return response({error:'请求来源不匹配'},403);
    const headers=origin?{'Access-Control-Allow-Origin':origin,'Vary':'Origin','Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'Authorization, Content-Type','Access-Control-Max-Age':'600'}:{};
    if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
    let result;try{
      if(request.method!=='GET'&&(request.method!=='POST'||!origin||request.headers.get('content-type')?.split(';')[0].trim().toLowerCase()!=='application/json'))fail(403,'请求来源或格式不匹配');
      const path=new URL(request.url).pathname;
      if(path==='/api/app/auth/email/register'&&request.method==='POST')result=await emailAuth(request,true,true);
      else if(path==='/api/app/auth/email/login'&&request.method==='POST')result=await emailAuth(request,false,true);
      else if(path==='/api/app/me'&&request.method==='GET'){const user=await requireIdentity(request);result=response({user});}
      else if(path==='/api/app/sync'&&['GET','POST'].includes(request.method))result=await appSync(request);
      else if(path==='/api/app/auth/logout'&&request.method==='POST'){const user=await requireIdentity(request);const token=request.headers.get('authorization')?.slice(7);await statement('DELETE FROM sessions WHERE token_hash=? AND user_id=?',await sha256(token),user.id).run();result=response({ok:true});}
      else result=response({error:'页面不存在'},404);
    }catch(error){result=error instanceof ApiError?response({error:error.message,...error.extra},error.status):response({error:'服务暂时不可用，请稍后重试'},503);}
    for(const [name,value] of Object.entries(headers))result.headers.set(name,value);return result;
  }
  async function handle(request){
    try{
      const path=new URL(request.url).pathname,method=request.method;
      if(path.startsWith('/api/app/'))return await appHandle(request);
      if(method!=='GET')sameOrigin(request);
      if(path==='/api/me'&&method==='GET')return response({user:await identity(request),smsEnabled:smsConfigured(env)});
      if(path==='/api/records'&&method==='GET'){const user=await requireIdentity(request);return response({data:await getData(user.id)});}
      if(path==='/api/records'&&method==='POST')return await writeRecords(request);
      if(path==='/api/auth/phone/send'&&method==='POST')return await sendCode(request);
      if(path==='/api/auth/phone/verify'&&method==='POST')return await verifyCode(request);
      if(path==='/api/auth/email/register'&&method==='POST')return await emailAuth(request,true);
      if(path==='/api/auth/email/login'&&method==='POST')return await emailAuth(request,false);
      if(path==='/api/auth/logout'&&method==='POST'){
        hasDb();const token=cookieValue(request,COOKIE);if(token)await statement('DELETE FROM sessions WHERE token_hash=?',await sha256(token)).run();
        return response({ok:true},200,{'Set-Cookie':`${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`});
      }
      return response({error:'页面不存在'},404);
    }catch(error){
      if(error instanceof ApiError)return response({error:error.message,...error.extra},error.status,error.status===429?{'Retry-After':String(error.extra.retryAfter||60)}:{});
      // Never log credentials, phone numbers, OTPs, or journal content.
      return response({error:'服务暂时不可用，请稍后重试'},503);
    }
  }
  return {handle};
}
