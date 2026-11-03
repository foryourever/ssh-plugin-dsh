/// <reference types="node" />
// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { afterEach, expect, it, vi } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import { Context } from '@deepseek-ai/cordis';
let cleanup: (()=>void | Promise<void>) | undefined;
afterEach(async()=>{await cleanup?.();document.body.innerHTML='';});
it('loads the emitted lazy module and mounts the complete native server manager',async()=>{
 const registrations:any[]=[];let effect:()=>()=>void;let descriptor:any;const root=document.createElement('div');root.id='page-container';document.body.append(root);
 const React={createElement:(type:any,props:any,...children:any[])=>({type,props,children}),useRef:()=>({current:root}),useState:()=>['',()=>{}],useEffect:(fn:any)=>{effect=fn;}};
 (window as any).__ModuleLoader__={load:(value:any)=>{descriptor=value;}};
 const script=readFileSync('../client.js','utf8');
 // Harness's renderer has no Node globals. Keep this shadow in the bundle's
 // closure so its lazy factory and mounted components have the same boundary.
 new Function('process', 'Buffer', 'global', script)(undefined, undefined, undefined);
 expect(descriptor.id).toBe('@local/dsh-plugin-ssh');
 const plugin=descriptor.factory((name:string)=>{expect(name).toBe('react');return React;});
 const manifest=JSON.parse(readFileSync('../original/manifest.json','utf8'));
 const call=vi.fn(async(_namespace:string,endpoint:string,payload:any)=>{
  if(endpoint==='ssh-plugin/events')return new Promise(()=>{});
  if(payload.method==='manifest')return {ok:true,value:manifest};
  if(payload.method==='connections.list')return {ok:true,value:{connections:[]}};
  if(payload.method==='capabilities')return {ok:true,value:{storage:true}};
  return {ok:true,value:null};
 });
 const ctx=new Context();
 ctx.provide('connection',{rpc:{call}});
 ctx.provide('slots',{inject:(_name:string,fn:any)=>fn(),register:(options:any,component:any)=>registrations.push({options,component})});
 ctx.provide('locale',{text:()=> 'SSH'});
 cleanup=()=>ctx.fiber.dispose();
 const fiber=ctx.plugin(plugin);await fiber;
 expect(fiber.state).toBe(2);
 expect(registrations.map(row=>row.options)).toEqual([{name:'main',key:'ssh'},{name:'sidebar.panellist',id:'ssh',order:50,label:expect.any(Function)}]);
 registrations[0].component();
 const unmount=effect!();cleanup=async()=>{unmount();await ctx.fiber.dispose();};
 await flushPromises();await flushPromises();
 const css=root.querySelector('style')!.textContent!;
 expect(css).toContain('#dsh-ssh-root .sftp-body');
 expect(css).not.toContain('sftp-#dsh-ssh-root');
 expect(css).not.toContain('__DSH_SSH_CSS__');
 expect(root.textContent).toContain('Add your first server');
 const add=Array.from(root.querySelectorAll('button')).find(button=>button.textContent?.includes('Add server'))!;
 add.click();await flushPromises();
 expect(root.textContent).toContain('Authentication');
 expect(root.querySelector('form')).toBeTruthy();
 expect(root.querySelectorAll('iframe')).toHaveLength(0);
 const surface=root.querySelector('#dsh-ssh-root');
 const close=vi.fn();window.dbxPlugin.workbench!.onClose!(close);
 unmount();await flushPromises();
 expect(root.querySelector('#dsh-ssh-root')).toBeNull();
 expect(document.querySelector('[data-ssh-parking] #dsh-ssh-root')).toBe(surface);
 expect(close).not.toHaveBeenCalled();
 registrations[0].component();const leaveAgain=effect!();await flushPromises();
 expect(root.querySelector('#dsh-ssh-root')).toBe(surface);
 expect(root.querySelector('form')).toBeTruthy();
 expect(call.mock.calls.filter(args=>args[2]?.method==='manifest')).toHaveLength(1);
 cleanup=async()=>{leaveAgain();await ctx.fiber.dispose();await flushPromises();};
 await ctx.fiber.dispose();await flushPromises();
 expect(close).toHaveBeenCalledTimes(1);
 expect(root.querySelector('#dsh-ssh-root')).toBeNull();
 expect(document.querySelector('[data-ssh-parking]')).toBeNull();
});
