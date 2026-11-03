import { reactive } from 'vue';
export interface HarnessWorkbench {
  id: string;
  context: Record<string, any>;
  title: string;
}
export const bridgeState = reactive({ context: {} as Record<string, any>, workbenches: [] as HarnessWorkbench[], activeId: '', error: '', prompt: null as any, title: 'SSH', recommendations: [] as Array<{id:string;label:string;prompt:string}>, generation: 0 });
export let hostCall: <T = any>(method: string, params?: any) => Promise<T>;
const events = new Set<(event: any) => void>();
const binaries = new Set<(event: any) => void>();
const contexts = new Set<(context: any) => void>();
const appearances = new Set<(appearance: any) => void>();
const closeListeners = new Set<() => any>();
const workbenchCloses = new Map<string, Set<() => any>>();
let cursor = 0;
const bytes = (data: Uint8Array | ArrayBuffer | string) => typeof data === 'string' ? decodeBase64(data) : data instanceof Uint8Array ? data : new Uint8Array(data);
export function encodeBase64(data: Uint8Array | ArrayBuffer) { const value = bytes(data); let text = ''; for (let i=0;i<value.length;i+=32768) text += String.fromCharCode(...value.subarray(i,i+32768)); return btoa(text); }
export function decodeBase64(data: string) { return Uint8Array.from(atob(data), c => c.charCodeAt(0)); }
function dispatch<T>(listeners: Set<(value:T)=>void>, value:T) { for(const listener of listeners) { try { listener(value); } catch(error) { console.error('SSH event listener failed',error); } } }
const subscribe = <T>(set: Set<T>, callback: T) => { set.add(callback); return () => set.delete(callback); };
export const pluginRoot = () => document.getElementById('dsh-ssh-root') || document.createElement('div');
export async function closeWorkbench(id?: string) {
  const targets = id ? bridgeState.workbenches.filter(row => row.id === id) : [...bridgeState.workbenches];
  const listeners = targets.flatMap(row => [...(workbenchCloses.get(row.id) || [])]);
  for (const row of targets) workbenchCloses.delete(row.id);
  if (!id) { listeners.push(...closeListeners); closeListeners.clear(); }
  await Promise.allSettled(listeners.map(async fn => fn()));
  const index = bridgeState.workbenches.findIndex(row => row.id === bridgeState.activeId);
  const removed = new Set(targets.map(row => row.id));
  bridgeState.workbenches = bridgeState.workbenches.filter(row => !removed.has(row.id));
  if (!id || removed.has(bridgeState.activeId)) {
    const next = bridgeState.workbenches[Math.max(0, index - 1)] || bridgeState.workbenches[0];
    bridgeState.activeId = '';
    if (next) selectWorkbench(next.id);
    else { bridgeState.title = 'SSH'; updateContext({}); }
  }
}
export function updateContext(context: Record<string, any>) { bridgeState.context = context; bridgeState.generation++; dispatch(contexts,context); }
export function selectWorkbench(id: string) {
  const entry = bridgeState.workbenches.find(row => row.id === id);
  if (!entry) return;
  bridgeState.activeId = id; bridgeState.title = entry.title; updateContext(entry.context);
}
export async function openContext(context: Record<string, any>, forceNew = false) {
  const existing = !forceNew && bridgeState.workbenches.find(row => context.connectionId
    ? row.context.connectionId === context.connectionId
    : context.plugin?.mode === 'local-terminal' ? row.context.plugin?.mode === 'local-terminal' : row.context.id === context.id);
  if (existing) { selectWorkbench(existing.id); return; }
  const id = crypto.randomUUID();
  const name = context.connection?.name || context.name || (context.plugin?.mode === 'local-terminal' ? 'Local terminal' : context.connectionId || 'SSH');
  bridgeState.workbenches.push({ id, context: { ...context, workbenchId: id, surface: 'tab' }, title: name });
  selectWorkbench(id);
}

// Each mounted workbench keeps its own context and close scope. Backend binary
// events are still shared; the original handlers filter them by sessionId.
export function createWorkbenchApi(entry: HarnessWorkbench, active: () => boolean): DbxPluginApi {
  const base = window.dbxPlugin;
  const ownContexts = new Set<(context: Record<string, unknown>) => void>();
  const closes = new Set<() => any>();
  workbenchCloses.set(entry.id, closes);
  const reopen = async (connectionId: string) => {
    const context = await hostCall<any>('host.reopenConnection', { connectionId });
    entry.context = { ...entry.context, ...context, workbenchId: entry.id, surface: 'tab' };
    if (bridgeState.activeId === entry.id) updateContext(entry.context);
    dispatch(ownContexts, entry.context);
    return entry.context;
  };
  const request = async <T = unknown>(method: string, params?: unknown): Promise<T> => method === 'host.getContext'
    ? entry.context as T : method === 'host.reopenConnection' ? await reopen((params as any).connectionId) as T : base.request<T>(method, params);
  const overrides: Partial<DbxPluginApi> = {
    request, invoke: request,
    onContext: fn => subscribe(ownContexts, fn),
    reopenConnection: reopen,
    async setTitle(title) { entry.title = title || 'SSH'; if (bridgeState.activeId === entry.id) bridgeState.title = entry.title; },
    async getTitle() { return entry.title; },
    workbench: { onClose: fn => subscribe(closes, fn) },
    workbenchState: { async set(state) { entry.context = { ...entry.context, workbenchState: state }; } },
    fileTransfer: base.fileTransfer && { ...base.fileTransfer,
      onDrop: fn => base.fileTransfer!.onDrop((...args) => { if (active()) fn(...args); }),
      onDragState: fn => base.fileTransfer!.onDragState(value => { if (active()) fn(value); }),
    },
  };
  return new Proxy(base, { get(target, property) {
    if (property === 'ready') return Promise.resolve(entry.context);
    if (property === 'context') return entry.context;
    return property in overrides ? Reflect.get(overrides, property) : Reflect.get(target, property);
  } });
}
export function installBridge(ctx: any, root: HTMLElement) {
  let stopped = false; let pollTimer: ReturnType<typeof setTimeout> | undefined; const previousApi = window.dbxPlugin;
  const rpc = async <T = any>(endpoint: string, payload: any): Promise<T> => { const result = await ctx.connection.rpc.call('/api', `ssh-plugin/${endpoint}`, payload); if (!result.ok) throw new Error(typeof result.error === 'string' ? result.error : result.error?.message || 'SSH bridge request failed.'); return result.value; };
  hostCall = (method, params = {}) => rpc('host', { method, params });
  const request = <T = any>(method: string, params: any = {}): Promise<T> => method.startsWith('host.') ? hostCall(method, params) : rpc('request', { method, params });
  const files = new Map<string, File | { chunks: Uint8Array[]; name: string; contentType: string; size: number }>();
  const dragListeners = new Set<(active: boolean) => void>(); const dropListeners = new Set<(files: any[], drop?: any) => void>();
  function registerFile(file: File, relativePath?: string) { const handleId = crypto.randomUUID(); files.set(handleId, file); return { handleId, name: file.name, size: file.size, contentType: file.type, ...(relativePath ? {relativePath}: {}) }; }
  function download(name: string, contentType: string, chunks: BlobPart[]) { const url = URL.createObjectURL(new Blob(chunks, { type: contentType })); const anchor = document.createElement('a'); anchor.href=url; anchor.download=name; root.append(anchor); anchor.click(); anchor.remove(); setTimeout(()=>URL.revokeObjectURL(url), 60000); }
  const fileTransfer: DbxPluginFileTransferApi = {
    async pick(options = {}) { return new Promise(resolve => { const input = document.createElement('input'); input.type='file'; input.multiple=!!options.multiple; input.accept=options.accept || ''; input.addEventListener('change',()=>resolve({ files: Array.from(input.files || []).map(file=>registerFile(file)) }),{once:true}); input.addEventListener('cancel',()=>resolve({files:[]}),{once:true}); input.click(); }); },
    async read(id, offset, length=256*1024) { const file=files.get(id); if (!(file instanceof File)) throw new Error('Upload handle expired. Select the file again.'); const data=new Uint8Array(await file.slice(offset,offset+length).arrayBuffer()); return {dataBase64:encodeBase64(data),length:data.length,eof:offset+data.length>=file.size}; },
    async beginSave(options) { const handleId=crypto.randomUUID(); files.set(handleId,{ chunks:[],name:options.name,contentType:options.contentType || 'application/octet-stream',size:0 }); return {handleId,chunkBytes:256*1024}; },
    async write(id, offset, data) { const file=files.get(id); if (!file || file instanceof File) throw new Error('Download handle expired. Start the download again.'); if(offset!==file.size) throw new Error('Download chunks arrived out of order.'); const value=bytes(data); file.chunks.push(value.slice()); file.size+=value.length; return {written:value.length,nextOffset:file.size}; },
    async finish(id) { const file=files.get(id); if (file && !(file instanceof File)) download(file.name,file.contentType,file.chunks as BlobPart[]); files.delete(id); },
    async cancel(id) {files.delete(id);}, onDragState: fn=>subscribe(dragListeners,fn),onDrop:fn=>subscribe(dropListeners,fn),
  };
  const drag = (event: DragEvent) => { if(!event.dataTransfer?.types.includes('Files'))return; event.preventDefault(); for(const fn of dragListeners)fn(event.type!=='dragleave'); };
  const drop = async(event: DragEvent) => { if(!event.dataTransfer?.files.length)return; event.preventDefault(); for(const fn of dragListeners)fn(false); const result: any[]=[]; const visit=async(entry:any,path='')=>{ if(entry.isFile) await new Promise<void>((resolve,reject)=>entry.file((file:File)=>{result.push(registerFile(file,path+file.name));resolve();},reject)); else if(entry.isDirectory) {const reader=entry.createReader();for(;;){const entries:any[]=await new Promise((resolve,reject)=>reader.readEntries(resolve,reject));if(!entries.length)break;for(const child of entries)await visit(child,path+entry.name+'/');}} }; try {const entries=Array.from(event.dataTransfer.items).map(item=>(item as any).webkitGetAsEntry?.()).filter(Boolean);if(entries.length)for(const entry of entries)await visit(entry);else for(const file of Array.from(event.dataTransfer.files))result.push(registerFile(file));for(const fn of dropListeners)fn(result);}catch(error){bridgeState.error=String(error);} };
  root.addEventListener('dragover',drag);root.addEventListener('dragleave',drag);root.addEventListener('drop',drop);
  const api: DbxPluginApi = {
    get ready(){return Promise.resolve(bridgeState.context);}, get context(){return bridgeState.context;}, get locale(){return document.documentElement.lang || navigator.language || 'en';},
    capabilities: {storage:true, clipboardRead:!!navigator.clipboard?.readText,clipboardWrite:!!navigator.clipboard?.writeText,connectionsApi:true,workbenchTitle:true},
    storage:{get:key=>hostCall('host.storage.get',{key}),set:(key,value)=>hostCall('host.storage.set',{key,value}),delete:key=>hostCall('host.storage.delete',{key})},
    request, invoke:request, notify:async(method,params)=>{await request(method,params);},
    sendBinary:async(channel,data)=>{await rpc('binary',{channel,data:typeof data==='string'?data:encodeBase64(data)});},
    onEvent:fn=>subscribe(events,fn),onBinary:fn=>subscribe(binaries,fn),onContext:fn=>subscribe(contexts,fn),onAppearanceChange:fn=>subscribe(appearances,fn),encodeBase64,decodeBase64,fileTransfer,
    clipboard:{readText:()=>navigator.clipboard.readText(),writeText:text=>navigator.clipboard.writeText(text)},
    async saveFile(options,data){download(options.fileName,options.contentType||'application/octet-stream',[bytes(data) as BlobPart]);return {path:options.fileName};},
    reopenConnection:connectionId=>hostCall('host.reopenConnection',{connectionId}),
    async openWorkbench(contributionId,context={},options={}) { if(context.connectionId) await openContext({...await hostCall('connections.connect',{id:context.connectionId}),...context}, options.forceNew); else if((context.plugin as any)?.mode==='local-terminal') await openContext(context,options.forceNew); else if(contributionId.includes('tunnel')) await openContext({...context,id:context.id||bridgeState.context.connectionId,name:'SSH tunnels'}); },
    async setTitle(title){bridgeState.title=title||'SSH';},async getTitle(){return bridgeState.title;},
    workbenchState:{async set(state){bridgeState.context={...bridgeState.context,state};}},workbench:{onClose:fn=>subscribe(closeListeners,fn)},
  };
  window.dbxPlugin=api;
  const updateTheme=()=>{const style=getComputedStyle(document.body);const get=(names:string[],fallback:string)=>names.map(name=>style.getPropertyValue(name).trim()).find(Boolean)||fallback;const dark=style.colorScheme==='dark'||document.documentElement.dataset.theme==='dark'||document.documentElement.classList.contains('dark');const colors={background:get(['--dsw-alias-bg-base','--color-background','--background'],dark?'#17191c':'#ffffff'),foreground:get(['--dsw-alias-text-primary','--color-foreground','--foreground'],dark?'#e3e6eb':'#1e2630'),muted:get(['--dsw-alias-bg-l1','--color-muted','--muted'],dark?'#262a30':'#f0f2f5'),mutedForeground:get(['--dsw-alias-text-secondary','--color-muted-foreground','--muted-foreground'],dark?'#adb5c2':'#566273'),accent:get(['--color-accent','--accent'],dark?'#303944':'#e9eef4'),accentForeground:get(['--color-accent-foreground','--foreground'],dark?'#eff4fa':'#152236'),border:get(['--dsw-alias-border-l2','--color-border','--border'],dark?'#414954':'#d4dbe4'),destructive:get(['--color-destructive'],'#df4545'),success:get(['--dsw-alias-text-success','--color-success'],dark?'rgb(74 222 128)':'rgb(22 163 74)'),warning:get(['--dsw-alias-text-warning','--color-warning'],dark?'rgb(251 191 36)':'rgb(217 119 6)'),info:get(['--dsw-alias-text-info','--color-info'],dark?'rgb(96 165 250)':'rgb(37 99 235)'),primary:get(['--color-primary','--primary'],'#397bd1'),primaryForeground:get(['--color-primary-foreground','--primary-foreground'],'#ffffff')};const theme:DbxPluginTheme={appearance:dark?'dark':'light',tokens:{}};for(const [key,value]of Object.entries(colors)){const kebab=key.replace(/[A-Z]/g,c=>'-'+c.toLowerCase());root.style.setProperty('--'+kebab,value);root.style.setProperty('--color-'+kebab,value);theme.tokens['--color-'+kebab]=value;}root.dataset.dbxTheme=theme.appearance;root.dataset.theme=theme.appearance;root.style.colorScheme=theme.appearance;const appearance:DbxPluginAppearance={colorScheme:theme.appearance,colors,terminal:{fontFamily:'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',fontSize:13},ui:{fontFamily:'system-ui, sans-serif'}};Object.defineProperty(api,'theme',{configurable:true,value:theme});Object.defineProperty(api,'appearance',{configurable:true,value:appearance});dispatch(appearances,appearance);dispatch(events,{type:'env',theme,locale:api.locale});};
  updateTheme();const themeObserver=new MutationObserver(updateTheme);themeObserver.observe(document.documentElement,{attributes:true,attributeFilter:['style','class','data-theme','data-color-scheme']});
  async function poll(){if(stopped)return;try{const result=await rpc<any>('events',{after:cursor,waitMs:20000});if(stopped)return;if(result.reset){cursor=0;dispatch(events,{type:'event',method:'dsh/events-reset',params:{cursor:result.cursor}});}for(const event of result.events||[]){cursor=Math.max(cursor,event.sequence||0);if(event.kind==='binary'){const value={channel:event.channel,data:decodeBase64(event.data)};dispatch(binaries,value);}else if(event.method==='dsh/host-prompt')bridgeState.prompt=event.params;else if(event.method==='dsh/ai-conversation' && event.params?.sessionId)ctx.get('uiWorkspace')?.openSession(event.params.sessionId);else if(event.method==='dsh/ai-recommendations')bridgeState.recommendations=event.params?.items||[];else dispatch(events,{type:'event',method:event.method,params:event.params});}cursor=Math.max(cursor,result.cursor||0);bridgeState.error='';pollTimer=setTimeout(poll,result.events?.length?0:40);}catch(error){if(stopped)return;bridgeState.error=String(error);pollTimer=setTimeout(poll,1500);}}
  themeObserver.observe(document.body,{attributes:true,attributeFilter:['style','data-ds-dark-theme']});
  void poll();
  return async()=>{stopped=true;clearTimeout(pollTimer);themeObserver.disconnect();root.removeEventListener('dragover',drag);root.removeEventListener('dragleave',drag);root.removeEventListener('drop',drop);files.clear();events.clear();binaries.clear();contexts.clear();appearances.clear();closeListeners.clear();if(window.dbxPlugin===api)window.dbxPlugin=previousApi;};
}
