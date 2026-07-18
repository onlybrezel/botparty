import { validateEnvironment } from './environment';

const productionEnvironment = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://botparty:secret@postgres:5432/botparty',
  REDIS_HOST: 'redis',
  REDIS_PORT: '6379',
  CORS_ORIGIN: 'https://botparty.example',
  APP_URL: 'https://botparty.example',
  PUBLIC_WEB_URL: 'https://botparty.example',
  JWT_SECRET: 'j'.repeat(32),
  JWT_REFRESH_SECRET: 'r'.repeat(32),
  ROBOT_JWT_SECRET: 'o'.repeat(32),
  LIVEKIT_API_KEY: 'botparty-key-123',
  LIVEKIT_API_SECRET: 'l'.repeat(32),
  LIVEKIT_URL: 'ws://livekit:7880',
  LIVEKIT_PUBLIC_URL: 'wss://botparty.example/rtc',
  WEBHOOK_SECRET_ENCRYPTION_KEY: 'w'.repeat(32),
  SMTP_HOST: 'smtp.example.com',
  SMTP_FROM: 'BotParty <mail@botparty.example>',
  METRICS_AUTH_REQUIRED: 'true',
  METRICS_USERNAME: 'metrics',
  METRICS_PASSWORD: 'm'.repeat(16),
};

describe('validateEnvironment', () => {
  it('accepts a complete production configuration', () => {
    expect(() => validateEnvironment(productionEnvironment)).not.toThrow();
  });

  it('fails production startup for insecure public URLs and missing secrets', () => {
    expect(() => validateEnvironment({
      ...productionEnvironment,
      APP_URL: 'http://botparty.example',
      JWT_SECRET: '',
    })).toThrow(/APP_URL: must use https:|JWT_SECRET: is required/);
  });

  it('rejects partially configured provider and storage groups', () => {
    expect(() => validateEnvironment({
      ...productionEnvironment,
      STRIPE_SECRET_KEY: 'sk_live_partial',
      THUMBNAIL_S3_ENDPOINT: 'https://objects.example',
    })).toThrow(/configuration group is incomplete/);
  });

  it('keeps all monetization gates disabled by default', () => {
    const parsed = validateEnvironment({
      NODE_ENV: 'test',
      DATABASE_URL: productionEnvironment.DATABASE_URL,
      REDIS_HOST: '127.0.0.1',
      REDIS_PORT: '6379',
      CORS_ORIGIN: 'http://127.0.0.1:3000',
    });

    expect(parsed).toEqual(expect.objectContaining({
      JWT_EXPIRES_IN: '15m',
      JWT_REFRESH_EXPIRES_IN: '7d',
      FEATURE_BILLING_ENABLED: false,
      FEATURE_DONATIONS_ENABLED: false,
      FEATURE_PAYOUTS_ENABLED: false,
      FEATURE_PAID_CONTROLS_ENABLED: false,
      FEATURE_SUBSCRIPTIONS_ENABLED: false,
    }));
  });

  it('rejects SameSite=None cookies unless Secure is guaranteed', () => {
    expect(() => validateEnvironment({
      NODE_ENV: 'test',
      DATABASE_URL: productionEnvironment.DATABASE_URL,
      REDIS_HOST: '127.0.0.1',
      REDIS_PORT: '6379',
      CORS_ORIGIN: 'http://127.0.0.1:3000',
      AUTH_COOKIE_SAMESITE: 'None',
      AUTH_COOKIE_SECURE: 'false',
    })).toThrow(/AUTH_COOKIE_SECURE: must be true/);

    expect(() => validateEnvironment({ ...productionEnvironment, AUTH_COOKIE_SAMESITE: 'None' })).not.toThrow();
  });
});
