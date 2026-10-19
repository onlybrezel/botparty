import type { FastifyInstance } from 'fastify';

export function installCspReportContentParser(server: FastifyInstance): void {
  server.addContentTypeParser(
    'application/csp-report',
    { parseAs: 'string' },
    server.getDefaultJsonParser('error', 'error'),
  );
}
