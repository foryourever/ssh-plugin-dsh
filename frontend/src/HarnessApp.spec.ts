// @vitest-environment happy-dom
import manifest from '../../original/manifest.json';
import { mount, flushPromises } from '@vue/test-utils';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import HarnessApp from './HarnessApp.vue';
import { bridgeState, closeWorkbench, installBridge, updateContext } from './harnessBridge';

const sessions=vi.hoisted(()=>({mounts:0,unmounts:0,closes:0}));
vi.mock('./App.vue',async()=>{
  const {h,onMounted,onUnmounted}=await import('vue');
  return {__esModule:true,default:{setup(){onMounted(()=>sessions.mounts++);onUnmounted(()=>sessions.unmounts++);window.dbxPlugin.workbench!.onClose!(()=>{sessions.closes++;});return()=>h('div',{class:'test-terminal'},'terminal scrollback');}}};
});
const records=[{id:'a',name:'开发服务器',host:'example.test',username:'root',external_config:{authentication:'private-key',private_key_path:'/old/key'}},{id:'b',name:'第二台',host:'second.test',username:'dev'}];
let wrapper:ReturnType<typeof mount>;let dispose:()=>Promise<void>;let call:ReturnType<typeof vi.fn>;
beforeEach(async()=>{
  document.documentElement.lang='zh-CN';
  Object.assign(sessions,{mounts:0,unmounts:0,closes:0});
  updateContext({});bridgeState.error='';
  document.body.innerHTML='<div id="dsh-ssh-root"></div>';
  call=vi.fn(async(_namespace:string,endpoint:string,payload:any)=>{
    if(endpoint==='ssh-plugin/events')return new Promise(()=>{});
    let value:any=null;
    if(payload.method==='manifest')value=manifest;
    if(payload.method==='connections.list')value={connections:records};
    if(payload.method==='capabilities')value={storage:true};
    if(payload.method==='connections.connect')value={connectionId:payload.params.id,workbenchId:'session-'+payload.params.id,plugin:{mode:'ssh'}};
    return {ok:true,value};
  });
  dispose=installBridge({connection:{rpc:{call}}},document.getElementById('dsh-ssh-root')!);
  wrapper=mount(HarnessApp,{attachTo:document.getElementById('dsh-ssh-root')!});
  await flushPromises();
});
afterEach(async()=>{await closeWorkbench();wrapper.unmount();await dispose();document.documentElement.lang='';document.body.innerHTML='';});
const button=(text:string)=>wrapper.findAll('button').find(node=>node.text()===text)!;
const rpcCalls=(method:string)=>call.mock.calls.filter(args=>args[2]?.method===method);
async function addPrivateKey(){await button('添加服务器').trigger('click');await wrapper.get('#ssh-field-authentication').setValue('private-key');}
async function choose(file?:File){const input=wrapper.get('input[type=file]');Object.defineProperty(input.element,'files',{configurable:true,value:file?[file]:[]});await input.trigger('change');await flushPromises();}

it('uses manifest Chinese labels, descriptions and select options, including advanced boolean-dependent fields',async()=>{
  await addPrivateKey();
  expect(wrapper.get('#ssh-field-authentication').text()).toContain('私钥');
  expect(wrapper.get('#ssh-field-authentication').text()).not.toContain('Private key');
  expect(wrapper.text()).toContain('认证方式');
  expect(wrapper.find('#ssh-field-password').exists()).toBe(false);
  expect(wrapper.text()).toContain('用于解锁私钥文件的口令');
  expect(wrapper.text()).toContain('留空保留已保存的凭据');
  expect(wrapper.text()).not.toContain('Choose how to sign in');
  await wrapper.get('#ssh-field-advanced_options').setValue(true);
  expect(wrapper.find('#ssh-field-read_only').exists()).toBe(true);
  expect(wrapper.get('[data-field=read_only]').text()).toContain('只读');
});
it('imports an extensionless private key into the secret slot and clears a previously saved path',async()=>{
  await wrapper.findAll('.ssh-row-actions')[0].findAll('button')[1].trigger('click');
  const key='-----BEGIN OPENSSH PRIVATE KEY-----\nfixture\n-----END OPENSSH PRIVATE KEY-----';
  await choose(new File([key],'id_ed25519',{type:'application/octet-stream'}));
  expect((wrapper.get('#ssh-field-private_key_path').element as HTMLInputElement).value).toBe('');
  expect(wrapper.text()).toContain('已导入私钥：id_ed25519');
  await wrapper.get('form').trigger('submit');await flushPromises();
  const params=rpcCalls('connections.save')[0][2].params;
  expect(params.secretSlots.private_key).toBe(key);
  expect(params.connection.external_config.private_key_path).toBe('');
  expect(JSON.stringify(params.connection)).not.toContain(key);
});
it('cancelling file selection preserves form data, while invalid and oversized files give a recoverable error',async()=>{
  await addPrivateKey();await wrapper.get('#ssh-field-private_key').setValue('existing draft');
  await choose();
  expect((wrapper.get('#ssh-field-private_key').element as HTMLTextAreaElement).value).toBe('existing draft');
  await choose(new File(['ssh-ed25519 public-key'],'id_ed25519.pub'));
  expect(wrapper.get('[role=alert]').text()).toContain('不是支持的私钥');
  await choose(new File(['x'.repeat(1024*1024+1)],'large'));
  expect(wrapper.get('[role=alert]').text()).toContain('1 MiB');
  expect((wrapper.get('#ssh-field-private_key').element as HTMLTextAreaElement).value).toBe('existing draft');
});
it('resumes the same workbench without reconnecting or losing terminal state; explicit disconnect still closes it',async()=>{
  await wrapper.findAll('.ssh-row-actions')[0].find('button').trigger('click');await flushPromises();await flushPromises();
  expect(sessions.mounts).toBe(1);
  await button('服务器').trigger('click');
  expect(button('返回会话')).toBeTruthy();
  await wrapper.findAll('.ssh-row-actions')[0].find('button').trigger('click');await flushPromises();
  expect(rpcCalls('connections.connect')).toHaveLength(1);
  expect(sessions).toEqual({mounts:1,unmounts:0,closes:0});
  expect(wrapper.get('.test-terminal').text()).toBe('terminal scrollback');
  await button('断开连接').trigger('click');await flushPromises();
  expect(sessions.closes).toBe(1);expect(sessions.unmounts).toBe(1);
  expect(rpcCalls('connections.disconnect')[0][2].params).toEqual({id:'a'});
});
it('switching to another server closes the old workbench and creates the requested one',async()=>{
  await wrapper.findAll('.ssh-row-actions')[0].find('button').trigger('click');await flushPromises();await flushPromises();
  await button('服务器').trigger('click');
  await wrapper.findAll('.ssh-row-actions')[1].find('button').trigger('click');await flushPromises();await flushPromises();
  expect(sessions).toEqual({mounts:2,unmounts:1,closes:1});
  expect(bridgeState.context.connectionId).toBe('b');
});
