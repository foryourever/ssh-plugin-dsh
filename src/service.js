import { EventEmitter } from 'node:events';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { Store, redact, mergePreservingSecrets } from './store.js';
import { Sidecar } from './sidecar.js';

const root = fileURLToPath(new URL('../', import.meta.url));
// Upstream allows 64 MiB binary frames; base64 adds one third on the UI bridge.
const MAX_QUEUE_BYTES = 96 * 1024 * 1024;
export class SSHService extends EventEmitter {
  constructor(config = {}, integrations = {}) {
    super(); this.config = config; this.integrations = integrations;
    const profile = (process.env.DSH_PROFILE || 'default').replace(/[^a-zA-Z0-9_.-]/g, '_');
    this.dataDir = path.resolve(config.dataDir || process.env.DSH_SSH_DATA_DIR || path.join(os.homedir(), '.dsh-ssh', profile));
    this.store = new Store(this.dataDir); this.events = []; this.cursor = 0; this.queueBytes = 0;
    this.prompts = new Map(); this.context = { plugin: { mode: 'ssh' }, locale: 'zh-CN' }; this.closed = false;
  }
  async start() {
    if (this.closed) throw new Error('SSH plugin is disposed.');
    if (this.starting) return this.starting;
    this.starting = this.initialize().catch(async error => { await this.sidecar?.close(); this.starting = null; throw error; });
    return this.starting;
  }
  async initialize() {
    await this.store.init();
    if (this.closed) throw new Error('SSH plugin is disposed.');
    const command = path.resolve(this.config.backendPath || process.env.DSH_SSH_BACKEND || path.join(root, 'bin', process.platform === 'win32' ? 'dbx-plugin-ssh.exe' : 'dbx-plugin-ssh'));
    this.sidecar = this.integrations.makeSidecar?.() || new Sidecar({ command, dataDir: this.dataDir, env: { DBX_APP_DATA_DIR: path.join(this.dataDir, 'host-isolation') }, requestTimeoutMs: this.config.requestTimeoutMs || 600000, onHostRequest: (method, params, options) => this.hostPrompt(method, params, options) });
    this.sidecar.on('event', event => this.publish({ kind: 'event', ...event }));
    this.sidecar.on('binary', ({ channel, data }) => this.publish({ kind: 'binary', channel, data: Buffer.from(data).toString('base64') }));
    this.sidecar.on('error', error => this.publish({ kind: 'event', method: 'dsh/backend-error', params: { message: error.message } }));
    this.sidecar.on('exit', () => { this.starting = null; this.publish({ kind: 'event', method: 'dsh/backend-exit', params: {} }); });
    await this.sidecar.start();
    if (this.closed) { await this.sidecar.close(); throw new Error('SSH plugin is disposed.'); }
    const records = await this.store.connections();
    for (const record of Object.values(records)) await this.registerConnection(record);
    return this;
  }
  async registerConnection(record) {
    await this.sidecar.request('connection/connect', { connection: record });
    // A harmless list call carries the original lifecycle payload into the MCP registry.
    // The backend then applies its original read-only/scope/sudo policies to every call.
    if ((record.external_config?.protocol || 'ssh') === 'ssh' && record.db_type !== 'local') {
      await this.sidecar.request('mcp/call', { tool: 'ssh_list_connections', arguments: {}, lifecycle: { connection: record } });
    }
  }
  async request(method, params = {}, options = {}) {
    if (typeof method !== 'string' || !method || method.length > 256 || method.startsWith('plugin/')) throw new Error('Invalid backend method.');
    await this.start();
    if (method === 'connection/connect' || method === 'connection/test') {
      if (params.connectionId && !params.connection) params = { ...params, connection: await this.connection(params.connectionId) };
    }
    return this.sidecar.request(method, params, options);
  }
  async tools() { return this.request('mcp/tools'); }
  async callTool(tool, args, options = {}) {
    // Tool arguments never gain generic access to the UI bridge or secret storage.
    await this.start();
    return this.sidecar.request('mcp/call', { tool, arguments: args }, options);
  }
  async connection(id) {
    const value = (await this.store.connections())[id];
    if (!value) throw new Error('Connection does not exist.'); return value;
  }
  publish(event) {
    const value = { ...event, sequence: ++this.cursor };
    const bytes = Buffer.byteLength(JSON.stringify(value));
    this.events.push({ value, bytes }); this.queueBytes += bytes;
    while (this.queueBytes > MAX_QUEUE_BYTES || this.events.length > 4096) this.queueBytes -= this.events.shift().bytes;
    this.emit('available');
  }
  async poll({ after = 0, waitMs = 20000 } = {}, signal) {
    if (!Number.isSafeInteger(after) || after < 0) throw new Error('Invalid event cursor.');
    if (after === this.cursor && !signal?.aborted && !this.closed) {
      await new Promise(resolve => {
        const done = () => { clearTimeout(timer); this.off('available', done); signal?.removeEventListener('abort', done); resolve(); };
        const timer = setTimeout(done, Math.min(25000, Math.max(0, Number(waitMs) || 0)));
        this.once('available', done); signal?.addEventListener('abort', done, { once: true });
        if (signal?.aborted || this.closed) done();
      });
    }
    signal?.throwIfAborted();
    const first = this.events[0]?.value.sequence ?? this.cursor + 1;
    const reset = after < first - 1 || after > this.cursor;
    const events = this.events.filter(row => row.value.sequence > after).slice(0, 128).map(row => row.value);
    return { cursor: events.at(-1)?.sequence ?? this.cursor, events, reset };
  }
  async hostPrompt(method, params, { signal } = {}) {
    if (method !== 'host/requestUserInput') throw new Error(`Unsupported host request: ${method}`);
    const id = randomUUID();
    return new Promise(resolve => {
      const done = answer => { clearTimeout(timer); signal?.removeEventListener('abort', cancel); this.prompts.delete(id); resolve(answer); };
      const cancel = () => done({ action: 'cancel' });
      const timer = setTimeout(() => done({ action: 'timeout' }), Math.min(600000, Math.max(5000, (params.timeoutSecs || 300) * 1000)));
      this.prompts.set(id, done); signal?.addEventListener('abort', cancel, { once: true });
      this.publish({ kind: 'event', method: 'dsh/host-prompt', params: { ...params, id } });
      if (signal?.aborted) cancel();
    });
  }
  async host(method, params = {}, signal) {
    await this.start();
    switch (method) {
      case 'manifest': return JSON.parse(await fs.readFile(path.join(root, 'original/manifest.json'), 'utf8'));
      case 'capabilities': return { storage: true, binary: true, events: true, ai: !!this.integrations.ai, aiCompletion: !!this.integrations.generateText, aiRecommendations: true };
      case 'host.getContext': return this.context;
      case 'connections.list': return { connections: Object.values(await this.store.connections()).map(redact) };
      case 'host.listConnections': return { connections: Object.values(await this.store.connections()).map(c => ({ id: c.id, name: c.name, host: c.host, port: c.port, username: c.username, dbType: c.db_type || 'ssh' })) };
      case 'connections.save': {
        const input = structuredClone(params.connection);
        if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('connection is required.');
        input.id ||= randomUUID(); input.name ||= input.host || 'SSH'; input.port ??= 22;
        input.db_type ||= 'ssh'; input.external_config ||= {};
        if (params.secretSlots) input.connection_secrets = { ...input.connection_secrets, ...params.secretSlots };
        if (typeof input.id !== 'string' || input.id.length > 128 || typeof input.name !== 'string') throw new Error('Invalid connection identity.');
        const previous = (await this.store.connections())[input.id] || {};
        const candidate = mergePreservingSecrets(previous, input);
        await this.registerConnection(candidate);
        const saved = await this.store.saveConnection(candidate);
        this.publish({ kind: 'event', method: 'dsh/connections-changed', params: {} }); return redact(saved);
      }
      case 'connections.delete': {
        await this.connection(params.id);
        await this.store.deleteConnection(params.id);
        // Restart clears both original runtime registries, including decrypted credentials.
        await this.sidecar.close(); this.starting = null; await this.start();
        if (this.context.connectionId === params.id) this.context = { plugin: { mode: 'ssh' }, locale: 'zh-CN' };
        this.publish({ kind: 'event', method: 'dsh/connections-changed', params: {} }); return { success: true };
      }
      case 'host.reopenConnection':
      case 'connections.connect': {
        const connection = await this.connection(params.id || params.connectionId);
        await this.registerConnection(connection);
        this.context = { connectionId: connection.id, connection: { id: connection.id, name: connection.name, host: connection.host, port: connection.port, username: connection.username, dbType: connection.db_type }, workbenchId: `dsh-ssh-${connection.id}`, plugin: { mode: 'ssh' }, locale: params.locale || 'zh-CN' };
        this.publish({ kind: 'event', method: 'dsh/context-changed', params: this.context }); return this.context;
      }
      case 'connections.disconnect': {
        const connection = await this.connection(params.id || params.connectionId);
        return this.sidecar.request('connection/disconnect', { connection }, { signal });
      }
      case 'host.storage.get': return (await this.store.read('ui-storage.json'))[params.key] ?? null;
      case 'host.storage.set':
      case 'host.storage.delete': {
        if (typeof params.key !== 'string' || !params.key || ['__proto__', 'constructor', 'prototype'].includes(params.key)) throw new Error('Invalid storage key.');
        return this.store.update('ui-storage.json', {}, value => {
          if (method.endsWith('.delete')) delete value[params.key];
          else { if (Buffer.byteLength(JSON.stringify(params.value)) > 256 * 1024) throw new Error('Storage value exceeds 256 KiB.'); value[params.key] = params.value; }
          if (Object.keys(value).length > 1024 || Buffer.byteLength(JSON.stringify(value)) > 1024 * 1024) throw new Error('UI storage quota exceeded.');
          return { success: true };
        });
      }
      case 'prompts.resolve': {
        const resolve = this.prompts.get(params.id);
        if (!resolve || !['submit', 'cancel'].includes(params.action)) throw new Error('Prompt expired or response invalid.');
        if (params.value !== undefined && typeof params.value !== 'string') throw new Error('Invalid prompt value.');
        resolve({ action: params.action, ...(params.action === 'submit' ? { value: params.value || '' } : {}) }); return { success: true };
      }
      case 'host.ai.openConversation': {
        if (!this.integrations.ai) throw new Error('Harness AI conversation service is unavailable.');
        return this.integrations.ai(params, signal);
      }
      case 'host.ai.listModels': return this.integrations.listModels ? this.integrations.listModels(signal) : [];
      case 'host.ai.generateText': {
        if (!this.integrations.generateText) throw new Error('Harness text generation service is unavailable.');
        return this.integrations.generateText(params, signal);
      }
      case 'host.ai.setRecommendations': this.publish({ kind: 'event', method: 'dsh/ai-recommendations', params }); return { success: true };
      case 'host.ai.clearRecommendations': this.publish({ kind: 'event', method: 'dsh/ai-recommendations', params: { items: [] } }); return { success: true };
      default: throw new Error(`Unsupported host method: ${method}`);
    }
  }
  async dispatch(endpoint, payload = {}, signal) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('Expected an object payload.');
    switch (endpoint) {
      case 'request': return this.request(payload.method, payload.params || {}, { signal });
      case 'host': return this.host(payload.method, payload.params || {}, signal);
      case 'events': return this.poll(payload, signal);
      case 'binary': {
        if (typeof payload.channel !== 'string' || typeof payload.data !== 'string' || payload.data.length > 2 * 1024 * 1024 || !/^[A-Za-z0-9+/]*={0,2}$/.test(payload.data)) throw new Error('Invalid binary payload.');
        await this.start(); await this.sidecar.sendBinary(payload.channel, Buffer.from(payload.data, 'base64')); return { success: true };
      }
      default: throw new Error('Unknown SSH bridge endpoint.');
    }
  }
  async close() {
    this.closed = true;
    for (const resolve of this.prompts.values()) resolve({ action: 'cancel' });
    this.emit('available'); await this.sidecar?.close();
  }
}
