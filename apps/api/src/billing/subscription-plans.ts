import type { ConfigService } from '@nestjs/config';
import type { RecurringSubscriptionPlan } from '@botparty/shared';

function parseIntEnv(value: string | undefined, fallback: number) {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseCurrency(value: string | undefined, fallback: string) {
  return (value?.trim() || fallback).toUpperCase();
}

export function getRecurringPlans(config: ConfigService): RecurringSubscriptionPlan[] {
  const enabled = config.get<string>('SUBSCRIPTION_MONTHLY_ENABLED');
  if (enabled?.trim().toLowerCase() === 'false') {
    return [];
  }

  const credits = parseIntEnv(config.get<string>('SUBSCRIPTION_MONTHLY_CREDITS'), 2_500);
  const amountCents = parseIntEnv(config.get<string>('SUBSCRIPTION_MONTHLY_AMOUNT_CENTS'), 1_799);
  const bonus = parseIntEnv(config.get<string>('SUBSCRIPTION_MONTHLY_BONUS'), 0);
  const intervalCount = parseIntEnv(config.get<string>('SUBSCRIPTION_MONTHLY_INTERVAL_COUNT'), 1);
  const plan: RecurringSubscriptionPlan = {
    id: config.get<string>('SUBSCRIPTION_MONTHLY_PLAN_ID')?.trim() || 'monthly-booster',
    label: config.get<string>('SUBSCRIPTION_MONTHLY_LABEL')?.trim() || 'Monthly Booster',
    description:
      config.get<string>('SUBSCRIPTION_MONTHLY_DESCRIPTION')?.trim() ||
      'Auto-top up credits every month without having to remember a checkout.',
    credits,
    amountCents,
    currency: parseCurrency(config.get<string>('SUBSCRIPTION_MONTHLY_CURRENCY'), 'EUR'),
    bonus: bonus > 0 ? bonus : undefined,
    interval: 'month',
    intervalCount,
    supportedProviders: ['stripe'],
  };

  return [plan];
}
