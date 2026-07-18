import { PrismaReadService } from './prisma-read.service';

describe('PrismaReadService', () => {
  const previousReadUrl = process.env.DATABASE_READ_URL;
  const previousWriteUrl = process.env.DATABASE_WRITE_URL;
  const previousDatabaseUrl = process.env.DATABASE_URL;

  afterEach(() => {
    if (previousReadUrl === undefined) delete process.env.DATABASE_READ_URL;
    else process.env.DATABASE_READ_URL = previousReadUrl;
    if (previousWriteUrl === undefined) delete process.env.DATABASE_WRITE_URL;
    else process.env.DATABASE_WRITE_URL = previousWriteUrl;
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
  });

  it('reuses the primary connection when no distinct replica is configured', () => {
    const primary = { $queryRaw: jest.fn() };
    process.env.DATABASE_URL = 'postgresql://user:pass@primary:5432/db';
    delete process.env.DATABASE_READ_URL;

    const service = new PrismaReadService(primary as never);

    expect(service.client).toBe(primary);
    expect(service.isReplicaConfigured).toBe(false);
  });

  it('creates a dedicated client only for a distinct read URL', () => {
    const primary = { $queryRaw: jest.fn() };
    process.env.DATABASE_WRITE_URL = 'postgresql://user:pass@primary:5432/db';
    process.env.DATABASE_READ_URL = 'postgresql://user:pass@replica:5432/db';

    const service = new PrismaReadService(primary as never);

    expect(service.client).not.toBe(primary);
    expect(service.isReplicaConfigured).toBe(true);
  });
});
