import Fastify, { type FastifyInstance } from 'fastify';
import { installCspReportContentParser } from './csp-report-content-parser';

describe('browser CSP report content parser', () => {
  let server: FastifyInstance;
  const handleReport = jest.fn();

  beforeEach(() => {
    server = Fastify();
    handleReport.mockReset();
    installCspReportContentParser(server);
    server.post('/api/v1/health/csp-report', { bodyLimit: 16_384 }, (request, reply) => {
      handleReport(request.body);
      return reply.code(204).send();
    });
  });

  afterEach(async () => {
    await server.close();
  });

  it.each(['application/csp-report', 'application/csp-report; charset=UTF-8'])(
    'accepts the browser report MIME type %s',
    async (contentType) => {
      const report = { 'csp-report': { 'violated-directive': 'script-src-elem' } };
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/health/csp-report',
        headers: { 'content-type': contentType },
        payload: JSON.stringify(report),
      });
      expect(response.statusCode).toBe(204);
      expect(handleReport).toHaveBeenCalledWith(report);
    },
  );

  it('retains the route body limit for browser reports', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/api/v1/health/csp-report',
      headers: { 'content-type': 'application/csp-report' },
      payload: JSON.stringify({ 'csp-report': { sample: 'a'.repeat(16_384) } }),
    });
    expect(response.statusCode).toBe(413);
    expect(handleReport).not.toHaveBeenCalled();
  });

  it.each(['{"csp-report":', '{"__proto__":{"polluted":true}}'])(
    'rejects malformed or prototype-poisoning JSON: %s',
    async (payload) => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/health/csp-report',
        headers: { 'content-type': 'application/csp-report' },
        payload,
      });
      expect(response.statusCode).toBe(400);
      expect(handleReport).not.toHaveBeenCalled();
    },
  );
});
