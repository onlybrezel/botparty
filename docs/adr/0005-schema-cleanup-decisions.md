# ADR-0005: Schema Cleanup Decisions for Unused Models and Fields

- Date: 2026-04-17
- Status: Accepted

## Context

The audit flagged `SwarmGroup`, `Transaction`, `AnalyticsEvent` and selected fields (`aiAssistEnabled`, `ros2Enabled`, `balance`, `credits`) as potentially unused. Before dropping schema elements we need explicit decisions to avoid breaking roadmap features and operational tooling.

## Decision

1. Keep `AnalyticsEvent` in the schema and runtime.
   - It is written by session flows and purged by maintenance sweeps.
   - The current gap is dashboard usage depth, not storage validity.
2. Keep `Transaction`, `balance`, and `credits`.
   - Credits and balance are already exposed and managed in user service paths.
   - `Transaction` remains the durable ledger model for future monetization and queue policies.
3. Keep `SwarmGroup`, `aiAssistEnabled`, and `ros2Enabled` as roadmap flags.
   - These fields remain dormant but intentionally reserved for robot capability expansion.
4. Add explicit cleanup criteria before removal.
   - A schema element may be removed only when no API contract, runtime path, seed, or migration dependency remains.

## Consequences

- No destructive migration is performed in this cycle.
- We avoid churn in API contracts and dashboard code relying on credits/balance.
- Roadmap-related fields remain visible and documented instead of being silently removed.

## Follow-up

- Re-evaluate dormant fields quarterly.
- If `SwarmGroup`, `aiAssistEnabled`, or `ros2Enabled` stay unused for two release cycles, prepare a deprecation RFC and migration plan.
