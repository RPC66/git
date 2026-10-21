'use client';
import { useEffect, useState } from 'react';
export default function PhoneLogin({enabled,currentAccount}:{enabled:boolean,currentAccount:boolean}) {
  const [phone,setPhone]=useState(''),[code,setCode]=useState(''),[consent,setConsent]=useState(false);
  const [busy,setBusy]=useState<'send'|'verify'|null>(null),[until,setUntil]=useState(0),[remaining,setRemaining]=useState(0);
  const [message,setMessage]=useState(''),[isError,setIsError]=useState(false);
  useEffect(()=>{const update=()=>setRemaining(Math.max(0,Math.ceil((until-Date.now())/1000)));update();const timer=setInterval(update,1000);return ()=>clearInterval(timer);},[until]);
  async function api(path:string,body:unknown){
    const r=await fetch(path,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(20000)});
    let result:{error?:string,retryAfter?:number};try{result=await r.json() as typeof result;}catch{throw new Error('服务暂时不可用，请稍后重试');}if(!r.ok){if(result.retryAfter)setUntil(Date.now()+result.retryAfter*1000);throw new Error(result.error||'请求失败，请稍后重试');}return result;
  }
  function checkedPhone(){const value=phone.replace(/[\s-]/g,'');if(!/^1[3-9]\d{9}$/.test(value))throw new Error('请输入有效的中国大陆手机号码');if(!consent)throw new Error('请先勾选短信验证说明');return value;}
  async function send(){
    if(busy||remaining||!enabled)return;setMessage('');
    try{const value=checkedPhone();setBusy('send');const result=await api('/api/auth/phone/send',{phone:value,consent});setUntil(Date.now()+(result.retryAfter||60)*1000);setIsError(false);setMessage('验证码已发送，5 分钟内有效，请查看手机短信。');}
    catch(error){setIsError(true);setMessage(error instanceof Error?error.message:'发送失败，请稍后重试');}finally{setBusy(null);}
  }
  async function verify(e:React.FormEvent){
    e.preventDefault();if(busy||!enabled)return;setMessage('');
    try{const value=checkedPhone();if(!/^\d{6}$/.test(code))throw new Error('请输入 6 位短信验证码');setBusy('verify');await api('/api/auth/phone/verify',{phone:value,code});window.location.assign('/diary.html');}
    catch(error){setIsError(true);setMessage(error instanceof Error?error.message:'登录失败，请稍后重试');setBusy(null);}
  }
  return <form className="phone-form" onSubmit={verify}>
    {!enabled && <div className="setup-notice" role="status"><span>◷</span><div><strong>手机号登录待开通</strong><p>短信服务尚未配置，暂时无法获取验证码。{currentAccount?'你可以先使用当前账号进入云端记录。':'请联系站点管理员完成短信服务配置。'}</p></div></div>}
    <label htmlFor="phone">手机号码</label><div className="phone-input"><span>+86 <i>⌄</i></span><input id="phone" type="tel" inputMode="tel" autoComplete="tel-national" placeholder="请输入手机号码" maxLength={18} value={phone} onChange={e=>setPhone(e.target.value)} disabled={!!busy} required aria-describedby="phone-help"/></div>
    <label htmlFor="code">验证码</label><div className="code-input"><input id="code" inputMode="numeric" autoComplete="one-time-code" placeholder="6 位短信验证码" maxLength={6} pattern="[0-9]{6}" value={code} onChange={e=>setCode(e.target.value.replace(/\D/g,''))} disabled={!!busy} required/><button type="button" onClick={send} disabled={!enabled||!!busy||remaining>0}>{remaining?`${remaining} 秒后重试`:busy==='send'?'发送中…':'获取验证码'}</button></div>
    <label className="consent"><input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)} disabled={!!busy}/><span>同意使用手机号接收登录验证码，验证成功后将自动创建个人账号。<a href="/privacy">了解数据使用说明</a></span></label>
    {message&&<p className={isError?'form-message error':'form-message'} role={isError?'alert':'status'}>{message}</p>}
    <button className="login-submit" type="submit" disabled={!enabled||!!busy}>{busy==='verify'?'正在验证…':'登录 / 注册'}<span>↗</span></button>
    <p id="phone-help" className="login-help">记录只属于你，登录后可在手机和电脑上继续。</p>
    {currentAccount&&<><div className="or-divider"><span>短信开通前</span></div><a className="account-fallback" href="/diary.html" target="_top">使用当前账号进入 <span>→</span></a><p className="fallback-note">当前账号与手机号账号分别保存记录，可通过备份迁移。</p></>}
  </form>;
}
