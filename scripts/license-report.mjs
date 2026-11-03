import fs from 'node:fs/promises';
import path from 'node:path';
const output=[];
async function packageDir(directory){
  let manifest;try{manifest=JSON.parse(await fs.readFile(path.join(directory,'package.json'),'utf8'));}catch{return;}
  const files=await fs.readdir(directory);
  const notices=[];
  for(const name of files.filter(name=>/^(?:licen[cs]e|copying|copyright|notice)(?:[.-].*)?$/i.test(name))){const file=path.join(directory,name);if((await fs.stat(file)).isFile())notices.push({file:name,text:await fs.readFile(file,'utf8')});}
  output.push({name:manifest.name,version:manifest.version,license:manifest.license||manifest.licenses||null,repository:manifest.repository||null,notices});
  await modules(path.join(directory,'node_modules'));
}
async function modules(directory){
  let entries;try{entries=await fs.readdir(directory,{withFileTypes:true});}catch(error){if(error.code==='ENOENT')return;throw error;}
  for(const entry of entries){if(!entry.isDirectory()||entry.name.startsWith('.'))continue;const file=path.join(directory,entry.name);if(entry.name.startsWith('@')){for(const child of await fs.readdir(file,{withFileTypes:true}))if(child.isDirectory())await packageDir(path.join(file,child.name));}else await packageDir(file);}
}
await modules(new URL('../frontend/node_modules',import.meta.url).pathname);
output.sort((a,b)=>`${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`));
await fs.writeFile(new URL('../THIRD_PARTY_NPM.json',import.meta.url),JSON.stringify({note:'License texts from installed upstream frontend dependencies, including development tooling. Original vendored notices are retained separately under original/.',packages:output},null,2)+'\n');
console.log(`Retained license metadata and available notices for ${output.length} frontend packages.`);
