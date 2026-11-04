let installPrompt=null;
window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();installPrompt=event;});
export async function installApp(){
 if(installPrompt){await installPrompt.prompt();await installPrompt.userChoice;installPrompt=null;return;}
 document.getElementById('install-guide').showModal();
}
if('serviceWorker' in navigator)navigator.serviceWorker.register('./sw.js',{scope:'./'}).catch(()=>{const node=document.getElementById('install-status');if(node)node.textContent='离线组件暂未就绪，请联网刷新后重试。';});
document.getElementById('install-app')?.addEventListener('click',installApp);
document.getElementById('install-close')?.addEventListener('click',()=>document.getElementById('install-guide').close());
