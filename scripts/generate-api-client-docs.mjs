#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_INPUT = 'docs/openapi.json';
const DEFAULT_OUTPUT = 'docs/api-client.md';
const METHOD_ORDER = ['get', 'post', 'put', 'patch', 'delete', 'options', 'head'];

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
      printHelp();
      process.exit(0);
    }
  }

  return args;
}

function printHelp() {
  console.log(`Generate Markdown client docs from an OpenAPI document.

Usage:
  node scripts/generate-api-client-docs.mjs [--input <file-or-url>] [--output <markdown-path>]

Defaults:
  --input  ${DEFAULT_INPUT}
  --output ${DEFAULT_OUTPUT}`);
}

function isHttpUrl(value) {
  return /^https?:\/\//i.test(value);
}

async function readSpec(input) {
  if (isHttpUrl(input)) {
    const response = await fetch(input);
    if (!response.ok) {
      throw new Error(`failed to fetch OpenAPI spec from ${input}: ${response.status} ${response.statusText}`);
    }
    return response.json();
  }

  const resolvedPath = path.resolve(input);
  const raw = await fs.readFile(resolvedPath, 'utf8');
  return JSON.parse(raw);
}

function resolveRef(spec, ref) {
  if (!ref?.startsWith('#/')) {
    return null;
  }

  return ref
    .slice(2)
    .split('/')
    .reduce((current, key) => (current && typeof current === 'object' ? current[key] : undefined), spec);
}

function deref(spec, value) {
  if (!value || typeof value !== 'object' || !('$ref' in value)) {
    return value;
  }
  return resolveRef(spec, value.$ref) ?? value;
}

function refName(ref) {
  if (!ref) {
    return null;
  }
  const segments = ref.split('/');
  return segments[segments.length - 1] ?? null;
}

function escapeInline(value) {
  return String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/\|/g, '\\|')
    .replace(/[\r\n]+/g, ' ')
    .trim();
}

function schemaToText(spec, schema, depth = 0) {
  if (!schema) {
    return 'unknown';
  }

  if (schema.$ref) {
    return refName(schema.$ref) ?? schema.$ref;
  }

  if (Array.isArray(schema.enum) && schema.enum.length > 0) {
    return schema.enum.map((value) => JSON.stringify(value)).join(' | ');
  }

  if (Array.isArray(schema.oneOf) && schema.oneOf.length > 0) {
    return schema.oneOf.map((entry) => schemaToText(spec, deref(spec, entry), depth + 1)).join(' | ');
  }

  if (Array.isArray(schema.anyOf) && schema.anyOf.length > 0) {
    return schema.anyOf.map((entry) => schemaToText(spec, deref(spec, entry), depth + 1)).join(' | ');
  }

  if (Array.isArray(schema.allOf) && schema.allOf.length > 0) {
    return schema.allOf.map((entry) => schemaToText(spec, deref(spec, entry), depth + 1)).join(' & ');
  }

  if (schema.type === 'array') {
    return `array<${schemaToText(spec, deref(spec, schema.items), depth + 1)}>`;
  }

  if (schema.type === 'object' && schema.properties && depth < 1) {
    const propertyEntries = Object.entries(schema.properties)
      .slice(0, 4)
      .map(([name, propertySchema]) => `${name}: ${schemaToText(spec, deref(spec, propertySchema), depth + 1)}`);
    const suffix = Object.keys(schema.properties).length > 4 ? ', ...' : '';
    return `{ ${propertyEntries.join(', ')}${suffix} }`;
  }

  if (schema.format) {
    return `${schema.type ?? 'value'} (${schema.format})`;
  }

  if (schema.type) {
    return schema.type;
  }

  return 'unknown';
}

function renderSecurity(spec, security) {
  const effectiveSecurity = Array.isArray(security) ? security : spec.security;
  if (!effectiveSecurity || effectiveSecurity.length === 0) {
    return 'Public';
  }

  return effectiveSecurity
    .map((entry) => {
      const schemes = Object.keys(entry);
      return schemes.length > 0 ? schemes.join(' + ') : 'Public';
    })
    .join(' or ');
}

function collectParameters(spec, operation, pathItem) {
  return [...(pathItem.parameters ?? []), ...(operation.parameters ?? [])].map((parameter) => deref(spec, parameter));
}

function renderTable(lines, headers, rows) {
  lines.push(`| ${headers.join(' | ')} |`);
  lines.push(`| ${headers.map(() => '---').join(' | ')} |`);
  for (const row of rows) {
    lines.push(`| ${row.map((value) => escapeInline(value)).join(' | ')} |`);
  }
  lines.push('');
}

function renderParameters(lines, spec, parameters) {
  if (parameters.length === 0) {
    lines.push('No parameters.', '');
    return;
  }

  renderTable(
    lines,
    ['In', 'Name', 'Required', 'Type', 'Description'],
    parameters.map((parameter) => [
      parameter.in ?? '',
      parameter.name ?? '',
      parameter.required ? 'Yes' : 'No',
      schemaToText(spec, deref(spec, parameter.schema)),
      parameter.description ?? '',
    ]),
  );
}

function renderRequestBody(lines, spec, requestBody) {
  const body = deref(spec, requestBody);
  if (!body?.content) {
    lines.push('No request body.', '');
    return;
  }

  renderTable(
    lines,
    ['Content-Type', 'Required', 'Schema'],
    Object.entries(body.content).map(([contentType, mediaType]) => [
      contentType,
      body.required ? 'Yes' : 'No',
      schemaToText(spec, deref(spec, mediaType.schema)),
    ]),
  );
}

function renderResponses(lines, spec, responses) {
  const resolvedResponses = deref(spec, responses);
  const entries = Object.entries(resolvedResponses ?? {});
  if (entries.length === 0) {
    lines.push('No documented responses.', '');
    return;
  }

  renderTable(
    lines,
    ['Status', 'Description', 'Schema'],
    entries.map(([status, response]) => {
      const resolvedResponse = deref(spec, response);
      const contentEntries = Object.values(resolvedResponse?.content ?? {});
      const schema = contentEntries[0]?.schema ? schemaToText(spec, deref(spec, contentEntries[0].schema)) : '';
      return [status, resolvedResponse?.description ?? '', schema];
    }),
  );
}

function buildOperations(spec) {
  const grouped = new Map();

  for (const [route, rawPathItem] of Object.entries(spec.paths ?? {})) {
    const pathItem = deref(spec, rawPathItem);
    for (const method of METHOD_ORDER) {
      const operation = deref(spec, pathItem?.[method]);
      if (!operation) {
        continue;
      }

      const tag = operation.tags?.[0] ?? 'General';
      const entry = {
        method,
        route,
        operation,
        pathItem,
      };
      const bucket = grouped.get(tag) ?? [];
      bucket.push(entry);
      grouped.set(tag, bucket);
    }
  }

  return [...grouped.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([tag, operations]) => [
      tag,
      operations.sort((left, right) => {
        if (left.route === right.route) {
          return METHOD_ORDER.indexOf(left.method) - METHOD_ORDER.indexOf(right.method);
        }
        return left.route.localeCompare(right.route);
      }),
    ]);
}

function renderSecuritySchemes(lines, spec) {
  const schemes = spec.components?.securitySchemes ?? {};
  const entries = Object.entries(schemes);
  if (entries.length === 0) {
    lines.push('## Authentication', '', 'No authentication schemes documented.', '');
    return;
  }

  lines.push('## Authentication', '');
  renderTable(
    lines,
    ['Name', 'Type', 'Scheme', 'Description'],
    entries.map(([name, scheme]) => [
      name,
      scheme.type ?? '',
      scheme.scheme ?? scheme.bearerFormat ?? '',
      scheme.description ?? '',
    ]),
  );
}

function renderDocument(spec, source) {
  const lines = [];
  const title = spec.info?.title ?? 'API Client Docs';
  const description = spec.info?.description?.trim();
  const version = spec.info?.version ?? 'unknown';
  const servers = Array.isArray(spec.servers) ? spec.servers : [];

  lines.push(`# ${title}`, '');
  if (description) {
    lines.push(description, '');
  }
  lines.push(`Generated from OpenAPI ${version}.`, '');
  lines.push(`Source: ${source}`, '');

  lines.push('## Base URL', '');
  if (servers.length === 0) {
    lines.push('No server URL declared in the spec.', '');
  } else {
    lines.push(...servers.map((server) => `- ${server.url}${server.description ? ` - ${server.description}` : ''}`), '');
  }

  renderSecuritySchemes(lines, spec);
  lines.push('## Endpoints', '');

  for (const [tag, operations] of buildOperations(spec)) {
    lines.push(`### ${tag}`, '');
    for (const { method, route, operation, pathItem } of operations) {
      lines.push(`#### ${method.toUpperCase()} ${route}`, '');
      if (operation.summary) {
        lines.push(operation.summary.trim(), '');
      }
      if (operation.description) {
        lines.push(operation.description.trim(), '');
      }
      lines.push(`Authentication: ${renderSecurity(spec, operation.security)}`);
      if (operation.operationId) {
        lines.push(`Operation ID: ${operation.operationId}`);
      }
      lines.push('');

      lines.push('Parameters', '');
      renderParameters(lines, spec, collectParameters(spec, operation, pathItem));

      lines.push('Request Body', '');
      renderRequestBody(lines, spec, operation.requestBody);

      lines.push('Responses', '');
      renderResponses(lines, spec, operation.responses);
    }
  }

  return `${lines.join('\n').trim()}\n`;
}

async function main() {
  const { input, output } = parseArgs(process.argv.slice(2));
  const spec = await readSpec(input);
  const markdown = renderDocument(spec, input);
  const outputPath = path.resolve(output);
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, markdown, 'utf8');
  console.log(`wrote ${path.relative(process.cwd(), outputPath)}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
