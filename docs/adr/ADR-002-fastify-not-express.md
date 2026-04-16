# ADR-002: Fastify instead of Express

**Date:** 2024  
**Status:** Accepted

## Context

NestJS supports both Express and Fastify as HTTP adapters. Both are mature and well-maintained. A choice was needed at project start.

## Decision

Use `@nestjs/platform-fastify` with `FastifyAdapter`.

## Rationale

- **Throughput:** Fastify benchmarks consistently 20–40% faster than Express on raw HTTP throughput for comparable workloads.
- **Schema validation:** Fastify's JSON Schema validation is compiled by `fast-json-stringify` and `ajv`, reducing serialization overhead for frequently-called endpoints (queue, presence, robot status).
- **Type safety:** Fastify has first-class TypeScript support and integrates cleanly with NestJS decorators.
- **Plugin ecosystem:** `@fastify/helmet`, `@fastify/multipart` (for thumbnail upload) are direct equivalents of their Express counterparts.

## Consequences

- Some Express-specific middleware (e.g. `passport`, `express-session`) cannot be used directly. NestJS guards/interceptors replace these.
- `res.locals` pattern doesn't exist — request context is passed through NestJS execution context.
- `@Res({ passthrough: true })` must be used when setting headers on a Fastify reply.
