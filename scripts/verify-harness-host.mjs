// Exercise the installed Harness services, including context ownership and HTTP
// authentication. All state and credentials are temporary and loopback-only.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const runtime = process.env.DSH_RUNTIME_DIR || path.resolve(path.dirname(process.execPath), '../lib/node_modules/@deepseek-ai/dsh');
const require = createRequire(path.join(runtime, 'package.json'));
const load = name => import(pathToFileURL(require.resolve(name)).href);
const { Context } = await load('@deepseek-ai/cordis');
const { default: WebServer } = await load('@deepseek-ai/dsh-host-webserver');
const connectionPlugin = await load('@deepseek-ai/dsh-client-connection');
const { ToolRuntime } = await load('@deepseek-ai/dsh-tools');
const { SystemPrompt } = await load('@deepseek-ai/dsh-system-prompt');
const pluginRoot = process.env.DSH_SSH_VERIFY_PLUGIN_DIR || root;
const plugin = await import(pathToFileURL(path.join(pluginRoot, 'index.js')).href);
const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-ssh-real-host-'));
const ctx = new Context();
const credentials = new Map();
try {
  // Only the credential persistence adapter is in memory; authentication,
  // Connection, ToolRuntime, SystemPrompt and WebServer use the shipped code.
  ctx.provide('credentials', { async modifyRecord(key, modify) {
    const next = await modify(credentials.get(key));
    if (next !== undefined) credentials.set(key, next);
    return credentials.get(key);
  } });
  await ctx.plugin(SystemPrompt, {});
  await ctx.plugin(ToolRuntime, {});
  await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 });
  await ctx.plugin(connectionPlugin, {});
  const connection = ctx.get('connection'), web = ctx.get('webServer');
  const base = `http://127.0.0.1:${web.port}`;
  web.registerFallback((request, response) => {
    if (request.url?.startsWith('/?') && !connection.authorizeIndex(request, response)) return;
    response.writeHead(404); response.end();
  });
  const fiber = ctx.plugin(plugin, { dataDir: directory });
  await fiber;
  assert.equal(fiber.state, 2, 'SSH plugin must reach ACTIVE with real Harness services');
  const definitions = JSON.parse(await fs.readFile(path.join(pluginRoot, 'tools.snapshot.json'), 'utf8'));
  const names = (Array.isArray(definitions) ? definitions : definitions.tools).map(tool => tool.name);
  assert.equal(names.length, 16);
  for (const name of names) assert.ok(ctx.get('tools').get(name), `missing registered tool: ${name}`);
  const request = (method, payload, cookie) => fetch(`${base}/ssh-plugin/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: base, ...(cookie ? { cookie } : {}) },
    body: JSON.stringify({ type: 'client-request', rpcId: 'ssh-host-verification', method, payload }),
  });
  const unauthorized = await request('host', { method: 'capabilities' });
  assert.equal(unauthorized.status, 401, 'RPC must reject an unauthenticated browser');
  await unauthorized.text();
  const login = await fetch(connection.authenticatedUrl(base + '/'), { redirect: 'manual' });
  assert.equal(login.status, 303);
  const cookie = login.headers.get('set-cookie')?.split(';')[0];
  assert.ok(cookie, 'real Connection must issue a browser session cookie');
  await login.text();
  const capabilities = await request('host', { method: 'capabilities' }, cookie);
  assert.equal(capabilities.status, 200);
  assert.equal((await capabilities.json()).result.ok, true);
  const discovered = await request('request', { method: 'mcp/tools' }, cookie);
  assert.equal(discovered.status, 200);
  assert.equal((await discovered.json()).result.value.length, 16);
  await fiber.dispose();
  for (const name of names) assert.equal(ctx.get('tools').get(name), undefined, `tool leaked after disposal: ${name}`);
  const removed = await request('host', { method: 'capabilities' }, cookie);
  assert.equal(removed.status, 404, 'RPC route must be removed after disposal');
  await removed.text();
  console.log('Verified real Harness activation, 16 tools, authenticated HTTP RPC, unauthenticated rejection, and disposal.');
} finally {
  await ctx.fiber.dispose();
  await fs.rm(directory, { recursive: true, force: true });
}
