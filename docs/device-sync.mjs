import {emptyState,seedState,mergeStates,preserveMigrationVariants} from './sync-state.mjs?v=1';
import {prepareSync,readSyncState,acceptSync,MIGRATION} from './storage.mjs?v=3';

export async function synchronizeDevice({client,repository,storage,locks=navigator.locks}){
 if(!locks)throw new Error('请更新浏览器后再启用双向同步。');
 return locks.request('daily-done:device-sync:'+repository.toLowerCase(),async()=>{
  await prepareSync(storage,locks);
  const marker='daily-done:sync-migrated:'+repository.toLowerCase(),joined='daily-done:sync-joined:'+repository.toLowerCase();let protectedLocal=!!storage.getItem(marker);
  for(let attempt=0;attempt<5;attempt++){
   const remote=await client.readState(repository);let state=remote.state;
   if(!state){const files=await client.list(repository);state=files.length?seedState(await client.restore(repository,files[0].path),'legacy:'+files[0].path):emptyState();}
   const local=readSyncState(storage),merged=storage.getItem(joined)?mergeStates(state,local):preserveMigrationVariants(local,state);
   // Persist the imported legacy revisions before creating a new snapshot. If
   // the initial upload fails, that newer local snapshot cannot hide the source
   // snapshot on the next attempt; both sets of records are already durable.
   if(!storage.getItem(joined))await acceptSync(storage,merged,locks);
   // Capture the pre-migration local copy before changing either device. Existing
   // snapshots remain untouched, including when a second device joins later.
   if(!protectedLocal){const original=JSON.parse(storage.getItem(MIGRATION));if(original.tasks.length||Object.values(original.reflections).some(Boolean))await client.backup(repository,original);storage.setItem(marker,'protected');protectedLocal=true;}
   try{
    if(!remote.state||JSON.stringify(merged)!==JSON.stringify(mergeStates(remote.state)))await client.writeState(repository,merged,remote.sha);
   }catch(error){if(error.status===409||error.status===422)continue;throw error;}
   const records=await acceptSync(storage,merged,locks);
   storage.setItem(joined,'true');
   // Edits made during the network request remain local and are sent next pass.
   const pending=JSON.stringify(mergeStates(readSyncState(storage)))!==JSON.stringify(merged);
   return {records,pending,history:merged.changes.length};
  }
  throw new Error('另一台设备正在保存，记录已保留，稍后自动重试。');
 });
}
