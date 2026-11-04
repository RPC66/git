import {emptyState,mergeStates,preserveMigrationVariants} from './sync-state.mjs';
import {prepareSync,acceptSync,readSyncState} from './storage.mjs';
export async function syncTeam({client,repository,login,storage,locks}){
 if(!locks)throw Error('浏览器不支持安全的跨设备同步，请更新浏览器');
 return locks.request('daily-done:team-sync:'+repository.toLowerCase()+':'+login.toLowerCase(),async()=>{
  await prepareSync(storage,locks);
  for(let i=0;i<5;i++){
   const remote=await client.readState(repository,login),local=readSyncState(storage),joined=storage.getItem('joined');
   const merged=joined?mergeStates(remote.state||emptyState(),local):preserveMigrationVariants(local,remote.state||emptyState());
   if(!joined)await acceptSync(storage,merged,locks);
   try{if(!remote.state||JSON.stringify(merged)!==JSON.stringify(mergeStates(remote.state)))await client.writeState(repository,merged,remote.sha);}catch(e){if(e.status===409||e.status===422)continue;throw e;}
   const records=await acceptSync(storage,merged,locks);storage.setItem('joined','1');
   return {records,pending:JSON.stringify(mergeStates(readSyncState(storage)))!==JSON.stringify(merged)};
  }
  throw Error('另一设备正在保存，请稍后重试');
 });
}
