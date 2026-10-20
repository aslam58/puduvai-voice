import {mkdir,readFile,writeFile} from 'node:fs/promises';import {randomBytes,createCipheriv,createHash} from 'node:crypto';
await mkdir('backups',{recursive:true,mode:0o700});await mkdir('.sites-runtime',{recursive:true,mode:0o700});
console.log('Ready for application snapshot JSON on stdin (input is hidden).');
if(process.stdin.isTTY)process.stdin.setRawMode(true);
let input='';process.stdin.setEncoding('utf8');process.stdin.on('data',async chunk=>{input+=chunk;if(!input.includes('\n'))return;process.stdin.pause();try{
 const s=JSON.parse(input.trim());const plain=Buffer.from(JSON.stringify(s));const keyPath='.sites-runtime/recovery-backup.key';let key;try{key=await readFile(keyPath)}catch{key=randomBytes(32);await writeFile(keyPath,key,{mode:0o600})}
 const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);const encrypted=Buffer.concat([cipher.update(plain),cipher.final()]);
 const filename='backups/application-snapshot.enc';await writeFile(filename,Buffer.concat([iv,cipher.getAuthTag(),encrypted]),{mode:0o600});
 const manifest={captured_at:s.captured_at,sha256:createHash('sha256').update(plain).digest('hex'),scope:s.scope,counts:Object.fromEntries(Object.entries(s.data).map(([k,v])=>[k,v.length]))};await writeFile('backups/manifest.json',JSON.stringify(manifest,null,2),{mode:0o600});console.log(JSON.stringify({saved:filename,tableCount:Object.keys(s.data).length}));process.exit(0);
 }catch(e){console.error('Snapshot could not be saved: '+e.message);process.exit(1)}});
