import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { generateKeyPairSync } from 'node:crypto';
import ssh2 from 'ssh2';
import { SSHService } from '../src/service.js';
import { toolDefinition } from '../src/tools.js';

// A real SSH wire server on loopback only; credentials and files exist only in this test.
// It never executes shell input. Its SFTP filesystem is an in-memory Map.
function localServer(key) {
  const files = new Map([['/hello.txt', Buffer.from('hello sftp')]]), clients = new Set();
  const { STATUS_CODE: S } = ssh2.utils.sftp;
  const server = new ssh2.Server({ hostKeys: [key] }, client => {
    clients.add(client); client.on('close',()=>clients.delete(client)); client.on('error',()=>{});
    client.on('authentication', ctx => ctx.method === 'password' && ctx.username === 'test-user' && ctx.password === 'test-only-password' ? ctx.accept() : ctx.reject(['password']));
    client.on('ready', () => client.on('session', accept => {
      const session = accept();
      session.on('pty', accept => accept());
      session.on('shell', accept => {
        const stream = accept();
        stream.write('loopback-test> ');
        stream.on('data', data => stream.write(data));
      });
      session.on('exec', (accept, reject, info) => {
        const stream = accept();
        if (info.command === 'printf harness-ssh-ok') stream.write('harness-ssh-ok');
        else if (info.command.includes('id -u')) stream.write('1000\n');
        else stream.write('test-server\n');
        stream.exit(0); stream.end();
      });
      session.on('sftp', accept => {
        const sftp = accept(), handles = new Map(); let next = 0;
        const attrs = name => ({ mode: 0o100644, uid: 1000, gid: 1000, size: files.get(name)?.length || 0, atime: 1700000000, mtime: 1700000000 });
        sftp.on('REALPATH',(id,name)=>sftp.name(id,[{filename:name==='.'?'/':name,longname:name,attrs:{mode:0o40755}}]));
        for (const method of ['STAT','LSTAT']) sftp.on(method,(id,name)=> files.has(name) ? sftp.attrs(id,attrs(name)) : sftp.status(id,S.NO_SUCH_FILE));
        sftp.on('OPEN',(id,name,flags)=>{
          if ((flags & 2) !== 0) { if ((flags & 16) || !files.has(name)) files.set(name,Buffer.alloc(0)); }
          if (!files.has(name)) return sftp.status(id,S.NO_SUCH_FILE);
          const handle=Buffer.alloc(4);handle.writeUInt32BE(++next);handles.set(next,name);sftp.handle(id,handle);
        });
        sftp.on('FSTAT',(id,handle)=>sftp.attrs(id,attrs(handles.get(handle.readUInt32BE()))));
        sftp.on('READ',(id,handle,offset,length)=>{
          const bytes=files.get(handles.get(handle.readUInt32BE()));
          if(offset>=bytes.length) sftp.status(id,S.EOF); else sftp.data(id,bytes.subarray(offset,offset+length));
        });
        sftp.on('WRITE',(id,handle,offset,bytes)=>{
          const name=handles.get(handle.readUInt32BE()),old=files.get(name),data=Buffer.alloc(Math.max(old.length,offset+bytes.length));old.copy(data);bytes.copy(data,offset);files.set(name,data);sftp.status(id,S.OK);
        });
        sftp.on('CLOSE',(id,handle)=>{handles.delete(handle.readUInt32BE());sftp.status(id,S.OK)});
      });
    }));
  });
  return { server, files, close: async()=>{for(const client of clients)client.end(); await new Promise(resolve=>server.close(resolve));} };
}
function result(envelope) { assert.equal(envelope.isError,false,JSON.stringify(envelope)); return JSON.parse(envelope.content.find(x=>x.type==='text').text); }

test('real backend: SSH exec, SFTP roundtrip, saved registry, encryption and read-only policy', { timeout: 45000, skip: process.platform !== 'darwin' || process.arch !== 'arm64' }, async t => {
  const dataDir=await fs.mkdtemp(path.join(os.tmpdir(),'dsh-ssh-integration-'));
  const key=generateKeyPairSync('rsa',{modulusLength:2048,privateKeyEncoding:{type:'pkcs1',format:'pem'},publicKeyEncoding:{type:'spki',format:'pem'}}).privateKey;
  const remote=localServer(key); await new Promise(resolve=>remote.server.listen(0,'127.0.0.1',resolve));
  const port=remote.server.address().port;
  const publicKey=ssh2.utils.parseKey(key).getPublicSSH().toString('base64');
  await fs.writeFile(path.join(dataDir,'known_hosts'),`[127.0.0.1]:${port} ssh-rsa ${publicKey}\n`);
  const service=new SSHService({dataDir});
  t.after(async()=>{await service.close();await remote.close();});
  await service.start();
  const tools=await service.tools(); assert.equal(tools.length,16);
  // Use the Agent-facing adapter, including schema validation, not just the backend.
  const registered = new Map(tools.map(tool => [tool.name, toolDefinition(tool, service)]));
  const callTool = (name, args) => registered.get(name).execute(args, { signal: new AbortController().signal });
  const empty=result(await callTool('ssh_list_connections',{})); assert.deepEqual(empty.connections,[]);
  const connection={id:'test-server',name:'Loopback only',host:'127.0.0.1',port,username:'test-user',password:'test-only-password',external_config:{authentication:'password',read_only:false}};
  const saved=await service.host('connections.save',{connection}); assert.equal(saved.password,undefined);
  assert.ok(!(await fs.readFile(path.join(dataDir,'connections.json'),'utf8')).includes('test-only-password'));
  const list=result(await callTool('ssh_list_connections',{})); assert.equal(list.connections.length,1); assert.equal(list.connections[0].id,'test-server');
  assert.ok(!JSON.stringify(list).includes('test-only-password'));
  const output=result(await callTool('ssh_exec',{connectionId:'test-server',command:'printf harness-ssh-ok'}));
  assert.match(JSON.stringify(output),/harness-ssh-ok/);
  const multi=result(await callTool('ssh_multi_exec',{targets:['test-server'],command:'printf harness-ssh-ok'}));
  assert.match(JSON.stringify(multi),/harness-ssh-ok/);
  // Two workbenches on one saved server own separate PTYs. Closing one must
  // leave its sibling listed and connected, without a connection disconnect.
  const first = await service.request('ssh/session/open', { connectionId: 'test-server', workbenchId: 'first-tab', requestedSessionId: 'first-terminal', cols: 80, rows: 24 });
  const second = await service.request('ssh/session/open', { connectionId: 'test-server', workbenchId: 'second-tab', requestedSessionId: 'second-terminal', cols: 80, rows: 24 });
  assert.notEqual(first.sessionId, second.sessionId);
  const sessions = await service.request('ssh/sessions/list', {});
  assert.ok(sessions.sessions.some(row => row.sessionId === first.sessionId && row.workbenchId === 'first-tab'));
  assert.ok(sessions.sessions.some(row => row.sessionId === second.sessionId && row.workbenchId === 'second-tab'));
  await service.request('ssh/session/close', { sessionId: first.sessionId });
  const remaining = await service.request('ssh/sessions/list', {});
  assert.ok(!remaining.sessions.some(row => row.sessionId === first.sessionId));
  assert.ok(remaining.sessions.some(row => row.sessionId === second.sessionId && row.connected));
  await service.request('ssh/session/close', { sessionId: second.sessionId });
  const read=result(await service.callTool('sftp_read_file',{connectionId:'test-server',path:'/hello.txt'})); assert.match(JSON.stringify(read),/hello sftp/);
  result(await service.callTool('sftp_write_file',{connectionId:'test-server',path:'/roundtrip.txt',content:'你好 Harness',overwrite:true}));
  assert.equal(remote.files.get('/roundtrip.txt').toString(),'你好 Harness');
  const again=result(await service.callTool('sftp_read_file',{connectionId:'test-server',path:'/roundtrip.txt'})); assert.match(JSON.stringify(again),/你好 Harness/);
  // Connection read_only is independently enforced without changing process env.
  await service.host('connections.save',{connection:{...connection,external_config:{authentication:'password',read_only:true}}});
  await assert.rejects(service.callTool('sftp_write_file',{connectionId:'test-server',path:'/blocked.txt',content:'blocked'}),/read.only/i);
  assert.equal(remote.files.has('/blocked.txt'),false);
});
