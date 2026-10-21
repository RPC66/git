import {mkdir,readFile,writeFile,copyFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const hash=text=>createHash('sha256').update(text).digest('hex').slice(0,12);

await mkdir('docs',{recursive:true});
const replace=(text,from,to)=>{if(!text.includes(from))throw new Error(`Missing source fragment: ${from.slice(0,60)}`);return text.replace(from,to);};
let app=await readFile('public/app.mjs','utf8');
app=replace(app,"import {diffRecords,operationBatches} from './sync.mjs';","import {diffRecords} from './sync.mjs';\nimport {readRecords,writeRecordsLocked,mergeWithCheckpoint,restoreSummary,CHECKPOINT} from './storage.mjs?v=2';");
app=replace(app,'let account=null,transport=Promise.resolve(),pendingSaves=0,legacy=null;','let transport=Promise.resolve(),pendingSaves=0;');
const apiStart=app.indexOf('async function api('),apiEnd=app.indexOf('function saveOperations(',apiStart);
app=app.slice(0,apiStart)+app.slice(apiEnd);
app=replace(app,"for(const batch of operationBatches(operations)){const result=await api('/api/records',{operations:batch});data=validateBackup(result.data);}","data=await writeRecordsLocked(localStorage,operations);window.dispatchEvent(new Event('daily-done-changed'));");
app=app.replaceAll(',#migrate-local','');
const mergeStart=app.indexOf('async function mergeBackup('),mergeEnd=app.indexOf("$('#cancel-import')",mergeStart);
app=app.slice(0,mergeStart)+`async function mergeBackup(backup){if(!await flushDrafts())return false;try{data=await mergeWithCheckpoint(localStorage,backup);window.dispatchEvent(new Event('daily-done-changed'));return true;}catch(error){toast(error.message);return false;}}\n`+app.slice(mergeEnd);
app=replace(app,"$('#import-dialog').showModal();","const conflicts=restoreSummary(readRecords(localStorage),pendingImport);$('#import-description').textContent+=\` 将覆盖 \${conflicts.tasks} 件已有事项、\${conflicts.reflections} 天已有感想。恢复前会自动保留本地备份。\`;$('#import-dialog').showModal();");
const refreshStart=app.indexOf('async function refresh()');
app=app.slice(0,refreshStart)+`
function refresh(){
 if(pendingSaves||draftNotes.size||document.hidden)return;
 try{data=readRecords(localStorage);render();syncState('已保存到此浏览器');}
 catch(error){syncState('本地记录无法读取',true);toast(error.message);}
}
$('#retry-sync').onclick=async()=>{if(await flushDrafts()){render();refresh();}};
window.addEventListener('storage',event=>{if(event.key===KEY||event.key===null)refresh();});
window.addEventListener('beforeunload',e=>{if(pendingSaves||draftNotes.size){e.preventDefault();e.returnValue='';}});
document.addEventListener('visibilitychange',()=>{if(document.hidden)flushDrafts();else refresh();});
$('#reload-session').onclick=()=>location.reload();
function boot(){
 try{data=readRecords(localStorage);render();syncState('已保存到此浏览器');document.body.classList.remove('auth-loading');$('#session-loading').hidden=true;}
 catch(error){$('#loading-message').textContent=error.message;$('#reload-session').hidden=false;}
}
boot();
`;
app=app.replaceAll('已保存到云端','已保存到此浏览器').replaceAll('尚未保存到云端','尚未保存到浏览器').replaceAll('备份已合并到当前账号的云端记录。','备份已合并到此浏览器的记录。');
app += `\nimport {setupGitHubBackup} from './github-backup.mjs';
setupGitHubBackup({
 async getBackup({includeDrafts=false}={}){
 if(includeDrafts){if($('#edit-dialog').open)throw new Error('请先保存或关闭事项编辑窗口，再上传备份。');const input=$('#quick-title'),title=input.value.trim();if(title){if(!$('#quick-form').reportValidity())throw new Error('请检查事项的耗时等输入。');const task={id:crypto.randomUUID(),title,date:selected,category:$('#quick-category').value,minutes:Number($('#quick-minutes').value)||0,note:''};await saveOperations([{type:'put-task',task}]);if(input.value.trim()===title){input.value='';$('#quick-minutes').value='';}render();}}
 if(!await flushDrafts())throw new Error('请先重试保存感想，或导出本地备份。');return readRecords(localStorage);},
 async onRestore(backup){pendingImport=backup;const conflicts=restoreSummary(readRecords(localStorage),backup);$('#import-description').textContent=\`GitHub 备份含 \${backup.tasks.length} 件事项、\${Object.values(backup.reflections).filter(Boolean).length} 天感想。将覆盖 \${conflicts.tasks} 件已有事项、\${conflicts.reflections} 天已有感想；恢复前自动保留本地备份，可在 GitHub 备份弹窗下载。\`;$('#import-dialog').showModal();}
});\n`;
app+=`\n$('#download-checkpoint').onclick=()=>{try{const raw=localStorage.getItem(CHECKPOINT);if(!raw)throw new Error('暂无恢复前备份');validateBackup(JSON.parse(raw));const url=URL.createObjectURL(new Blob([raw],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='日有所成-恢复前备份.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(error){toast(error.message);}};\n`;
let html=await readFile('public/diary.html','utf8');
html=replace(html,'<div id="daily-list" class="task-list"></div>','<div id="daily-list" class="task-list"></div><div class="save-backup-control"><span id="save-backup-status" role="status" aria-live="polite"></span><button id="save-backup" type="button" class="outline" aria-label="保存并上传 GitHub 备份" title="保存并上传 GitHub 备份">√</button></div>');
html=replace(html,'<p>慢慢来，每一步都算数。</p>','');
html=replace(html,'<span class="storage-label"><i></i> <span id="sync-state">云端记录</span><button id="retry-sync" hidden>重试</button></span>','<span id="sync-state" hidden>云端记录</span><button id="retry-sync" hidden>重试保存</button>');
html=replace(html,'正在读取你的云端记录…','正在读取此浏览器的记录…');
html=replace(html,'<a href="/login">返回登录</a>','<p>本地数据未被覆盖。请检查浏览器存储权限后重试。</p>');
html=replace(html,'<span id="sync-state" hidden>云端记录</span>','<span id="sync-state" hidden>本地记录</span>');
html=replace(html,'<span id="account-label">我的账号</span><a id="logout" href="/signout-with-chatgpt?return_to=%2Flogin" target="_top">退出</a>','<span id="account-label" title="记录仅保存在此浏览器，不会跨设备同步">浏览器本地版</span>');
html=html.replace(/^.*id="migration-banner".*\r?\n/m,'');
html=replace(html,'给每一天，留一点成长的证据。','数据仅保存在当前浏览器，不跨设备同步。清理浏览器数据会删除记录，请定期导出备份。');
html=replace(html,'<link rel="stylesheet"','<link rel="icon" href="favicon.svg"><link rel="stylesheet"');
html=replace(html,'<input hidden id="import-file"','<button id="github-open" class="github-entry">GitHub 备份 / 恢复 ↗</button><input hidden id="import-file"');
html=replace(html,'<script type="module"',`${await readFile('scripts/pages-github-panel.html','utf8')}\n<script type="module"`);
app=app.replace("from './github-backup.mjs'",`from './github-backup.mjs?v=${hash(await readFile('docs/github-backup.mjs'))}'`);
html=replace(html,'src="app.mjs"',`src="app.mjs?v=${hash(app)}"`);
html=replace(html,'href="style.css"',`href="style.css?v=${hash(Buffer.concat([await readFile('public/style.css'),await readFile('scripts/pages-theme.css')]))}-github1"`);
await writeFile('docs/index.html',html);
await writeFile('docs/app.mjs',app);
for(const file of ['style.css','model.mjs','sync.mjs','favicon.svg'])await copyFile(`public/${file}`,`docs/${file}`);
await writeFile('docs/style.css','\n.github-entry{display:block;margin:12px auto 0;color:#235948;font-size:12px}.github-actions{display:flex;flex-wrap:wrap;gap:12px;margin:18px 0}#github-dialog{max-width:560px;width:calc(100% - 32px);max-height:90dvh;overflow:auto}#github-dialog p{font-size:13px;line-height:1.7}#github-dialog label{display:block;margin:14px 0}#github-dialog input,#github-dialog select{width:100%;box-sizing:border-box;margin-top:7px}#github-dialog a{text-decoration:underline}#github-status{min-height:24px;overflow-wrap:anywhere}\n',{flag:'a'});
await writeFile('docs/.nojekyll','');
await writeFile('docs/style.css',await readFile('scripts/pages-theme.css'),{flag:'a'});
await writeFile('docs/index.html',(await readFile('docs/index.html','utf8')).replace('content="#235948"','content="#287bb9"'));
console.log('GitHub Pages files prepared in docs/');
