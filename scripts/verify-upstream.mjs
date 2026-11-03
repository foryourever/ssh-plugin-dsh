import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = new URL('../', import.meta.url);
const inventory = JSON.parse(await fs.readFile(new URL('UPSTREAM.json', root), 'utf8'));
const failures=[];
let npmRenames=0;
for(const entry of inventory.files){
  let file=new URL(`original/${entry.path}`,root);
  try {
    let bytes;
    try { bytes=await fs.readFile(file); }
    catch(error) {
      if(error.code!=='ENOENT'||!entry.path.endsWith('.gitignore'))throw error;
      file=new URL(`original/${entry.path.replace(/\.gitignore$/,'.npmignore')}`,root);
      bytes=await fs.readFile(file);npmRenames++;
    }
    const digest=createHash('sha256').update(bytes).digest('hex');if(digest!==entry.sha256)failures.push(`${entry.path}: changed`);
  }
  catch(error){failures.push(`${entry.path}: ${error.code}`);}
}
async function walk(dir){let files=[];for(const item of await fs.readdir(dir,{withFileTypes:true})){const p=path.join(dir,item.name);if(item.isDirectory())files.push(...await walk(p));else if(item.isFile())files.push(p);}return files;}
const files=await walk(fileURLToPath(new URL('original/',root)));
if(files.length!==inventory.fileCount)failures.push(`Expected ${inventory.fileCount} original files, found ${files.length}`);
if(failures.length){console.error(failures.join('\n'));process.exitCode=1;}else console.log(`Verified all ${inventory.fileCount} original files; upstream ${inventory.commit}, version ${inventory.version}. npm .gitignore renames: ${npmRenames}.`);
