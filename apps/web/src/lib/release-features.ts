function enabled(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === 'true';
}

export const releaseFeatures = Object.freeze({
  billing: enabled(process.env.NEXT_PUBLIC_FEATURE_BILLING),
  donations: enabled(process.env.NEXT_PUBLIC_FEATURE_DONATIONS),
  payouts: enabled(process.env.NEXT_PUBLIC_FEATURE_PAYOUTS),
  paidControls: enabled(process.env.NEXT_PUBLIC_FEATURE_PAID_CONTROLS),
});
