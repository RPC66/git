export const DELAY=10*60*1000;
export function createAutoBackup({backup,authorized,report,persist=()=>{},initial=0,now=Date.now,schedule=setTimeout,cancel=clearTimeout}){
 let changedAt=initial,revision=0,timer=null,running=false,lastSuccess='';
 function clear(){if(timer!==null)cancel(timer);timer=null;}
 function arm(){clear();if(changedAt&&authorized()&&!running)timer=schedule(attempt,Math.max(0,changedAt+DELAY-now()));}
 function changed(){changedAt=changedAt||now();revision++;persist(changedAt);report(authorized()?'有未备份修改，将在 10 分钟内自动备份':'待备份：请先启用 GitHub 自动备份');arm();}
 function saved(version){if(version!==revision)return;changedAt=0;persist(0);clear();lastSuccess='已备份到 GitHub · '+new Date(now()).toLocaleTimeString('zh-CN');report(authorized()?lastSuccess:'自动备份已停用');}
 async function attempt(){timer=null;if(!changedAt||!authorized()||running)return;if(now()<changedAt+DELAY){arm();return;}running=true;const version=revision;changedAt=0;report('正在自动备份到 GitHub…');try{await backup();if(version===revision)saved(version);else report('备份完成；新修改将在 10 分钟内备份');}catch(error){changedAt=changedAt||now();persist(changedAt);report('自动备份失败：'+error.message+'；保留修改并稍后重试');}finally{running=false;arm();}}
 return {changed,resume(){if(!authorized()){clear();report('自动备份待授权或已停用');return;}if(changedAt){report('有未备份修改，已安排自动备份');arm();}else report(lastSuccess||'自动备份已就绪');},saved,version:()=>revision};
}
