const value = process.env.DATABASE_URL;
if (!value) {
  throw new Error('DATABASE_URL is required');
}

const url = new URL(value);
for (const name of ['schema', 'connection_limit', 'pool_timeout']) {
  url.searchParams.delete(name);
}
process.stdout.write(url.toString());
