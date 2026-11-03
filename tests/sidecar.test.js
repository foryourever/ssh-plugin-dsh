import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { Sidecar } from '../src/sidecar.js';
const fixture = fileURLToPath(new URL('./fixtures/mock-sidecar.cjs', import.meta.url));
function peer(t, options = {}) {
  const sidecar = new Sidecar({ command: process.execPath, args: [fixture], dataDir: '/tmp/mock-sidecar-data', ...options });
  t.after(() => sidecar.close());
  return sidecar;
}

test('initializes upstream host API and env; concurrent requests correlate', async t => {
  const sidecar = peer(t, { env: { DBX_PLUGIN_DATA_DIR: '/wrong' } });
  const [first, second] = await Promise.all([sidecar.start(), sidecar.start()]);
  assert.equal(first, second);
  assert.deepEqual(first.host, { protocolVersions: [1], hostApiVersion: '1.1.0', features: ['host.requestUserInput'] });
  assert.equal(first.dataDir, '/tmp/mock-sidecar-data');
  const results = await Promise.all([sidecar.request('echo', { n: 1, delay: 30 }), sidecar.request('echo', { n: 2 })]);
  assert.equal(results[0].n, 1); assert.equal(results[1].n, 2);
});

test('fragmented frames and multiple frames produce events and response', async t => {
  const sidecar = peer(t); await sidecar.start();
  const events = []; sidecar.on('event', event => events.push(event));
  assert.equal(await sidecar.request('fragment'), 'done');
  assert.deepEqual(events, [{ method: 'progress', params: { n: 1 } }]);
});

test('binary frames round trip typed-array views and UTF-8 channels', async t => {
  const sidecar = peer(t); await sidecar.start();
  const binary = once(sidecar, 'binary');
  await sidecar.sendBinary('terminal/测试', Uint8Array.from([0, 1, 255, 2]).subarray(1, 3));
  const [event] = await binary;
  assert.equal(event.channel, 'terminal/测试'); assert.ok(Buffer.isBuffer(event.data)); assert.deepEqual([...event.data], [1, 255]);
});

test('reverse input request returns exact upstream answer', async t => {
  let called = false;
  const sidecar = peer(t, { onHostRequest: async (method, params, { signal }) => {
    called = true; assert.equal(method, 'host/requestUserInput'); assert.equal(params.echo, false); assert.equal(signal.aborted, false);
    return { action: 'submit', value: 'mock-code' };
  } });
  await sidecar.start();
  assert.deepEqual(await sidecar.request('reverse'), { action: 'submit', value: 'mock-code' }); assert.ok(called);
});

test('reverse unavailable/callback errors become RPC errors without breaking child', async t => {
  const sidecar = peer(t); await sidecar.start();
  await assert.rejects(sidecar.request('reverse'), { code: -32601 });
  await assert.rejects(sidecar.request('reverse', { method: 'host/unknown' }), { code: -32601 });
  assert.deepEqual(await sidecar.request('echo', { ok: true }), { ok: true });
});

for (const kind of ['json', 'utf8', 'binary', 'type', 'rpc', 'oversized', 'truncated']) {
  test(`malformed ${kind} frame stops child and cleans up without error listener`, async t => {
    const sidecar = peer(t); await sidecar.start();
    let exited = false; sidecar.on('exit', () => { exited = true; });
    await assert.rejects(sidecar.request('bad', { kind }));
    assert.equal(exited, true); assert.equal(sidecar._session, null);
  });
}

test('process exit rejects every pending request', async t => {
  const sidecar = peer(t); await sidecar.start();
  const pending = sidecar.request('wait');
  const exiting = sidecar.request('exit');
  const results = await Promise.allSettled([pending, exiting]);
  assert.ok(results.every(result => result.status === 'rejected' && result.reason.code === 'SIDECAR_EXIT'));
});

test('cancellation kills whole stubborn child, waits for exit, then can restart', async t => {
  const sidecar = peer(t); await sidecar.start();
  const controller = new AbortController();
  const waiting = once(sidecar, 'event');
  const pending = sidecar.request('stubborn', {}, { signal: controller.signal });
  await waiting;
  const other = sidecar.request('wait');
  let exited = false; sidecar.on('exit', () => { exited = true; });
  controller.abort();
  const results = await Promise.allSettled([pending, other]);
  assert.ok(exited); assert.ok(results.every(result => result.status === 'rejected' && result.reason.code === 'ABORT_ERR'));
  await sidecar.start(); assert.deepEqual(await sidecar.request('echo', { restarted: true }), { restarted: true });
});

test('timeout terminates child and pre-abort does not send request', async t => {
  const sidecar = peer(t); await sidecar.start();
  const controller = new AbortController(); controller.abort();
  await assert.rejects(sidecar.request('wait', {}, { signal: controller.signal }), { name: 'AbortError' });
  assert.deepEqual(await sidecar.request('echo'), {});
  await assert.rejects(sidecar.request('wait', {}, { timeoutMs: 20 }), { code: 'ETIMEDOUT' });
  assert.equal(sidecar._session, null);
});

test('close uses supported shutdown, reaps child, and is idempotent', async t => {
  const sidecar = peer(t, { env: { MOCK_SHUTDOWN: '1' } }); await sidecar.start();
  const events = []; sidecar.on('event', event => events.push(event.method));
  await Promise.all([sidecar.close(), sidecar.close()]);
  assert.ok(events.includes('shutdown')); assert.equal(sidecar._session, null);
  await sidecar.close();
});

test('close interrupts initialization promptly', async t => {
  const sidecar = peer(t, { env: { MOCK_HANG_INIT: '1' } });
  const starting = assert.rejects(sidecar.start(), { code: 'SIDECAR_CLOSED' });
  await sidecar.close(); await starting;
  assert.equal(sidecar._session, null);
});

test('close aborts pending host callback and rejects in-flight calls after exit', async t => {
  let notify;
  const entered = new Promise(resolve => { notify = resolve; });
  let hostSignal;
  const sidecar = peer(t, { onHostRequest: (_method, _params, { signal }) => {
    hostSignal = signal; notify();
    return new Promise(resolve => signal.addEventListener('abort', () => resolve({ action: 'cancel' }), { once: true }));
  } });
  await sidecar.start();
  const pending = assert.rejects(sidecar.request('reverse'));
  await entered;
  await sidecar.close(); await pending;
  assert.equal(hostSignal.aborted, true);
  await assert.rejects(sidecar.request('echo'), /not running/);
});

test('spawn failure rejects start and safely emits error only with listener', async t => {
  const sidecar = peer(t, { command: '/nonexistent/mock-sidecar-command' });
  await assert.rejects(sidecar.start(), { code: 'ENOENT' });
  assert.equal(sidecar._session, null);
});
