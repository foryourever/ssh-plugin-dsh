import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { scopeSelector } from './scope-css.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const frontend=path.join(root,'frontend');
const require=createRequire(path.join(frontend,'package.json'));
const {build}=await import(require.resolve('vite'));
const {default:vue}=await import(require.resolve('@vitejs/plugin-vue'));
const {default:tailwindcss}=await import(require.resolve('@tailwindcss/vite'));
const postcss=require('postcss');
const result=await build({
 // Vite library mode leaves NODE_ENV to the consumer by default. Harness
 // imports this bundle directly in a browser, with no Node process global.
 define:{'process.env.NODE_ENV':JSON.stringify('production')},
 configFile:false,root:frontend,plugins:[
  {name:'ssh-inline-video-worker',enforce:'pre',transform(code,id){if(id.endsWith('/@file-viewer/pptx/dist/worker.js'))return {code:'import sshPptxWorker from "./worker/pptx.worker.js?raw";\n'+code.replace('return resolvePptxWorkerUrl(false);','return "data:application/javascript;base64," + btoa(unescape(encodeURIComponent(sshPptxWorker)));'),map:null};if(id.endsWith('/@file-viewer/renderer-media/dist/mp4vPlayer.js'))return {code:'import Mp4vWorker from "./mp4v.worker.js?worker&inline";\n'+code.replace("new Worker(new URL('./mp4v.worker.js', import.meta.url),",'new Mp4vWorker('),map:null};}},
  {name:'ssh-upstream-adaptation',enforce:'pre',resolveId(source){if(source.includes('shared/frontend/'))return path.join(frontend,'shared/frontend',source.split('shared/frontend/')[1])+'.ts';if(source.endsWith('assets/plugin.svg?raw'))return path.join(root,'original/assets/plugin.svg')+'?raw';},transform(code,id){if(!id.startsWith(frontend)||!/[.](vue|ts)$/.test(id)||id.includes('node_modules')||id.includes('harness')||id.endsWith('HarnessApp.vue'))return;let modified=code.replace(/document\.documentElement/g,'document.getElementById("dsh-ssh-root")!').replace(/document\.body/g,'document.getElementById("dsh-ssh-root")!').replace(/document\.querySelector(All)?/g,'document.getElementById("dsh-ssh-root")!.querySelector$1');modified=modified.replace(/<(DialogPortal|SelectPortal|ContextMenuPortal|PopoverPortal|DropdownMenuPortal|TooltipPortal|HoverCardPortal|MenubarPortal|NavigationMenuPortal)(\s|>)/g,'<$1 to="#dsh-ssh-root"$2');modified=modified.replace(/(<[Tt]eleport\b[^>]*\bto=["'])body(["'])/g,'$1#dsh-ssh-root$2');return modified!==code?{code:modified,map:null}:null;}},vue(),tailwindcss()],
 resolve:{alias:{'@':path.join(frontend,'src')}},
 build:{write:false,minify:true,cssCodeSplit:false,lib:{entry:path.join(frontend,'src/harness-entry.ts'),name:'DshSshClient',formats:['iife']},rolldownOptions:{external:['react'],output:{globals:{react:'__dshReact'}}},chunkSizeWarningLimit:20000},
});
const outputs=(Array.isArray(result)?result:[result]).flatMap(item=>item.output);
console.log('Emitted assets:',outputs.map(item=>item.fileName).join(', '));
const unexpected=outputs.filter(item=>!(item.type==='chunk'&&item.isEntry)&&!item.fileName.endsWith('.css'));
if(unexpected.length)throw new Error('Unembedded frontend assets: '+unexpected.map(item=>item.fileName).join(', '));
const script=outputs.find(item=>item.type==='chunk'&&item.isEntry);
const css=outputs.filter(item=>item.type==='asset'&&item.fileName.endsWith('.css')).map(item=>String(item.source)).join('\n');
const tree=postcss.parse(css);
const animations=new Map();tree.walkAtRules(/keyframes$/i,rule=>{const original=rule.params;const name='dsh-ssh-'+original;animations.set(original,name);rule.params=name;});
tree.walkDecls(declaration=>{if(declaration.prop.includes('animation')||declaration.prop.startsWith('--'))for(const [name,scoped] of animations)declaration.value=declaration.value.replace(new RegExp('(^|[\\s,])'+name+'(?=$|[\\s,])','g'),(_,before)=>before+scoped);});
tree.walkRules(rule=>{if(rule.parent?.type==='atrule'&&/keyframes$/i.test(rule.parent.name))return;rule.selectors=rule.selectors.map(scopeSelector);});
const bundle=script.code.replace(/(["'`])__DSH_SSH_CSS__\1/g,()=>JSON.stringify(tree.toString()));
const output='window.__ModuleLoader__.load({id:"@local/dsh-plugin-ssh",factory(require){\nconst __dshReact=require("react");\n'+bundle+'\nreturn DshSshClient.default || DshSshClient;\n}});\n';
await writeFile(path.join(root,'client.js'),output);
console.log(`Built client.js (${(Buffer.byteLength(output)/1024/1024).toFixed(2)} MiB), with isolated CSS and complete upstream workbench.`);
