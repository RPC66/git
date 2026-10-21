const encoder = new TextEncoder();
const hex = bytes => [...new Uint8Array(bytes)].map(x=>x.toString(16).padStart(2,'0')).join('');
export async function sha256(value) { return hex(await crypto.subtle.digest('SHA-256',encoder.encode(value))); }
export async function hmac(key,value,asHex=true) {
  const raw = typeof key==='string'?encoder.encode(key):key;
  const imported = await crypto.subtle.importKey('raw',raw,{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const signed = await crypto.subtle.sign('HMAC',imported,encoder.encode(value));
  return asHex?hex(signed):signed;
}
export function smsConfigured(env) {
  return env.PHONE_LOGIN_ENABLED==='true' && ['AUTH_PEPPER','TENCENT_SMS_SECRET_ID','TENCENT_SMS_SECRET_KEY','TENCENT_SMS_APP_ID','TENCENT_SMS_SIGN_NAME','TENCENT_SMS_TEMPLATE_ID'].every(k=>typeof env[k]==='string' && env[k].trim()) && env.AUTH_PEPPER.length>=32;
}
export async function tencentRequest(env,phone,code,now=Date.now()) {
  const host='sms.tencentcloudapi.com',action='SendSms',service='sms';
  const timestamp=String(Math.floor(now/1000)),date=new Date(now).toISOString().slice(0,10);
  const body=JSON.stringify({PhoneNumberSet:[phone],SmsSdkAppId:env.TENCENT_SMS_APP_ID,SignName:env.TENCENT_SMS_SIGN_NAME,TemplateId:env.TENCENT_SMS_TEMPLATE_ID,TemplateParamSet:[code,'5']});
  const contentType='application/json; charset=utf-8',signedHeaders='content-type;host;x-tc-action';
  const canonical=`POST\n/\n\ncontent-type:${contentType}\nhost:${host}\nx-tc-action:${action.toLowerCase()}\n\n${signedHeaders}\n${await sha256(body)}`;
  const scope=`${date}/${service}/tc3_request`;
  const toSign=`TC3-HMAC-SHA256\n${timestamp}\n${scope}\n${await sha256(canonical)}`;
  const dateKey=await hmac('TC3'+env.TENCENT_SMS_SECRET_KEY,date,false);
  const serviceKey=await hmac(dateKey,service,false),signingKey=await hmac(serviceKey,'tc3_request',false);
  const signature=await hmac(signingKey,toSign);
  return {url:`https://${host}/`,options:{method:'POST',headers:{'Content-Type':contentType,'X-TC-Action':action,'X-TC-Timestamp':timestamp,'X-TC-Version':'2021-01-11','X-TC-Region':env.TENCENT_SMS_REGION||'ap-guangzhou','Authorization':`TC3-HMAC-SHA256 Credential=${env.TENCENT_SMS_SECRET_ID}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`},body,signal:AbortSignal.timeout(12000)}};
}
export async function sendTencentSms(env,phone,code) {
  const {url,options}=await tencentRequest(env,phone,code);
  const response=await fetch(url,options),result=await response.json();
  const statuses=result?.Response?.SendStatusSet;
  if(!response.ok || result?.Response?.Error || !Array.isArray(statuses) || statuses.length!==1 || statuses[0].Code!=='Ok') {
    // Provider payloads may contain the phone number. Never return or log them.
    throw new Error('SMS_PROVIDER_FAILURE');
  }
}
