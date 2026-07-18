# ADR 0008: Fastify HTTP adapter

- Date: 2026-07-18
- Status: Accepted; replaces the unnumbered legacy Fastify note

## Context

NestJS needs one HTTP adapter. The application already uses Fastify request/reply types, raw-body
capture for signed payment webhooks, request IDs, Helmet, CORS, and route-specific body limits.

## Decision

Keep `@nestjs/platform-fastify` and Fastify. Adapter-specific behavior stays at HTTP boundaries;
business services do not depend on Fastify request or reply objects.

## Alternatives

Express would require a broad adapter migration without simplifying the current code or operation.

## Consequences

- Fastify plugins used by bootstrap remain explicit runtime dependencies.
- Controllers may use `FastifyReply` only when Nest's adapter-neutral response handling is
  insufficient, for example readiness status and Prometheus content type.
- New middleware must be checked for Fastify compatibility.
