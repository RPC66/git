import {prepareSync,readSyncState,KEY} from './storage.mjs';
import {mergeStates,preserveMigrationVariants,materialize} from './sync-state.mjs';

// The original page belongs to the owner's existing local account. Never attach
// another member's records to it, even on a shared browser.
export function canBridge(login,repository){return login?.toLowerCase()==='rpc66'&&repository?.toLowerCase()==='rpc66/daily-done-team';}
export function teamStorage(local,repository,login){const prefix='daily-done:team:'+encodeURIComponent(repository.toLowerCase())+':'+encodeURIComponent(login.toLowerCase())+':';return {prefix,getItem:key=>local.getItem(prefix+key),setItem:(key,value)=>local.setItem(prefix+key,value),removeItem:key=>local.removeItem(prefix+key)};}
export async function mergeOriginalAndTeam({original,team,locks}){
 if(!locks)throw Error('浏览器不支持安全的跨页面同步');
 return locks.request('daily-done:original-team-bridge',async()=>{
  // Capture the untouched representations before prepareSync adds history.
  const checkpoint='daily-done:original-team-checkpoint-v1',marker='daily-done:original-team-joined-v1';
  if(!original.getItem(checkpoint)){
   const before={original:original.getItem(KEY),team:team.getItem(KEY)};
   original.setItem(checkpoint,JSON.stringify(before));
  }
  await prepareSync(original,locks);await prepareSync(team,locks);
  return locks.request('daily-done:local-records',()=>{
   const a=readSyncState(original),b=readSyncState(team);
   const merged=original.getItem(marker)?mergeStates(a,b):preserveMigrationVariants(a,b);
   const value=JSON.stringify({...materialize(merged),_sync:merged});
   const originalChanged=original.getItem(KEY)!==value,teamChanged=team.getItem(KEY)!==value;
   if(originalChanged)original.setItem(KEY,value);
   if(teamChanged)team.setItem(KEY,value);
   original.setItem(marker,'1');return {records:materialize(merged),originalChanged,teamChanged};
  });
 });
}
