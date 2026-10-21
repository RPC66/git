export function diffRecords(previous,next){
 const operations=[],oldTasks=new Map(previous.tasks.map(t=>[t.id,t]));
 const newIds=new Set(next.tasks.map(t=>t.id));
 for(const task of next.tasks){if(JSON.stringify(oldTasks.get(task.id))!==JSON.stringify(task))operations.push({type:'put-task',task});}
 for(const task of previous.tasks){if(!newIds.has(task.id))operations.push({type:'delete-task',id:task.id});}
 for(const date of new Set([...Object.keys(previous.reflections),...Object.keys(next.reflections)])){
  const note=next.reflections[date]||'';if((previous.reflections[date]||'')!==note)operations.push({type:'put-reflection',date,note});
 }
 return operations;
}
export function operationBatches(operations){const batches=[];for(let i=0;i<operations.length;i+=50)batches.push(operations.slice(i,i+50));return batches;}
