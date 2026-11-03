import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Store, redact } from '../src/store.js';
import { validateMcp, harnessSchema, toolDefinition } from '../src/tools.js';

test('connection secrets are encrypted, edits preserve omitted credentials and explicit empty clears', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-ssh-store-'));
  const store = await new Store(dir).init();
  await store.saveConnection({ id: 'a', password: 'test-secret', connection_secrets: { private_key: 'test-key' }, external_config: { jump_hosts: [{ password: 'jump-secret' }] } });
  const disk = await fs.readFile(path.join(dir, 'connections.json'), 'utf8');
  assert.ok(!disk.includes('test-secret')); assert.ok(!disk.includes('test-key')); assert.ok(!disk.includes('jump-secret'));
  await store.saveConnection({ id: 'a', name: 'edited' });
  assert.equal((await store.connections()).a.password, 'test-secret');
  await store.saveConnection({ id: 'a', password: '' }); assert.equal((await store.connections()).a.password, '');
  const restarted = await new Store(dir).init(); assert.equal((await restarted.connections()).a.connection_secrets.private_key, 'test-key');
  if (process.platform !== 'win32') assert.equal((await fs.stat(path.join(dir, 'connections.key'))).mode & 0o777, 0o600);
});
test('tampered ciphertext fails closed and concurrent updates do not lose records', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-ssh-store-'));
  const store = await new Store(dir).init();
  await Promise.all(Array.from({length: 20}, (_, i) => store.saveConnection({ id: String(i), password: 'ephemeral' })));
  assert.equal(Object.keys(await store.connections()).length, 20);
  const sealed = store.encrypt({ value: 1 }); sealed.tag = Buffer.alloc(16).toString('base64'); assert.throws(() => store.decrypt(sealed));
});
test('public connection projection strips nested credentials while retaining auth settings', () => {
  const value = redact({ password: 'x', connection_secrets: { private_key: 'x' }, external_config: { password_source: 'command', password_command: 'op read', private_key_path: '/test/key', jump_hosts: [{ password: 'x', host: 'h' }] } });
  assert.equal(value.password, undefined); assert.equal(value.connection_secrets, undefined); assert.equal(value.external_config.jump_hosts[0].password, undefined); assert.equal(value.external_config.password_source, 'command');
});
test('MCP union and array bounds remain enforced beyond the DSH schema vocabulary', () => {
  const schema = { type: 'object', properties: {host:{type:'string'},username:{type:'string'},connectionId:{type:'string'},items:{type:'array',minItems:1,maxItems:2,items:{type:'integer'}}}, anyOf:[{required:['connectionId']},{required:['host','username']}] };
  assert.equal(validateMcp(schema,{host:'a',username:'b',items:[1]}).length,0);
  assert.ok(validateMcp(schema,{host:'a',items:[]}).length > 0);
  assert.ok(validateMcp(schema,{connectionId:'a',items:[1,2,3]}).length > 0);
  assert.equal(harnessSchema(schema).anyOf,undefined);
  assert.equal(harnessSchema(schema).additionalProperties,true);
});
test('tool executes upstream name and preserves canonical MCP envelope', async () => {
  const upstream={name:'ssh_example',description:'Example',inputSchema:{type:'object',properties:{x:{type:'string'}},required:['x']}};
  let call; const tool=toolDefinition(upstream,{callTool:async(...args)=>{call=args;return{content:[{type:'text',text:'ok'}],isError:false}}});
  const signal=new AbortController().signal; const value=await tool.execute({x:'a'},{signal});
  assert.deepEqual(call,['ssh_example',{x:'a'},{signal}]); assert.deepEqual(tool.output.render({},value),[{type:'text',text:'ok'}]);
  await assert.rejects(tool.execute({},{signal}),/required/);
});
