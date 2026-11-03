import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { apply } from '../index.js';
import * as plugin from '../index.js';
import { Context, Service } from '@deepseek-ai/cordis';
import { SSHService } from '../src/service.js';
const native = process.platform === 'darwin' && process.arch === 'arm64';
async function rpc(handlers, endpoint, payload, signal) {
  const method=`ssh-plugin/${endpoint}`,path=`/api/${method}`;
  const response=await handlers.get(path)(new Request(`http://localhost${path}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({type:'client-request',rpcId:'host-test',method,payload}),signal}));
  assert.equal(response.status,200);return (await response.json()).result;
}

test('native bundle registers all tools and authenticated RPC; disposal releases every registration', {skip:!native, timeout:10000}, async () => {
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'dsh-ssh-host-'));
  const tools=new Map(), handlers=new Map(), disposers=[];
  const ctx={get(){return undefined;},effect(fn){const dispose=fn();if(dispose)disposers.push(dispose);return dispose;},tools:{register(tool){tools.set(tool.name,tool);return()=>tools.delete(tool.name);}},connection:{fetch:{register(route){handlers.set(route.path,route.fetch);disposers.push(()=>handlers.delete(route.path));}}}};
  await apply(ctx,{dataDir:directory});
  try {
    assert.equal(tools.size,16);assert.equal(handlers.size,4);
    for(const tool of tools.values()){assert.equal(tool.parameters.type,'object');assert.equal(typeof tool.output.render,'function');}
    const signal=new AbortController().signal;
    const manifest=await rpc(handlers,'host',{method:'manifest'},signal);assert.equal(manifest.ok,true);assert.equal(manifest.value.version,'0.7.13-beta.1');
    const invalid=await rpc(handlers,'host',{method:'anything'},signal);assert.equal(invalid.ok,false);
    const capabilities=await rpc(handlers,'host',{method:'capabilities'},signal);assert.equal(capabilities.value.ai,false);
    const storage=await rpc(handlers,'host',{method:'host.storage.set',params:{key:'layout',value:{width:300}}},signal);assert.equal(storage.ok,true);
    const value=await rpc(handlers,'host',{method:'host.storage.get',params:{key:'layout'}},signal);assert.deepEqual(value.value,{width:300});
    const poisoned=await rpc(handlers,'host',{method:'host.storage.set',params:{key:'__proto__',value:'x'}},signal);assert.equal(poisoned.ok,false);
  } finally { for(const dispose of disposers.reverse())await dispose(); }
  assert.equal(tools.size,0);assert.equal(handlers.size,0);
});
for (const withAI of [false, true]) test(`real Cordis activates SSH with optional AI services ${withAI ? 'present' : 'absent'}`, {skip:!native, timeout:10000}, async () => {
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'dsh-ssh-cordis-'));
  const ctx=new Context(), tools=new Map(), handlers=new Map();
  try {
    ctx.provide('tools',{register(tool){tools.set(tool.name,tool);return()=>tools.delete(tool.name);}});
    // A service-owned registration must be tied to the SSH caller's lifecycle.
    class ConnectionFixture extends Service {
      constructor(owner){super(owner,'connection');}
      get fetch(){const owner=this.ctx;return {register(route){return owner.effect(()=>{handlers.set(route.path,route.fetch);return()=>handlers.delete(route.path);});}};}
    }
    await ctx.plugin(ConnectionFixture);
    if (withAI) { ctx.provide('sessionController',{});ctx.provide('llm',{}); }
    const fiber=ctx.plugin(plugin,{dataDir:directory});
    await fiber;
    assert.equal(fiber.state,2,'plugin must be ACTIVE, not waiting for required/optional services');
    assert.equal(tools.size,16);assert.equal(handlers.size,4);
    const response=await rpc(handlers,'host',{method:'capabilities'},new AbortController().signal);
    assert.equal(response.ok,true);assert.equal(response.value.ai,withAI);assert.equal(response.value.aiCompletion,withAI);
  } finally { await ctx.fiber.dispose();await fs.rm(directory,{recursive:true,force:true}); }
  assert.equal(tools.size,0);assert.equal(handlers.size,0);
});
test('event polling uses cursors, isolates cancellation, and brokers user input without logging replies', async () => {
  const service=new SSHService({dataDir:'/unused-test-directory'});
  service.publish({kind:'event',method:'test',params:{value:1}});
  const first=await service.poll({after:0,waitMs:0});assert.equal(first.cursor,1);assert.equal(first.events[0].method,'test');
  const controller=new AbortController(),pending=service.poll({after:1},controller.signal);controller.abort();await assert.rejects(pending);
  const answer=service.hostPrompt('host/requestUserInput',{title:'Test',prompt:'One-time code'});
  const prompt=(await service.poll({after:1,waitMs:0})).events[0];
  service.prompts.get(prompt.params.id)({action:'submit',value:'test-only-code'});
  assert.deepEqual(await answer,{action:'submit',value:'test-only-code'});
  assert.ok(!JSON.stringify(service.events).includes('test-only-code'));
  await service.close();
});
