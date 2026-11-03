import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHarnessRpc } from '../src/harness-rpc.js';

test('shared API routes reject malformed envelopes before dispatch', async () => {
  const routes=new Map();let calls=0;
  registerHarnessRpc({connection:{fetch:{register:route=>routes.set(route.path,route)}}},{dispatch(){calls++;}});
  const route=routes.get('/api/ssh-plugin/host');
  for(const [body,type,status] of [
    ['{}','text/plain',415],['{','application/json',400],['null','application/json',400],
    [JSON.stringify({type:'client-request',rpcId:'id',method:'ssh-plugin/request',payload:{}}),'application/json',400],
    [JSON.stringify({type:'client-request',rpcId:'',method:'ssh-plugin/host',payload:{}}),'application/json',400],
    [JSON.stringify({type:'client-request',rpcId:'id',method:'ssh-plugin/host'}),'application/json',400],
  ]) {
    const response=await route.fetch(new Request('http://localhost'+route.path,{method:'POST',headers:{'content-type':type},body}));
    assert.equal(response.status,status);
  }
  assert.equal(calls,0);
});

test('shared API routes preserve RPC correlation, errors and the request abort signal', async () => {
  const routes=new Map(),controller=new AbortController();
  registerHarnessRpc({connection:{fetch:{register:route=>routes.set(route.path,route)}}},{async dispatch(endpoint,payload,signal){
    assert.equal(endpoint,'events');controller.abort();assert.equal(signal.aborted,true);
    if(payload.fail)throw new Error('expected failure');return {cursor:1,events:[]};
  }});
  const route=routes.get('/api/ssh-plugin/events');
  for(const fail of [false,true]) {
    const request=new Request('http://localhost'+route.path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({type:'client-request',rpcId:'correlation-id',method:'ssh-plugin/events',payload:{fail}}),signal:controller.signal});
    const response=await route.fetch(request),body=await response.json();
    assert.equal(body.type,'server-response');assert.equal(body.rpcId,'correlation-id');assert.equal(body.result.ok,!fail);
    if(fail)assert.equal(body.result.error.message,'expected failure');else assert.equal(body.result.value.cursor,1);
  }
});
