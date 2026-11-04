import {createTeamClient} from './github-team.mjs';
import {syncTeam} from './team-sync.mjs';
import {canBridge,teamStorage,mergeOriginalAndTeam} from './original-bridge.mjs';
const AUTH='daily-done:team-auth-v1';let timer,busy=false;
function schedule(delay=2000){clearTimeout(timer);timer=setTimeout(run,delay);}
async function run(){
 if(busy||!navigator.onLine||document.hidden)return;
 let credentials;try{credentials=JSON.parse(localStorage.getItem(AUTH)||'null');}catch{return;}
 if(!credentials?.token||!credentials?.repository)return;
 busy=true;try{
  const client=createTeamClient(credentials.token),login=await client.account();
  if(!canBridge(login,credentials.repository))return;
  const team=teamStorage(localStorage,credentials.repository,login);
  let result=await mergeOriginalAndTeam({original:localStorage,team,locks:navigator.locks});
  if(result.originalChanged)window.dispatchEvent(new StorageEvent('storage',{key:'daily-done-v1'}));
  await syncTeam({client,repository:credentials.repository,login,storage:team,locks:navigator.locks});
  result=await mergeOriginalAndTeam({original:localStorage,team,locks:navigator.locks});
  if(result.originalChanged)window.dispatchEvent(new StorageEvent('storage',{key:'daily-done-v1'}));
  if(result.teamChanged)schedule();
 }catch(error){console.warn('跨页面同步暂未完成，原有记录保留。',error.message);}finally{busy=false;}
}
window.addEventListener('daily-done-changed',()=>schedule());
window.addEventListener('storage',event=>{if(event.key===AUTH||event.key?.startsWith('daily-done:team:'))schedule();});
window.addEventListener('online',()=>schedule());
document.addEventListener('visibilitychange',()=>{if(!document.hidden)schedule();});
setInterval(()=>{if(!document.hidden)run();},30000);schedule(1000);
