import {appApi,saveSession,readSession} from './account.mjs';
import './install.mjs';
const $=id=>document.getElementById(id);let register=false,busy=false;
if(readSession())location.replace('./');
function mode(next){if(busy)return;register=next;$('register-fields').hidden=!next;$('repeat-password').required=next;$('invitation').required=next;$('confirmed').required=next;$('login-tab').setAttribute('aria-pressed',String(!next));$('register-tab').setAttribute('aria-pressed',String(next));$('submit-label').textContent=next?'注册并开始记录':'登录，继续我的记录';$('message').textContent='';}
$('login-tab').onclick=()=>mode(false);$('register-tab').onclick=()=>mode(true);
$('login-form').onsubmit=async event=>{event.preventDefault();if(busy)return;$('message').textContent='';
 if(register&&$('password').value!==$('repeat-password').value){$('message').textContent='两次输入的密码不一致';return;}
 busy=true;$('login-submit').disabled=true;
 try{const result=await appApi('auth/email/'+(register?'register':'login'),{body:{email:$('email').value,password:$('password').value,confirmed:$('confirmed').checked,...(register?{invitation:$('invitation').value.trim()}: {})}});$('invitation').value='';saveSession({token:result.token,user:result.user,expiresAt:result.expiresAt});$('password').value='';$('repeat-password').value='';location.replace('./');}
 catch(error){$('message').textContent=error.message;}
 finally{busy=false;$('login-submit').disabled=false;}
};
