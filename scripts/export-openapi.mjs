#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_INPUT = process.env.OPENAPI_SOURCE_URL ?? 'http://localhost:4000/docs-json';
const DEFAULT_OUTPUT = 'artifacts/openapi/openapi.json';

function parseArgs(argv) {
  const args = {
    input: DEFAULT_INPUT,
    output: DEFAULT_OUTPUT,
    username: process.env.SWAGGER_DOCS_USERNAME ?? '',
    password: process.env.SWAGGER_DOCS_PASSWORD ?? '',
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
    if ((value === '--username' || value === '-u') && argv[index + 1]) {
      args.username = argv[index + 1];
      index += 1;
      continue;
    }
    if ((value === '--password' || value === '-p') && argv[index + 1]) {
      args.password = argv[index + 1];
      index += 1;
      continue;
    }
  }

  return args;
}

async function main() {
  const { input, output, username, password } = parseArgs(process.argv.slice(2));
  const headers = {};

  if (username && password) {
    headers.authorization = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
  }

  const response = await fetch(input, { headers });
  if (!response.ok) {
    throw new Error(`Failed to export OpenAPI from ${input}: HTTP ${response.status}`);
  }

  const payload = await response.text();
  const outputPath = path.resolve(output);
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, payload, 'utf8');
  console.log(`wrote ${path.relative(process.cwd(), outputPath)}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
