# API Client Docs Generation

BotParty can now render human-readable client docs straight from the OpenAPI document served by the API.

## Default Workflow

1. Start the API with Swagger enabled.
2. Run:

```bash
pnpm docs:api-client
```

By default, the generator reads `http://localhost:4000/docs-json` and writes `docs/api-client.md`.

## Custom Input Or Output

Use a local spec file or a different URL when needed:

```bash
pnpm docs:api-client -- --input apps/api/openapi.json --output docs/api-client.md
pnpm docs:api-client -- --input https://example.com/docs-json --output /tmp/botparty-api.md
```

## Output Contents

The generated Markdown includes:

- server URLs
- documented authentication schemes
- endpoint groups by tag
- parameters, request bodies, and response schemas per operation

This keeps the client-facing reference derived from the same OpenAPI source the Swagger UI uses.

## TypeScript Client Generation

Generate a typed fetch client for the web app with:

```bash
pnpm generate:ts-api-client
```

The default output path is `apps/web/src/lib/generated/openapi-client`.

You can override both ends when needed:

```bash
pnpm generate:ts-api-client -- --input apps/api/openapi.json --output apps/web/src/lib/generated/openapi-client
```