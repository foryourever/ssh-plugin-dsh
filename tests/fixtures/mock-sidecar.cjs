// Credential-free protocol peer used only by sidecar transport tests.
function frame(kind, payload) {
  const header = Buffer.alloc(5); header[0] = kind; header.writeUInt32BE(payload.length, 1);
  return Buffer.concat([header, payload]);
}
const json = value => frame(0, Buffer.from(JSON.stringify({ jsonrpc: '2.0', ...value })));
let buffer = Buffer.alloc(0);
const reverse = new Map();
process.stdin.on('data', chunk => {
  buffer = Buffer.concat([buffer, chunk]);
  while (buffer.length >= 5 && buffer.length >= 5 + buffer.readUInt32BE(1)) {
    const kind = buffer[0], length = buffer.readUInt32BE(1);
    const payload = buffer.subarray(5, 5 + length); buffer = buffer.subarray(5 + length);
    if (kind === 1) { process.stdout.write(frame(1, payload)); continue; }
    const message = JSON.parse(payload);
    if (!message.method) {
      const id = reverse.get(message.id); reverse.delete(message.id);
      process.stdout.write(json({ id, ...(message.error ? { error: message.error } : { result: message.result }) })); continue;
    }
    const { id, method, params } = message;
    if (method === 'plugin/initialize') {
      if (process.env.MOCK_HANG_INIT) continue;
      process.stdout.write(json({ id, result: { protocolVersion: 1, capabilities: process.env.MOCK_SHUTDOWN ? ['plugin/shutdown'] : [], host: params.host, dataDir: process.env.DBX_PLUGIN_DATA_DIR } }));
    } else if (method === 'echo') setTimeout(() => process.stdout.write(json({ id, result: params })), params.delay || 0);
    else if (method === 'fragment') {
      const bytes = Buffer.concat([json({ method: 'progress', params: { n: 1 } }), json({ id, result: 'done' })]);
      let offset = 0;
      const send = () => { if (offset < bytes.length) { process.stdout.write(bytes.subarray(offset, ++offset)); setImmediate(send); } };
      send();
    } else if (method === 'reverse') {
      reverse.set(`plugin-${id}`, id);
      process.stdout.write(json({ id: `plugin-${id}`, method: params.method || 'host/requestUserInput', params: { prompt: 'Mock question', echo: false } }));
    } else if (method === 'bad') {
      if (params.kind === 'json') process.stdout.write(frame(0, Buffer.from('{broken')));
      else if (params.kind === 'utf8') process.stdout.write(frame(0, Buffer.from([255])));
      else if (params.kind === 'binary') process.stdout.write(frame(1, Buffer.from([0, 8, 65])));
      else if (params.kind === 'type') process.stdout.write(frame(9, Buffer.alloc(0)));
      else if (params.kind === 'rpc') process.stdout.write(json({ id }));
      else if (params.kind === 'truncated') { process.stdout.write(Buffer.from([0, 0, 0])); process.exitCode = 0; process.stdin.destroy(); process.stdout.end(); }
      else { const header = Buffer.alloc(5); header.writeUInt32BE(8 * 1024 * 1024 + 1, 1); process.stdout.write(header); }
    } else if (method === 'exit') process.exit(23);
    else if (method === 'wait') process.stdout.write(json({ method: 'waiting', params: {} }));
    else if (method === 'stubborn') {
      process.on('SIGTERM', () => {});
      process.stdout.write(json({ method: 'waiting', params: {} }));
    } else if (method === 'plugin/shutdown') {
      process.stdout.write(Buffer.concat([json({ method: 'shutdown', params: {} }), json({ id, result: null })]));
    }
  }
});
process.stdin.on('end', () => process.exit(0));
