// Use Connection's public exact Fetch routes on the shared /api carrier. The
// host owns browser authentication, Host/Origin checks, body limits and aborts.
// Custom rpc.handle() channels in Harness 0.2.0-rc.2 attempt to access webServer
// from Connection's service context, which has not injected that service.
export function registerHarnessRpc(ctx, service) {
  for (const endpoint of ['request', 'host', 'events', 'binary']) {
    const method = `ssh-plugin/${endpoint}`;
    ctx.connection.fetch.register({
      path: `/api/${method}`, methods: ['POST'], requestBody: 'buffered',
      async fetch(request) {
        if (request.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase() !== 'application/json') return new Response('content type must be application/json', { status: 415 });
        let message;
        try { message = await request.json(); }
        catch { return new Response('body is not JSON', { status: 400 }); }
        if (!message || Array.isArray(message) || message.type !== 'client-request' || typeof message.rpcId !== 'string' || !message.rpcId || message.method !== method || !Object.hasOwn(message, 'payload')) return new Response('invalid RPC envelope', { status: 400 });
        let result;
        try { result = { ok: true, value: await service.dispatch(endpoint, message.payload, request.signal) }; }
        catch (error) { result = { ok: false, error: { code: 'ssh/error', message: error?.message || 'SSH operation failed.', details: {} } }; }
        return Response.json({ type: 'server-response', rpcId: message.rpcId, result });
      },
    });
  }
}
