import type { PrismaClient } from './generated/client/index.js';

export declare function createPrismaAdapter(connectionString?: string): unknown;
export declare function createPrismaClient(connectionString?: string): PrismaClient;
