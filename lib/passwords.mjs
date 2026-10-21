import { scrypt,randomBytes,timingSafeEqual } from 'node:crypto';
const N=32768,R=8,P=3;
function derive(password,salt){return new Promise((resolve,reject)=>scrypt(password,salt,64,{N,r:R,p:P,maxmem:64*1024*1024},(error,key)=>error?reject(error):resolve(key)));}
export async function hashPassword(password){const salt=randomBytes(16).toString('hex'),key=await derive(password,salt);return `scrypt$${N}$${R}$${P}$${salt}$${key.toString('hex')}`;}
export const DUMMY_HASH=`scrypt$${N}$${R}$${P}$${'0'.repeat(32)}$${'0'.repeat(128)}`;
export async function verifyPassword(password,encoded){
 const parts=encoded.split('$');if(parts.length!==6||parts[0]!=='scrypt'||Number(parts[1])!==N||Number(parts[2])!==R||Number(parts[3])!==P||!/^[a-f0-9]{32}$/.test(parts[4])||!/^[a-f0-9]{128}$/.test(parts[5]))return false;
 const key=await derive(password,parts[4]);return timingSafeEqual(key,Buffer.from(parts[5],'hex'));
}
