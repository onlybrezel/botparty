# ADR 0002: Frontend Framework Choice (Next.js App Router vs Pages Router)

**Status:** Accepted
**Date:** 2026-04-16

## Context

Frontend required a React-based framework with:
- Server-side rendering (SSR) for SEO
- Incremental Static Regeneration (ISR) for robot listings
- Type-safe API integration
- Simple deployment

## Decision

We chose **Next.js with App Router** (App Router over Pages Router) for:

1. **Server Components** – Reduce JS bundle, fetch secrets server-side
2. **Streaming** – Stream UI updates during loading (Suspense)
3. **Modern pattern** – App Router is the recommended direction for Next.js
4. **Layout nesting** – Natural component hierarchy via folder structure
5. **Backward compat** – Pages Router code still works within App Router

## Consequences

### Positive
- Smaller client bundles (Server Components + smart code splitting)
- Better SEO (SSR + static pages)
- Simpler secrets management (no exposure to browser)

### Negative
- Less mature ecosystem (fewer middleware examples for App Router)
- Learning curve for new team members
- Some third-party libraries not yet App Router-optimized

## Rationale for NOT using Remix / Svelte

- **Remix:** Smaller community, harder hiring; full rewrite cost
- **Svelte:** Smaller ecosystem; SSR/hydration still more complex than Next.js

## References

- Next.js App Router docs: https://nextjs.org/docs/app
- Server Components RFC: https://github.com/reactjs/rfcs/blob/main/text/0188-server-components.md
