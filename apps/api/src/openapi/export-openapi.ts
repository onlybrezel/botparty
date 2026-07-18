import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { SwaggerModule } from '@nestjs/swagger';
import { createSwaggerDocumentConfig } from './swagger-config';

function setMetadataOnlyEnvironment() {
  process.env.NODE_ENV ??= 'test';
  process.env.DATABASE_URL ??= 'postgresql://openapi:openapi@127.0.0.1:5432/openapi';
  process.env.REDIS_HOST ??= '127.0.0.1';
  process.env.REDIS_PORT ??= '6379';
  process.env.CORS_ORIGIN ??= 'http://127.0.0.1:3000';
}

async function main() {
  setMetadataOnlyEnvironment();
  // AppModule validates environment variables as it is imported. Keep this
  // import after the metadata-only defaults so schema generation neither
  // depends on a developer .env file nor needs production credentials.
  const { AppModule } = await import('../bootstrap/app.module');
  const outputArg = process.argv[2] ?? 'docs/openapi.json';
  const outputPath = path.resolve(outputArg);
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), {
    abortOnError: false,
    logger: false,
    preview: true,
  });

  try {
    const document = SwaggerModule.createDocument(app, createSwaggerDocumentConfig());
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, JSON.stringify(document, null, 2), 'utf8');
    process.stdout.write(`wrote ${path.relative(process.cwd(), outputPath)}\n`);
  } finally {
    await app.close();
  }
}

void main().catch((error: unknown) => {
  const message = error instanceof Error
    ? error.stack ?? error.message
    : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
