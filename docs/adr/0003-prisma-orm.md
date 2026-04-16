# ADR 0003: Database ORM (Prisma vs TypeORM vs Raw SQL)

**Status:** Accepted
**Date:** 2026-04-16

## Context

Backend needed a database abstraction layer supporting:
- Type-safe query builder for TypeScript
- Auto-generated migrations
- Relationship eager-loading (avoid N+1)
- Real-time subscriptions (optional)
- Developer ergonomics

## Decision

We chose **Prisma** for:

1. **Type generation** – Automatic TypeScript types from schema
2. **Developer experience** – Intuitive query API, excellent docs
3. **Migrations** – Auto-generated, human-readable `.sql` files
4. **Relations** – Built-in relation loading with `.include()/` select()`
5. **Community** – Quick evolution, strong Next.js/NestJS support

## Consequences

### Positive
- Zero boilerplate for CRUD operations
- Type safety for queries and results
- Easy schema migrations
- Great debugging with `DEBUG=prisma:*`

### Negative
- Vendor lock-in (Prisma-specific QL)
- Raw queries require breaking out to SQL
- Subscription features require extra tooling

## Alternatives Considered

- **TypeORM:** More mature, but boilerplate-heavy decorators
- **Sequelize:** Good ORM, but weaker TS support
- **Raw SQL + sql-bricks:** Full control, but high maintenance burden

## Migration Path

If we ever needed to switch:
1. Keep all data access in services (separation of concerns ✓)
2. New ORM would only affect `*.service.ts` files
3. API/response types would remain unchanged

## References

- Prisma docs: https://www.prisma.io/docs/
- Prisma best practices: https://www.prisma.io/docs/guides/performance-and-optimization
