#!/usr/bin/env node

import path from 'node:path';
import { generate } from 'openapi-typescript-codegen';

const DEFAULT_INPUT = 'http://localhost:4000/docs-json';
const DEFAULT_OUTPUT = 'apps/web/src/lib/generated/openapi-client';

function parseArgs(argv) {
  const args = {
    input: DEFAULT_INPUT,
    output: DEFAULT_OUTPUT,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if ((value === '--input' || value === '-i') && argv[index + 1]) {
      args.input = argv[index + 1];
      index += 1;
      continue;
    }
    if ((value === '--output' || value === '-o') && argv[index + 1]) {
      args.output = argv[index + 1];
      index += 1;
      continue;
    }
    if (value === '--help' || value === '-h') {
      console.log(`Generate a TypeScript fetch client from an OpenAPI document.

Usage:
  node scripts/generate-ts-api-client.mjs [--input <file-or-url>] [--output <directory>]

Defaults:
  --input  ${DEFAULT_INPUT}
  --output ${DEFAULT_OUTPUT}`);
      process.exit(0);
    }
  }

  return args;
}

async function main() {
  const { input, output } = parseArgs(process.argv.slice(2));
  const outputPath = path.resolve(output);

  await generate({
    input,
    output: outputPath,
    httpClient: 'fetch',
    useOptions: true,
    useUnionTypes: true,
    exportCore: true,
    exportServices: true,
    exportModels: true,
    exportSchemas: false,
  });

  console.log(`wrote ${path.relative(process.cwd(), outputPath)}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});