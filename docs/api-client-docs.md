# API Client Docs Generation

BotParty can now render human-readable client docs straight from the OpenAPI document served by the API.

## Default Workflow

1. Regenerate `docs/openapi.json` with `pnpm openapi:export` after API changes.
2. Run:

```bash
pnpm docs:api-client
```

By default, the generator reads `docs/openapi.json` and writes `docs/api-client.md`.

## Custom Input Or Output

Use a local spec file or a different URL when needed:

```bash
pnpm docs:api-client --input docs/openapi.json --output docs/api-client.md
pnpm docs:api-client --input https://example.com/docs-json --output /tmp/botparty-api.md
```

## Output Contents

The generated Markdown includes:

- server URLs
- documented authentication schemes
- endpoint groups by tag
- parameters, request bodies, and response schemas per operation

This keeps the client-facing reference derived from the same OpenAPI source the Swagger UI uses.

## Web API Client

The web application uses the focused modules under `apps/web/src/lib/api/`. They preserve the
product-specific cookie, CSRF, retry, and error-handling behavior and are covered by frontend and
end-to-end tests. No second generated runtime client is maintained.
