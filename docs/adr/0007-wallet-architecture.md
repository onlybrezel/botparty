# ADR-0007: Wallet, Billing, and Creator Payouts Architecture

- Date: 2026-05-08
- Status: Accepted

## Context

BotParty needs a credits economy that lets viewers buy credits, spend them on robot interactions (costed control buttons, donations to creators), and lets creators eventually cash out earnings. Until now `User.credits` was a single integer used loosely for rewards and Staff adjustments, with no audit trail and no spend path.

We need:

1. A reliable spendable balance with an immutable ledger.
2. A safe path from external payments (Stripe, PayPal) to credited balances.
3. Creator earnings that are accountable and payable out, without inventing competing media or queue infrastructure.
4. Predictable behavior under realtime control traffic where wallet ops sit on the hot path.

## Decision

### Single-balance ledger model

`User.balance` (integer, unit "credits") is the single spendable balance. The legacy `User.credits` field stays for now as a read-only lifetime score and is not touched by spend/donation/payout flows. Migration to a fully aggregated lifetime view is deferred.

Every economic event writes one or more rows to `Transaction`, with:

- `type: TransactionType` — DEPOSIT, WITHDRAWAL, BUTTON_SPEND, BUTTON_PAYOUT, DONATION_SENT, DONATION_RECEIVED, PLATFORM_FEE, ADMIN_ADJUSTMENT, REWARD, REFUND, CHARGEBACK
- `amount: Int` — signed delta against the user's balance
- `balanceAfter: Int` — balance snapshot immediately after this row was applied
- `ledgerGroupId: UUID?` — groups the rows that make up one logical event

### Three-row invariant

For each transfer (costed press, donation), exactly three Transaction rows share a `ledgerGroupId`:

- payer: `BUTTON_SPEND` / `DONATION_SENT`, `amount = -gross`
- creator: `BUTTON_PAYOUT` / `DONATION_RECEIVED`, `amount = +(gross - fee)`
- platform user: `PLATFORM_FEE`, `amount = +fee`

Invariant: `sum(amount) over ledgerGroupId == 0`. Self-referential transfers (donor == creator) are rejected upstream.

### Atomicity and locking

`WalletService` uses a single Prisma `$transaction` for every mutation. Debits use a guarded raw SQL update so the balance check and decrement happen in one round trip:

```sql
UPDATE users SET balance = balance - $1
WHERE id = $2 AND balance >= $1
RETURNING balance
```

If no row is returned, we throw `INSUFFICIENT_FUNDS` and write nothing. Multi-row mutations lock the participating users with `SELECT ... FOR UPDATE`, ordered by ascending `id`, to avoid deadlocks. Postgres serialization/deadlock errors (`40001`, `40P01`) are retried up to `MAX_RETRIES`.

### Platform user

A fixed system user with UUID `00000000-0000-0000-0000-00000000fee5` (configurable via `PLATFORM_USER_ID`) owns the fee balance. Boot fails fast if the row is missing or inactive. The user is hidden from staff lists and protected against direct mutation. Fees are computed as `Math.floor(gross * feeBps / 10_000)` with `PLATFORM_FEE_BPS=1000` (10%) by default.

### Realtime control handler ordering

Costed button presses run in this order in `gateway/control.handler.ts`:

1. Auth, access, queue, and restriction checks.
2. Button lookup including `costCredits` (cached in `controls.service`).
3. Robot connectivity check via `getOpenRobotClient` — abort without debit or cooldown if the robot is offline.
4. Non-destructive cooldown check (Redis `EXISTS`/TTL).
5. `walletService.transfer` — on `INSUFFICIENT_FUNDS`, emit a `wallet:insufficient` WS event with `{ required, balance, command }`. No further effects.
6. Cooldown set (`SET NX PX`).
7. Send command to robot client and broadcast to the crowd.
8. Emit `wallet:update` with `{ balance: payerBalanceAfter }` to the payer.

Cooldown is set after the wallet transfer to keep ledger and command effects in sync. The trade-off is that two near-simultaneous presses can both clear connectivity and cooldown checks before the first wallet transfer finishes; the wallet path itself is the serialization point and rejects the second call as `INSUFFICIENT_FUNDS` if the user can no longer pay. Tests cover this concurrency path.

### Donations

`DonationService` wraps the same `WalletService.transfer` with `DONATION_SENT` / `DONATION_RECEIVED` types, plus:

- Self-donation rejected (`SELF_DONATION_FORBIDDEN`).
- Hourly count limit and daily credit cap enforced via Redis counters (`DONATIONS_PER_HOUR`, `DONATIONS_DAILY_CAP_CREDITS`). Failed transfers roll back the rate-limit accounting.
- Optional `Idempotency-Key` header → `(userId, scope='donation', key)` row in `WalletIdempotencyKey`. Repeats return the original result.

### Billing webhook idempotency

Deposits flow through `BillingService` with multi-layer idempotency:

1. `BillingIntent` row keyed by `(provider, providerRef)` UNIQUE — created at checkout, looked up on every webhook.
2. `BillingWebhookEvent` row keyed by `(provider, eventId)` UNIQUE — guarantees a webhook is processed at most once.
3. Intent state machine `pending → paid → (refunded | chargeback)`, with conditional update so concurrent webhooks lose the race deterministically.
4. Cross-validation of `amount`, `currency`, `creditsAmount`, and `userId` against the stored intent — never blindly trusted from the webhook payload.

Refunds and chargebacks issue `REFUND` / `CHARGEBACK` transactions through `WalletService.refund`. Balance is allowed to go negative there with an account-freeze flag; pending payouts from the affected pool are held.

### Payouts

`PayoutRequest` records flow `PENDING → APPROVED → PAID`, with `PENDING → REJECTED` as the only branch off the happy path. The wallet is debited only on `markPaid` via `WalletService.debit` with `TransactionType.WITHDRAWAL`. Validation enforces `MIN_PAYOUT_REQUEST_CREDITS ≤ amount ≤ MAX_PAYOUT_REQUEST_CREDITS`, sufficient balance at request time, and no other open request per user. External transfer to Stripe Connect / PayPal Payouts is out of scope here; the schema reserves `WITHDRAWAL` and a `destination` string.

### Staff adjustments

`updateUserByStaff` no longer mutates `balance` directly. Staff balance changes go through `WalletService.adminAdjust(userId, delta, reason, requesterId)`, which writes an `ADMIN_ADJUSTMENT` transaction and an `AdminAuditLog` row. The platform user is not adjustable.

### LiveKit and Redis stay separate

The wallet is purely a Postgres ledger. LiveKit remains the media plane, Redis stays the queue/cooldown/realtime fan-out. Wallet ops do not run inside LiveKit signaling or queue arbitration.

## Consequences

1. Realtime control adds one Postgres round trip per costed press. Acceptable: cooldowns dampen rate, and the conditional update is a single statement.
2. The legacy `credits` column lingers; UI/leaderboard refactor to lifetime aggregates is a follow-up.
3. Webhook handling depends on a healthy Postgres — expected, since we already require it for room state.
4. Staff cannot bypass the audit trail to silently adjust balances.
5. Refund/chargeback logic accepts negative balances, which forces the eventual payout system to treat balances as non-monotonic and check the freeze flag.

## Out of Scope

- Tax/VAT handling.
- Multi-currency wallets (display currency only).
- Stripe Connect / PayPal Payouts wiring (separate phase).
- Removal of `User.credits`.

## References

- `apps/api/src/wallet/wallet.service.ts`
- `apps/api/src/wallet/donation.service.ts`
- `apps/api/src/wallet/platform-user.service.ts`
- `apps/api/src/billing/billing.service.ts`
- `apps/api/src/earnings/payouts.service.ts`
- `apps/api/src/gateway/control.handler.ts`
- `packages/shared/src/constants/index.ts` (LIMITS, WS_EVENTS)
