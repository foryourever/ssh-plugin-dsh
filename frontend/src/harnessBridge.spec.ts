// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installBridge, updateContext, bridgeState } from './harnessBridge';
let dispose: (()=>Promise<void>) | undefined;
let call: ReturnType<typeof vi.fn>;
let deliver: (value:any)=>void;
beforeEach(()=>{
  document.body.innerHTML='<div id="host-sentinel">Host</div><div id="dsh-ssh-root"></div>';
  updateContext({}); bridgeState.error='';bridgeState.prompt=null;
  call=vi.fn(async(_namespace:string,endpoint:string,payload:any)=>endpoint==='ssh-plugin/events'?await new Promise(resolve=>{deliver=resolve;}):{ok:true,value:{method:payload.method,params:payload.params}});
  dispose=installBridge({connection:{rpc:{call}}},document.getElementById('dsh-ssh-root')!);
});
afterEach(async()=>{await dispose?.();document.body.removeAttribute('style');vi.restoreAllMocks();});
describe('native DBX bridge',()=>{
  it('routes host methods, original backend methods, and binary bytes through verified RPC envelopes',async()=>{
    await window.dbxPlugin.invoke('ssh/session/list',{connectionId:'a'});
    await window.dbxPlugin.request('host.getContext');
    await window.dbxPlugin.sendBinary('ssh/terminal/in/a',new Uint8Array([0,127,255]));
    expect(call).toHaveBeenCalledWith('/api','ssh-plugin/request',{method:'ssh/session/list',params:{connectionId:'a'}});
    expect(call).toHaveBeenCalledWith('/api','ssh-plugin/host',{method:'host.getContext',params:{}});
    expect(call).toHaveBeenCalledWith('/api','ssh-plugin/binary',{channel:'ssh/terminal/in/a',data:'AH//'});
  });
  it('does not freeze the initial context in ready',async()=>{
    updateContext({connectionId:'selected',workbenchId:'workbench'});
    expect(await window.dbxPlugin.ready).toMatchObject({connectionId:'selected'});
  });
  it('delivers byte-exact binary events and native verification prompts',async()=>{
    const binary=vi.fn();window.dbxPlugin.onBinary(binary);
    deliver({ok:true,value:{cursor:2,events:[{sequence:1,kind:'binary',channel:'ssh/terminal/out/a',data:'AP8K'},{sequence:2,kind:'event',method:'dsh/host-prompt',params:{id:'prompt',prompt:'Verify host?'}}]}});
    await Promise.resolve();await Promise.resolve();await Promise.resolve();
    expect(binary).toHaveBeenCalledWith({channel:'ssh/terminal/out/a',data:new Uint8Array([0,255,10])});
    expect(bridgeState.prompt).toMatchObject({id:'prompt'});
  });
  it('surfaces structured host errors',async()=>{
    call.mockResolvedValueOnce({ok:false,error:{message:'Backend unavailable'}});
    await expect(window.dbxPlugin.invoke('ssh/exec',{})).rejects.toThrow('Backend unavailable');
  });
  it('maps host appearance on the plugin root without changing host DOM',()=>{
    expect(document.getElementById('host-sentinel')?.textContent).toBe('Host');
    expect(document.getElementById('dsh-ssh-root')?.style.getPropertyValue('--background')).toBeTruthy();
    expect(document.documentElement.style.getPropertyValue('--background')).toBe('');
  });
  it('provides semantic chart and icon colors when Harness has no status tokens',()=>{
    const root=document.getElementById('dsh-ssh-root')!;
    expect(root.style.getPropertyValue('--info')).toBe('rgb(37 99 235)');
    expect(root.style.getPropertyValue('--success')).toBe('rgb(22 163 74)');
    expect(root.style.getPropertyValue('--warning')).toBe('rgb(217 119 6)');
    expect(window.dbxPlugin.theme?.tokens?.['--color-info']).toBe('rgb(37 99 235)');
    expect(root.style.getPropertyValue('--color-info')).toBe('rgb(37 99 235)');
  });
  it('updates status colors on a dark theme change and honors supplied host colors',async()=>{
    const root=document.getElementById('dsh-ssh-root')!;
    document.body.style.colorScheme='dark';
    await new Promise(resolve=>setTimeout(resolve,0));
    expect(root.dataset.theme).toBe('dark');
    expect(root.style.getPropertyValue('--success')).toBe('rgb(74 222 128)');
    expect(root.style.getPropertyValue('--warning')).toBe('rgb(251 191 36)');
    expect(root.style.getPropertyValue('--info')).toBe('rgb(96 165 250)');
    document.body.style.setProperty('--color-info','#13579b');
    document.body.style.setProperty('--color-success','#24682a');
    await new Promise(resolve=>setTimeout(resolve,0));
    expect(root.style.getPropertyValue('--color-info')).toBe('#13579b');
    expect(root.style.getPropertyValue('--success')).toBe('#24682a');
    expect(document.documentElement.style.getPropertyValue('--info')).toBe('');
  });
  it('hydrates storage through the host endpoint',async()=>{
    await window.dbxPlugin.storage!.set('ssh-font',13);
    expect(call).toHaveBeenCalledWith('/api','ssh-plugin/host',{method:'host.storage.set',params:{key:'ssh-font',value:13}});
  });
});
