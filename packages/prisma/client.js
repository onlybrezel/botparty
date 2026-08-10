const { PrismaPg } = require('@prisma/adapter-pg');
const { PrismaClient } = require('./generated/client');

function resolveConnectionString(connectionString) {
  const value = connectionString ?? process.env.DATABASE_WRITE_URL ?? process.env.DATABASE_URL;
  if (!value) {
    throw new Error('DATABASE_URL or DATABASE_WRITE_URL is required to connect to PostgreSQL');
  }
  return value;
}

function createPrismaAdapter(connectionString) {
  return new PrismaPg({ connectionString: resolveConnectionString(connectionString) });
}

function createPrismaClient(connectionString) {
  return new PrismaClient({ adapter: createPrismaAdapter(connectionString) });
}

module.exports = { createPrismaAdapter, createPrismaClient };
