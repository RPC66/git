import {appApi} from './account.mjs';
import {prepareSync,readSyncState,acceptSync,CHECKPOINT,readRecords} from './storage.mjs?v=3';
import {mergeStates,preserveMigrationVariants,seedState,validateState} from './sync-state.mjs?v=1';
export async function syncAccount({session,storage,locks=navigator.locks,api=appApi}){
 return locks.request('daily-done:account-sync:'+session.user.id,async()=>{
  await prepareSync(storage,locks);
  const remote=await api('sync',{session}),local=readSyncState(storage);
  const merged=storage.getItem('joined')?mergeStates(remote.state,local):preserveMigrationVariants(local,remote.state);
  const result=JSON.stringify(merged)===JSON.stringify(mergeStates(remote.state))?remote:await api('sync',{session,body:{state:merged}});
  const records=await acceptSync(storage,result.state,locks);storage.setItem('joined','true');
  return {records,pending:JSON.stringify(mergeStates(readSyncState(storage)))!==JSON.stringify(mergeStates(result.state))};
 });
}
export async function migrateBackup(backup,storage,locks=navigator.locks){
 await prepareSync(storage,locks);
 // The saved account records remain recoverable even after importing a backup
 // with conflicting IDs; both variants are kept by the migration merge.
 storage.setItem(CHECKPOINT,JSON.stringify(readRecords(storage)));
 const incoming=backup.format?validateState(backup):seedState(backup,'import-'+crypto.randomUUID());
 const merged=preserveMigrationVariants(readSyncState(storage),incoming);
 return acceptSync(storage,merged,locks);
}
