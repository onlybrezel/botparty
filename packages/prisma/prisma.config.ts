import 'dotenv/config';
import { defineConfig } from 'prisma/config';

const databaseUrl =
  process.env.DATABASE_URL ??
  process.env.DATABASE_WRITE_URL ??
  'postgresql://localhost:5432/botparty';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx seed.ts',
  },
  datasource: {
    url: databaseUrl,
  },
});
