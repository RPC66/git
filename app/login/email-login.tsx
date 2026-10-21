'use client';
import { useState } from 'react';
export default function EmailLogin(){
 const [register,setRegister]=useState(false),[email,setEmail]=useState(''),[password,setPassword]=useState(''),[repeat,setRepeat]=useState('');
 const [confirmed,setConfirmed]=useState(false),[visible,setVisible]=useState(false),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 function switchMode(next:boolean){setRegister(next);setMessage('');setPassword('');setRepeat('');setVisible(false);}
 async function submit(event:React.FormEvent){
  event.preventDefault();if(busy)return;setMessage('');
  if(register&&password!==repeat){setMessage('两次输入的密码不一致');return;}
  if(register&&!confirmed){setMessage('请先确认邮箱和密码保管说明');return;}
  setBusy(true);
  try{
   const r=await fetch(`/api/auth/email/${register?'register':'login'}`,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password,confirmed}),signal:AbortSignal.timeout(30000)});
   let result:{error?:string};try{result=await r.json() as typeof result;}catch{throw new Error('服务暂时不可用，请稍后重试');}
   if(!r.ok)throw new Error(result.error||'暂时无法登录，请稍后再试');
   window.location.assign('/diary.html');
  }catch(error){setMessage(error instanceof Error?error.message:'网络连接失败，请稍后重试');setBusy(false);}
 }
 return <div>
  <div className="login-tabs" role="group" aria-label="选择登录或注册"><button type="button" className={!register?'active':''} aria-pressed={!register} disabled={busy} onClick={()=>switchMode(false)}>邮箱登录</button><button type="button" className={register?'active':''} aria-pressed={register} disabled={busy} onClick={()=>switchMode(true)}>注册账号</button></div>
  <form className="phone-form email-form" onSubmit={submit}>
   <label htmlFor="email">邮箱地址</label><div className="phone-input"><input id="email" type="email" autoComplete="email" placeholder="请输入你的邮箱" value={email} onChange={e=>setEmail(e.target.value)} maxLength={254} required disabled={busy}/></div>
   <label htmlFor="password">{register?'设置密码':'密码'}</label><div className="code-input"><input id="password" type={visible?'text':'password'} autoComplete={register?'new-password':'current-password'} placeholder={register?'至少 12 个字符':'请输入密码'} minLength={12} maxLength={128} value={password} onChange={e=>setPassword(e.target.value)} required disabled={busy}/><button type="button" onClick={()=>setVisible(!visible)} disabled={busy} aria-label={visible?'隐藏密码':'显示密码'}>{visible?'隐藏':'显示'}</button></div>
   {register&&<><p className="password-help">支持长密码短语，12 至 128 个字符。</p><label htmlFor="repeat-password">确认密码</label><div className="phone-input"><input id="repeat-password" type={visible?'text':'password'} autoComplete="new-password" placeholder="请再次输入密码" value={repeat} onChange={e=>setRepeat(e.target.value)} minLength={12} maxLength={128} required disabled={busy}/></div><label className="consent"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)} disabled={busy} required/><span>我已确认邮箱填写正确，并会妥善保管密码。<a href="/privacy">数据使用说明</a></span></label></>}
   {message&&<p className="form-message error" role="alert">{message}</p>}
   <button className="login-submit" type="submit" disabled={busy}>{busy?(register?'正在创建账号…':'正在登录…'):(register?'注册并开始记录':'登录，继续我的记录')}<span>↗</span></button>
   <p className="login-help">记录保存在云端，手机和电脑使用同一账号即可继续。</p>
   <p className="email-disclosure">邮箱用于账号登录，暂不发送验证邮件，也不支持邮件找回密码。</p>
  </form>
 </div>;
}
