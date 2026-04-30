import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { SwaggerModule } from '@nestjs/swagger';
import { AppModule } from '../bootstrap/app.module';
import { createSwaggerDocumentConfig } from './swagger-config';

async function main() {
  const outputArg = process.argv[2] ?? 'docs/openapi.json';
  const outputPath = path.resolve(outputArg);
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), {
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
