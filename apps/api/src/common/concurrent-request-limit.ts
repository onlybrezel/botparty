import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { Counter, Gauge, register } from 'prom-client';

const activeRequests =
  (register.getSingleMetric('botparty_http_active_requests') as Gauge | undefined) ??
  new Gauge({
    name: 'botparty_http_active_requests',
    help: 'API requests currently admitted by this instance',
  });

const overloadRejections =
  (register.getSingleMetric('botparty_http_overload_rejections_total') as
    | Counter<'reason'>
    | undefined) ??
  new Counter({
    name: 'botparty_http_overload_rejections_total',
    help: 'Requests rejected by the per-instance concurrency limit',
    labelNames: ['reason'] as const,
  });

const ALWAYS_AVAILABLE_PATHS = new Set([
  '/api/v1/health/live',
  '/api/v1/health/ready',
  '/api/v1/health/metrics',
]);

export function parseMaxConcurrentRequests(rawValue: string | undefined): number {
  const value = Number(rawValue ?? 64);
  if (!Number.isInteger(value) || value < 1 || value > 10_000) {
    throw new Error('MAX_CONCURRENT_REQUESTS must be an integer from 1 to 10000');
  }
  return value;
}

export function parseMaxConcurrentLoginRequests(rawValue: string | undefined): number {
  const value = Number(rawValue ?? 2);
  if (!Number.isInteger(value) || value < 1 || value > 100) {
    throw new Error('MAX_CONCURRENT_LOGIN_REQUESTS must be an integer from 1 to 100');
  }
  return value;
}

type ConcurrentRequestLimits = {
  all: number;
  login: number;
};

export function installConcurrentRequestLimit(
  server: FastifyInstance,
  limits: ConcurrentRequestLimits,
): void {
  const admittedRequests = new WeakMap<FastifyRequest, boolean>();
  let admittedCount = 0;
  let admittedLoginCount = 0;

  const release = (request: FastifyRequest) => {
    if (!admittedRequests.has(request)) return;
    const isLogin = admittedRequests.get(request) === true;
    admittedRequests.delete(request);
    admittedCount -= 1;
    if (isLogin) admittedLoginCount -= 1;
    activeRequests.dec();
  };

  const reject = (reply: FastifyReply, reason: 'all' | 'login') => {
    overloadRejections.inc({ reason });
    reply.header('retry-after', '1');
    return reply.code(503).send({
      statusCode: 503,
      message: 'Service temporarily unavailable',
    });
  };

  server.addHook('onRequest', async (request, reply) => {
    const path = request.raw.url?.split('?', 1)[0] ?? '/';
    if (!path.startsWith('/api/') || ALWAYS_AVAILABLE_PATHS.has(path)) return;
    const isLogin = path === '/api/v1/auth/login';

    if (isLogin && admittedLoginCount >= limits.login) return reject(reply, 'login');
    if (admittedCount >= limits.all) return reject(reply, 'all');

    admittedRequests.set(request, isLogin);
    admittedCount += 1;
    if (isLogin) admittedLoginCount += 1;
    activeRequests.inc();
  });

  server.addHook('onSend', async (request, reply) => {
    if (request.raw.destroyed || reply.raw.destroyed) release(request);
  });
  server.addHook('onResponse', async (request) => release(request));
  server.addHook('onRequestAbort', async (request) => release(request));
}
