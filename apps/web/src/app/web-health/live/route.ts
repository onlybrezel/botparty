import { createHash } from 'node:crypto';
import { hostname } from 'node:os';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET() {
  const instanceId = createHash('sha256').update(hostname()).digest('hex').slice(0, 16);
  return Response.json(
    { status: 'ok', timestamp: new Date().toISOString() },
    { headers: { 'x-web-instance-id': instanceId, 'cache-control': 'no-store' } },
  );
}
