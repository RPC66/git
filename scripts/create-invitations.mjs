import {randomBytes,createHash} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
// Codes stay outside the repository. Only the hashes belong in the database.
const [directory,countInput='10',daysInput='30']=process.argv.slice(2);
const count=Number(countInput),days=Number(daysInput);
if(!directory||!Number.isInteger(count)||count<1||count>100||!Number.isInteger(days)||days<1||days>365)throw Error('用法：node scripts/create-invitations.mjs <仓库外的私密目录> [1至100个] [1至365天]');
const folder=path.resolve(directory),root=path.resolve('.');
if(folder===root||folder.startsWith(root+path.sep))throw Error('请使用仓库以外的私密目录，避免误公开邀请码');
await mkdir(folder,{recursive:true});
const now=Math.floor(Date.now()/1000),expires=now+days*86400,codes=[];
const statements=[],configuration=[];
for(let i=0;i<count;i++){
 const code=randomBytes(24).toString('hex'),hash=createHash('sha256').update(code).digest('hex');codes.push(code);
 statements.push(`INSERT INTO signup_invitations(token_hash,created_at,expires_at) VALUES ('${hash}',${now},${expires});`);
 configuration.push({tokenHash:hash,createdAt:now,expiresAt:expires});
}
const suffix=Date.now().toString();
await writeFile(path.join(folder,`邀请码-${suffix}.txt`),`日有所成 · 一人一码，仅首次注册使用\n有效期至 ${new Date(expires*1000).toISOString()}\n\n${codes.join('\n')}\n`,{flag:'wx',mode:0o600});
await writeFile(path.join(folder,`导入邀请-${suffix}.sql`),statements.join('\n')+'\n',{flag:'wx',mode:0o600});
await writeFile(path.join(folder,`邀请配置-${suffix}.json`),JSON.stringify(configuration),{flag:'wx',mode:0o600});
console.log(`已生成 ${count} 个单次邀请码，保存在指定私密目录；需由管理员设置 SIGNUP_INVITATIONS_JSON，或将对应 SQL 导入账号数据库后生效。账号总数仍受 100 人上限约束。`);
