import { Global, Injectable, Module, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export const RELEASE_FEATURES = {
  BILLING: 'FEATURE_BILLING_ENABLED',
  DONATIONS: 'FEATURE_DONATIONS_ENABLED',
  PAYOUTS: 'FEATURE_PAYOUTS_ENABLED',
  PAID_CONTROLS: 'FEATURE_PAID_CONTROLS_ENABLED',
  SUBSCRIPTIONS: 'FEATURE_SUBSCRIPTIONS_ENABLED',
} as const;

export type ReleaseFeature = keyof typeof RELEASE_FEATURES;

@Injectable()
export class FeatureFlagsService {
  constructor(private readonly config: ConfigService) {}

  isEnabled(feature: ReleaseFeature): boolean {
    const value = this.config.get<boolean | string>(RELEASE_FEATURES[feature]);
    return value === true || String(value ?? '').trim().toLowerCase() === 'true';
  }

  assertEnabled(feature: ReleaseFeature): void {
    if (!this.isEnabled(feature)) {
      throw new ServiceUnavailableException({
        code: 'FEATURE_DISABLED',
        feature: feature.toLowerCase(),
        message: 'This feature is not enabled for this deployment.',
      });
    }
  }

  publicSnapshot() {
    return Object.fromEntries(
      (Object.keys(RELEASE_FEATURES) as ReleaseFeature[]).map((feature) => [
        feature.toLowerCase(),
        this.isEnabled(feature),
      ]),
    );
  }
}

@Global()
@Module({ providers: [FeatureFlagsService], exports: [FeatureFlagsService] })
export class FeatureFlagsModule {}
