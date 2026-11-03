import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import { TextDecoder } from 'node:util';

const MAX_JSON = 8 * 1024 * 1024;
const MAX_BINARY = 64 * 1024 * 1024;
const utf8 = new TextDecoder('utf-8', { fatal: true });
const has = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
function name(value) {
  if (typeof value !== 'string' || !value || Buffer.byteLength(value) > 256 || /\s/u.test(value)) throw new TypeError('Invalid protocol name');
}
function failure(message, code = 'SIDECAR_ERROR') { return Object.assign(new Error(message), { code }); }
function frame(kind, payload) {
  const header = Buffer.alloc(5);
  header[0] = kind;
  header.writeUInt32BE(payload.length, 1);
  return Buffer.concat([header, payload]);
}

/** Framed DBX SDK transport. Cancellation/timeouts kill the entire child because
 * the upstream SDK has no per-request cancellation. Requests settle after child
 * close; start() can initialize a new backend. Remote operations already accepted
 * cannot be rolled back. onHostRequest(method, params, {signal}) returns
 * {action:'submit',value:string}, {action:'cancel'}, or {action:'timeout'}.
 */
export class Sidecar extends EventEmitter {
  constructor({ command, args = [], dataDir, env = {}, requestTimeoutMs = 120000, onHostRequest }) {
    super();
    if (typeof command !== 'string' || !command) throw new TypeError('command is required');
    if (typeof dataDir !== 'string' || !dataDir.trim()) throw new TypeError('dataDir is required');
    this.options = { command, args, dataDir, env, requestTimeoutMs, onHostRequest };
    this._validateTimeout(requestTimeoutMs);
    this._session = null;
    this.initialization = null;
  }
  _validateTimeout(ms) {
    if (!Number.isFinite(ms) || ms < 0 || ms > 2147483647) throw new TypeError('Invalid timeoutMs');
  }
  async start() {
    if (this._session) {
      if (this._session.stopping || this._session.closing) throw failure('Sidecar is stopping');
      return this._session.ready;
    }
    const { command, args, env, dataDir } = this.options;
    const child = spawn(command, args, { shell: false, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, ...env, DBX_PLUGIN_DATA_DIR: dataDir } });
    const s = { child, pending: new Map(), nextId: 1, stopping: false, reason: null, header: Buffer.alloc(5), headerUsed: 0, payload: null, used: 0, hostController: new AbortController(), timers: new Set() };
    this._session = s;
    s.closed = new Promise(resolve => { s.resolveClosed = resolve; });
    // Drain diagnostics without retaining potentially sensitive stderr.
    child.stderr.resume();
    child.stdout.on('data', chunk => {
      if (s.stopping) return;
      try { this._decode(s, chunk); } catch (error) { this._stop(s, error); }
    });
    child.stdout.on('end', () => {
      if (!s.stopping && (s.headerUsed || s.payload)) this._stop(s, failure('Truncated sidecar frame', 'PROTOCOL_ERROR'));
    });
    child.on('error', error => this._stop(s, error));
    child.stdin.on('error', error => this._stop(s, error));
    child.stdout.on('error', error => this._stop(s, error));
    child.stderr.on('error', error => this._stop(s, error));
    child.on('close', (code, signal) => {
      s.stopping = true;
      s.hostController.abort();
      for (const timer of s.timers) clearTimeout(timer);
      s.timers.clear();
      const error = s.reason || failure(`Sidecar exited (${signal || code})`, 'SIDECAR_EXIT');
      for (const pending of s.pending.values()) pending.finish(error);
      s.pending.clear();
      s.payload = null;
      if (this._session === s) { this._session = null; this.initialization = null; }
      s.resolveClosed();
      this.emit('exit', { code, signal });
    });
    s.ready = (async () => {
      try {
        const result = await this._request(s, 'plugin/initialize', { host: { protocolVersions: [1], hostApiVersion: '1.1.0', features: ['host.requestUserInput'] } });
        if (!result || result.protocolVersion !== 1) throw failure('Unsupported sidecar protocol version', 'PROTOCOL_ERROR');
        if (s.stopping) throw s.reason || failure('Sidecar is stopping');
        this.initialization = result;
        return result;
      } catch (error) {
        this._stop(s, error);
        await s.closed;
        throw error;
      }
    })();
    return s.ready;
  }
  async request(method, params = {}, { signal, timeoutMs } = {}) {
    name(method);
    if (signal?.aborted) throw this._abortError(signal);
    const s = this._session;
    if (!s || s.stopping || s.closing) throw failure('Sidecar is not running');
    await s.ready;
    if (s.closing) throw failure('Sidecar is closing');
    return this._request(s, method, params, { signal, timeoutMs });
  }
  _abortError(signal) { return Object.assign(failure('Sidecar request aborted', 'ABORT_ERR'), { name: 'AbortError', cause: signal.reason }); }
  _request(s, method, params, { signal, timeoutMs = this.options.requestTimeoutMs } = {}) {
    this._validateTimeout(timeoutMs);
    if (s.stopping) return Promise.reject(s.reason || failure('Sidecar is stopping'));
    if (signal?.aborted) return Promise.reject(this._abortError(signal));
    const id = s.nextId++;
    let payload;
    try { payload = this._json({ jsonrpc: '2.0', id, method, params }); } catch (error) { return Promise.reject(error); }
    return new Promise((resolve, reject) => {
      let timer;
      const abort = () => this._stop(s, this._abortError(signal));
      const pending = { finish: (error, result) => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
        s.pending.delete(id);
        if (error) reject(error); else resolve(result);
      } };
      s.pending.set(id, pending);
      signal?.addEventListener('abort', abort, { once: true });
      if (timeoutMs > 0) timer = setTimeout(() => this._stop(s, failure(`Sidecar request timed out: ${method}`, 'ETIMEDOUT')), timeoutMs);
      this._write(s, frame(0, payload)).catch(error => this._stop(s, error));
    });
  }
  _json(value) {
    const payload = Buffer.from(JSON.stringify(value));
    if (payload.length > MAX_JSON) throw failure('JSON message is too large', 'PROTOCOL_ERROR');
    return payload;
  }
  _write(s, bytes) {
    return new Promise((resolve, reject) => {
      if (s.stopping) return reject(s.reason || failure('Sidecar is stopping'));
      s.child.stdin.write(bytes, error => error ? reject(error) : resolve());
    });
  }
  async sendBinary(channel, data) {
    name(channel);
    if (!(data instanceof Uint8Array)) throw new TypeError('Binary data must be Uint8Array');
    if (data.byteLength > MAX_BINARY) throw failure('Binary message is too large', 'PROTOCOL_ERROR');
    const s = this._session;
    if (!s || s.stopping || s.closing) throw failure('Sidecar is not running');
    await s.ready;
    if (s.closing) throw failure('Sidecar is closing');
    const channelBytes = Buffer.from(channel);
    const payload = Buffer.alloc(2 + channelBytes.length + data.byteLength);
    payload.writeUInt16BE(channelBytes.length);
    channelBytes.copy(payload, 2);
    payload.set(data, 2 + channelBytes.length);
    try { await this._write(s, frame(1, payload)); }
    catch (error) { this._stop(s, error); await s.closed; throw error; }
  }
  _decode(s, chunk) {
    let offset = 0;
    while (offset < chunk.length && !s.stopping) {
      if (!s.payload) {
        const count = Math.min(5 - s.headerUsed, chunk.length - offset);
        chunk.copy(s.header, s.headerUsed, offset, offset + count);
        s.headerUsed += count; offset += count;
        if (s.headerUsed < 5) continue;
        const kind = s.header[0], length = s.header.readUInt32BE(1);
        if (kind !== 0 && kind !== 1) throw failure('Unknown frame type', 'PROTOCOL_ERROR');
        if (length > (kind === 0 ? MAX_JSON : MAX_BINARY + 1024)) throw failure('Sidecar frame is too large', 'PROTOCOL_ERROR');
        s.payload = Buffer.alloc(length); s.used = 0;
      }
      const count = Math.min(s.payload.length - s.used, chunk.length - offset);
      chunk.copy(s.payload, s.used, offset, offset + count);
      s.used += count; offset += count;
      if (s.used !== s.payload.length) continue;
      const payload = s.payload, kind = s.header[0];
      s.payload = null; s.headerUsed = 0;
      if (kind === 0) this._message(s, JSON.parse(utf8.decode(payload)));
      else {
        if (payload.length < 2) throw failure('Invalid binary frame', 'PROTOCOL_ERROR');
        const size = payload.readUInt16BE(0);
        if (!size || payload.length < 2 + size || payload.length - 2 - size > MAX_BINARY) throw failure('Invalid binary channel or size', 'PROTOCOL_ERROR');
        const channel = utf8.decode(payload.subarray(2, 2 + size));
        name(channel);
        this.emit('binary', { channel, data: payload.subarray(2 + size) });
      }
    }
  }
  _message(s, message) {
    if (!message || Array.isArray(message) || message.jsonrpc !== '2.0') throw failure('Invalid JSON-RPC message', 'PROTOCOL_ERROR');
    if (has(message, 'method')) {
      name(message.method);
      if (!has(message, 'id')) this.emit('event', { method: message.method, params: message.params ?? {} });
      else {
        if (typeof message.id !== 'string' || !message.id) throw failure('Invalid reverse request id', 'PROTOCOL_ERROR');
        void this._hostRequest(s, message);
      }
      return;
    }
    if (!Number.isSafeInteger(message.id) || has(message, 'result') === has(message, 'error')) throw failure('Invalid JSON-RPC response', 'PROTOCOL_ERROR');
    const pending = s.pending.get(message.id);
    if (!pending) return;
    if (has(message, 'error')) {
      if (!message.error || typeof message.error.message !== 'string' || !Number.isInteger(message.error.code)) throw failure('Invalid JSON-RPC error', 'PROTOCOL_ERROR');
      pending.finish(Object.assign(new Error(message.error.message), message.error));
    } else pending.finish(null, message.result);
  }
  async _hostRequest(s, message) {
    let reply;
    try {
      if (message.method !== 'host/requestUserInput' || !this.options.onHostRequest) throw failure('Host method is unavailable', -32601);
      const answer = await this.options.onHostRequest(message.method, message.params ?? {}, { signal: s.hostController.signal });
      if (!answer || !['submit', 'cancel', 'timeout'].includes(answer.action) || (answer.action === 'submit' && typeof answer.value !== 'string')) throw failure('Invalid user input answer', -32602);
      reply = { result: answer };
    } catch (error) {
      reply = { error: { code: Number.isInteger(error?.code) ? error.code : -32603, message: error?.message || 'Host request failed' } };
    }
    if (s.stopping || s.closing) return;
    try { await this._write(s, frame(0, this._json({ jsonrpc: '2.0', id: message.id, ...reply }))); } catch (error) { this._stop(s, error); }
  }
  _stop(s, error) {
    if (s.stopping) return;
    s.stopping = true;
    s.reason = error;
    s.hostController.abort();
    s.child.kill('SIGTERM');
    const timer = setTimeout(() => s.child.kill('SIGKILL'), 500);
    s.timers.add(timer);
    if (this.listenerCount('error')) this.emit('error', error);
  }
  async close() {
    const s = this._session;
    if (!s) return;
    if (s.closing) return s.closing;
    s.hostController.abort();
    if (!this.initialization && !s.stopping) this._stop(s, failure('Sidecar closed during initialization', 'SIDECAR_CLOSED'));
    s.closing = (async () => {
      if (!s.stopping) {
        try {
          await s.ready;
          if (this.initialization?.capabilities?.includes('plugin/shutdown')) await this._request(s, 'plugin/shutdown', {}, { timeoutMs: 1000 });
        } catch { /* Transport failure already tears down. */ }
        if (!s.stopping) {
          s.child.stdin.end();
          const timer = setTimeout(() => this._stop(s, failure('Sidecar closed', 'SIDECAR_CLOSED')), 1000);
          s.timers.add(timer);
        }
      }
      await s.closed;
    })();
    return s.closing;
  }
}
