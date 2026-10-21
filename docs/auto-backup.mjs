export const DELAY=10*60*1000;
export function createAutoBackup({backup,authorized,report,persist=()=>{},initial=0,now=Date.now,schedule=setTimeout,cancel=clearTimeout}){
 let changedAt=initial,revision=0,timer=null,running=false;
 function arm(){if(timer!==null)cancel(timer);timer=null;if(changedAt&&authorized())timer=schedule(attempt,Math.max(0,changedAt+DELAY-now()));}
 function changed(){changedAt=now();revision++;persist(changedAt);report(authorized()?'内容已修改，10 分钟后自动备份':'待备份：请先启用 GitHub 自动备份');arm();}
 async function attempt(){timer=null;if(!changedAt||!authorized())return;if(running)return;if(now()<changedAt+DELAY){arm();return;}running=true;const version=revision;report('正在自动备份到 GitHub…');try{await backup();if(version===revision){changedAt=0;persist(0);report('自动备份成功 · '+new Date(now()).toLocaleTimeString('zh-CN'));}else arm();}catch(error){report('自动备份失败：'+error.message+'；10 分钟后重试');if(authorized())timer=schedule(attempt,DELAY);}finally{running=false;}}
 return {changed,resume(){if(changedAt){report(authorized()?'有待备份修改，已安排自动备份':'待备份：请先启用 GitHub 自动备份');arm();}else report(authorized()?'自动备份已就绪，修改后 10 分钟备份':'自动备份待授权');},saved(version){if(version===revision){changedAt=0;persist(0);if(timer!==null)cancel(timer);timer=null;report('已备份到 GitHub · '+new Date(now()).toLocaleTimeString('zh-CN'));}},version:()=>revision};
}
