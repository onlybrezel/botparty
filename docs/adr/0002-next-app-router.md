# ADR 0002: Next.js App Router

**Status:** Accepted
**Date:** 2026-04-16

## Context

The web application needs server-rendered public pages, authenticated interactive views, route-level
loading/error boundaries, and a production image that can run behind the shared reverse proxy.

## Decision

Use Next.js with the App Router. Pages are server components by default; interactive workflows opt
into client components. Route handlers are limited to web-facing concerns such as the web liveness
endpoint. API business logic remains in the NestJS application.

## Consequences

- Public pages can be rendered without shipping their full implementation to the browser.
- Client state and effects must stay in explicit client components and hooks.
- The frontend remains a separate deployable image and depends on the API contract over HTTP and
  WebSocket, not on backend implementation modules.
