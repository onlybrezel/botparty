import type { CreditPackage } from '@botparty/shared';

export const CREDIT_PACKAGES: CreditPackage[] = [
  { id: 'starter', credits: 500, amountCents: 499, currency: 'EUR', label: 'Starter' },
  { id: 'plus', credits: 1500, amountCents: 1299, currency: 'EUR', label: 'Plus', bonus: 100 },
  { id: 'pro', credits: 4000, amountCents: 2999, currency: 'EUR', label: 'Pro', bonus: 500 },
  { id: 'mega', credits: 12000, amountCents: 7999, currency: 'EUR', label: 'Mega', bonus: 2000 },
];

export function findPackage(id: string): CreditPackage | undefined {
  return CREDIT_PACKAGES.find((pkg) => pkg.id === id);
}
