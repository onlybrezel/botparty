import { z } from 'zod';

const booleanString = z
  .union([z.boolean(), z.string()])
  .transform((value) => value === true || String(value).trim().toLowerCase() === 'true');

const optionalUrl = z.string().url().optional().or(z.literal(''));
const optionalSecret = z.string().min(1).optional();
const optionalBooleanString = z
  .union([z.boolean(), z.string()])
  .transform((value) => value === true || String(value).trim().toLowerCase() === 'true')
  .optional();

const environmentSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    DATABASE_URL: z.string().min(1),
    DATABASE_WRITE_URL: optionalUrl,
    DATABASE_READ_URL: optionalUrl,
    REDIS_HOST: z.string().min(1),
    REDIS_PORT: z.coerce.number().int().min(1).max(65_535),
    REDIS_PASSWORD: z.string().optional(),
    PUBLIC_WEB_URL: optionalUrl,
    CORS_ORIGIN: z.string().min(1),
    APP_URL: optionalUrl,
    JWT_SECRET: optionalSecret,
    JWT_REFRESH_SECRET: optionalSecret,
    JWT_EXPIRES_IN: z.string().regex(/^\d+(?:ms|s|m|h|d|w|y)$/).default('15m'),
    JWT_REFRESH_EXPIRES_IN: z.string().regex(/^\d+(?:ms|s|m|h|d|w|y)$/).default('7d'),
    ROBOT_JWT_SECRET: optionalSecret,
    LIVEKIT_API_KEY: optionalSecret,
    LIVEKIT_API_SECRET: optionalSecret,
    LIVEKIT_URL: optionalSecret,
    LIVEKIT_PUBLIC_URL: optionalSecret,
    WEBHOOK_SECRET_ENCRYPTION_KEY: optionalSecret,
    METRICS_AUTH_REQUIRED: booleanString.default(false),
    METRICS_USERNAME: optionalSecret,
    METRICS_PASSWORD: optionalSecret,
    FEATURE_BILLING_ENABLED: booleanString.default(false),
    FEATURE_DONATIONS_ENABLED: booleanString.default(false),
    FEATURE_PAYOUTS_ENABLED: booleanString.default(false),
    FEATURE_PAID_CONTROLS_ENABLED: booleanString.default(false),
    FEATURE_SUBSCRIPTIONS_ENABLED: booleanString.default(false),
    STRIPE_SECRET_KEY: z.string().optional(),
    STRIPE_WEBHOOK_SECRET: z.string().optional(),
    PAYPAL_CLIENT_ID: z.string().optional(),
    PAYPAL_CLIENT_SECRET: z.string().optional(),
    PAYPAL_WEBHOOK_ID: z.string().optional(),
    LIVEKIT_RECORDINGS_S3_ENDPOINT: optionalUrl,
    LIVEKIT_RECORDINGS_S3_ACCESS_KEY_ID: z.string().optional(),
    LIVEKIT_RECORDINGS_S3_SECRET_ACCESS_KEY: z.string().optional(),
    THUMBNAIL_S3_ENDPOINT: optionalUrl,
    THUMBNAIL_S3_ACCESS_KEY_ID: z.string().optional(),
    THUMBNAIL_S3_SECRET_ACCESS_KEY: z.string().optional(),
    SMTP_HOST: z.string().optional(),
    SMTP_FROM: z.string().min(3).optional(),
    PAYOUT_DESTINATION_ENCRYPTION_KEY: z.string().min(32).optional(),
    AUTH_COOKIE_SAMESITE: z.string().optional(),
    AUTH_COOKIE_SECURE: optionalBooleanString,
  })
  .passthrough()
  .superRefine((env, context) => {
    if (env.FEATURE_BILLING_ENABLED && !env.STRIPE_SECRET_KEY && !env.PAYPAL_CLIENT_ID) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['FEATURE_BILLING_ENABLED'],
        message: 'requires a fully configured Stripe or PayPal provider',
      });
    }
    if (env.FEATURE_SUBSCRIPTIONS_ENABLED && !env.FEATURE_BILLING_ENABLED) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['FEATURE_SUBSCRIPTIONS_ENABLED'],
        message: 'requires FEATURE_BILLING_ENABLED=true',
      });
    }
    if (env.NODE_ENV === 'production' && (!env.SMTP_HOST || !env.SMTP_FROM)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['SMTP_HOST'],
        message: 'SMTP_HOST and SMTP_FROM are required in production',
      });
    }
    if (env.NODE_ENV === 'production') {
      const requiredSecrets: Array<[keyof typeof env, number]> = [
        ['JWT_SECRET', 32],
        ['JWT_REFRESH_SECRET', 32],
        ['ROBOT_JWT_SECRET', 32],
        ['LIVEKIT_API_KEY', 12],
        ['LIVEKIT_API_SECRET', 32],
        ['WEBHOOK_SECRET_ENCRYPTION_KEY', 32],
      ];
      for (const [name, minLength] of requiredSecrets) {
        const value = env[name];
        if (!value || String(value).trim().length < minLength) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: [name],
            message: `is required with at least ${minLength} characters in production`,
          });
        }
      }
      for (const [name, expectedProtocol] of [
        ['APP_URL', 'https:'],
        ['PUBLIC_WEB_URL', 'https:'],
        ['LIVEKIT_PUBLIC_URL', 'wss:'],
      ] as const) {
        const value = env[name];
        if (!value || new URL(value).protocol !== expectedProtocol) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: [name],
            message: `must use ${expectedProtocol} in production`,
          });
        }
      }
      const corsOrigins = env.CORS_ORIGIN.split(',').map((value) => value.trim()).filter(Boolean);
      if (corsOrigins.length === 0 || corsOrigins.some((value) => !URL.canParse(value) || new URL(value).protocol !== 'https:')) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['CORS_ORIGIN'],
          message: 'must contain only HTTPS origins in production',
        });
      }
      if (env.METRICS_AUTH_REQUIRED && (!env.METRICS_USERNAME || !env.METRICS_PASSWORD || env.METRICS_PASSWORD.length < 12)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['METRICS_PASSWORD'],
          message: 'must contain at least 12 characters when metrics authentication is enabled',
        });
      }
    }
    for (const group of [
      ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET'],
      ['PAYPAL_CLIENT_ID', 'PAYPAL_CLIENT_SECRET', 'PAYPAL_WEBHOOK_ID'],
      ['LIVEKIT_RECORDINGS_S3_ENDPOINT', 'LIVEKIT_RECORDINGS_S3_ACCESS_KEY_ID', 'LIVEKIT_RECORDINGS_S3_SECRET_ACCESS_KEY'],
      ['THUMBNAIL_S3_ENDPOINT', 'THUMBNAIL_S3_ACCESS_KEY_ID', 'THUMBNAIL_S3_SECRET_ACCESS_KEY'],
    ] as const) {
      const configured = group.filter((name) => Boolean(env[name]?.trim()));
      if (configured.length > 0 && configured.length !== group.length) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [configured[0] ?? group[0]],
          message: `configuration group is incomplete; set ${group.join(', ')}`,
        });
      }
    }
    if (env.FEATURE_PAYOUTS_ENABLED && !env.PAYOUT_DESTINATION_ENCRYPTION_KEY) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['PAYOUT_DESTINATION_ENCRYPTION_KEY'],
        message: 'is required when payouts are enabled',
      });
    }
    if (
      env.AUTH_COOKIE_SAMESITE?.trim().toLowerCase() === 'none'
      && (env.AUTH_COOKIE_SECURE === false || (env.AUTH_COOKIE_SECURE === undefined && env.NODE_ENV !== 'production'))
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['AUTH_COOKIE_SECURE'],
        message: 'must be true when AUTH_COOKIE_SAMESITE=None',
      });
    }
  });

export function validateEnvironment(raw: Record<string, unknown>) {
  const result = environmentSchema.safeParse(raw);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${issue.path.join('.') || 'environment'}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid environment configuration: ${details}`);
  }
  return result.data;
}
