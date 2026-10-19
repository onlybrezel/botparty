import Fastify from 'fastify';
import { request as httpRequest } from 'node:http';
import {
  installConcurrentRequestLimit,
  parseMaxConcurrentLoginRequests,
  parseMaxConcurrentRequests,
} from './concurrent-request-limit';

describe('concurrent request limit', () => {
  it('validates the configured concurrency', () => {
    expect(parseMaxConcurrentRequests(undefined)).toBe(64);
    expect(parseMaxConcurrentRequests('32')).toBe(32);
    expect(parseMaxConcurrentLoginRequests(undefined)).toBe(2);
    expect(parseMaxConcurrentLoginRequests('8')).toBe(8);
    expect(() => parseMaxConcurrentRequests('0')).toThrow('MAX_CONCURRENT_REQUESTS');
    expect(() => parseMaxConcurrentRequests('1.5')).toThrow('MAX_CONCURRENT_REQUESTS');
    expect(() => parseMaxConcurrentLoginRequests('101')).toThrow('MAX_CONCURRENT_LOGIN_REQUESTS');
  });

  it('rejects excess work and accepts new work after the active request completes', async () => {
    const server = Fastify();
    installConcurrentRequestLimit(server, { all: 1, login: 1 });

    let completeFirstRequest: (() => void) | undefined;
    const firstRequestBlocked = new Promise<void>((resolve) => {
      completeFirstRequest = resolve;
    });
    server.get('/api/work', async () => {
      await firstRequestBlocked;
      return { ok: true };
    });

    const firstRequest = server.inject({ method: 'GET', url: '/api/work' });
    await new Promise<void>((resolve) => setImmediate(resolve));

    const rejected = await server.inject({ method: 'GET', url: '/api/work' });
    expect(rejected.statusCode).toBe(503);
    expect(rejected.headers['retry-after']).toBe('1');
    expect(rejected.json()).toEqual({
      statusCode: 503,
      message: 'Service temporarily unavailable',
    });

    completeFirstRequest?.();
    expect((await firstRequest).statusCode).toBe(200);
    expect((await server.inject({ method: 'GET', url: '/api/work' })).statusCode).toBe(200);
    await server.close();
  });

  it('keeps health endpoints available while normal requests are saturated', async () => {
    const server = Fastify();
    installConcurrentRequestLimit(server, { all: 1, login: 1 });

    let completeWork: (() => void) | undefined;
    const workBlocked = new Promise<void>((resolve) => {
      completeWork = resolve;
    });
    server.get('/api/work', async () => workBlocked);
    server.get('/api/v1/health/ready', async () => ({ status: 'ready' }));

    const work = server.inject({ method: 'GET', url: '/api/work' });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect((await server.inject('/api/v1/health/ready')).statusCode).toBe(200);

    completeWork?.();
    await work;
    await server.close();
  });

  it('isolates expensive login work from the general request allowance', async () => {
    const server = Fastify();
    installConcurrentRequestLimit(server, { all: 4, login: 1 });

    let completeLogin: (() => void) | undefined;
    const loginBlocked = new Promise<void>((resolve) => {
      completeLogin = resolve;
    });
    server.post('/api/v1/auth/login', async () => loginBlocked);
    server.get('/api/work', async () => ({ ok: true }));

    const login = server.inject({ method: 'POST', url: '/api/v1/auth/login' });
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect((await server.inject({ method: 'POST', url: '/api/v1/auth/login' })).statusCode).toBe(
      503,
    );
    expect((await server.inject('/api/work')).statusCode).toBe(200);

    completeLogin?.();
    await login;
    await server.close();
  });

  it('retains capacity for active work after its client disconnects', async () => {
    const server = Fastify();
    installConcurrentRequestLimit(server, { all: 2, login: 1 });

    let startFirstRequest: (() => void) | undefined;
    const firstRequestStarted = new Promise<void>((resolve) => {
      startFirstRequest = resolve;
    });
    let completeFirstRequest: (() => void) | undefined;
    const firstRequestBlocked = new Promise<void>((resolve) => {
      completeFirstRequest = resolve;
    });
    let loginCalls = 0;
    let markFirstWorkComplete: (() => void) | undefined;
    const firstWorkComplete = new Promise<void>((resolve) => {
      markFirstWorkComplete = resolve;
    });
    let markServerDisconnected: (() => void) | undefined;
    const serverDisconnected = new Promise<void>((resolve) => {
      markServerDisconnected = resolve;
    });
    server.post('/api/v1/auth/login', async () => {
      loginCalls += 1;
      if (loginCalls === 1) {
        startFirstRequest?.();
        await firstRequestBlocked;
        markFirstWorkComplete?.();
      }
      return { ok: true };
    });

    server.addHook('onRequest', async (_request, reply) => {
      reply.raw.once('close', () => markServerDisconnected?.());
    });

    await server.listen({ host: '127.0.0.1', port: 0 });
    const address = server.server.address();
    if (!address || typeof address === 'string') throw new Error('Test server address unavailable');

    const abandonedRequest = httpRequest({
      host: '127.0.0.1',
      port: address.port,
      method: 'POST',
      path: '/api/v1/auth/login',
    });
    abandonedRequest.on('error', () => undefined);
    abandonedRequest.end();
    await firstRequestStarted;
    const clientClosed = new Promise<void>((resolve) => {
      abandonedRequest.once('close', resolve);
    });
    abandonedRequest.destroy();
    await clientClosed;
    // The client's close event can precede the server's abort handling.
    await serverDisconnected;

    try {
      expect((await server.inject({ method: 'POST', url: '/api/v1/auth/login' })).statusCode).toBe(
        503,
      );

      completeFirstRequest?.();
      await firstWorkComplete;
      let acceptedStatus = 503;
      for (let attempt = 0; attempt < 100 && acceptedStatus === 503; attempt += 1) {
        acceptedStatus = (await server.inject({ method: 'POST', url: '/api/v1/auth/login' }))
          .statusCode;
        if (acceptedStatus === 503) await new Promise<void>((resolve) => setImmediate(resolve));
      }
      expect(acceptedStatus).toBe(200);
    } finally {
      completeFirstRequest?.();
      server.server.closeAllConnections();
      await server.close();
    }
  });
});
