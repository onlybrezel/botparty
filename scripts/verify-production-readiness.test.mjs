import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { evaluateProductionReadiness } from './verify-production-readiness.mjs';

const completeEnvironment = {
  NODE_ENV: 'production',
  PUBLIC_DEPLOYMENT: 'true',
  APP_VERSION: '0.1.4',
  APP_URL: 'https://botparty.example',
  PUBLIC_WEB_URL: 'https://botparty.example',
  NEXT_PUBLIC_APP_URL: 'https://botparty.example',
  NEXT_PUBLIC_API_URL: 'https://botparty.example/api',
  NEXT_PUBLIC_WS_URL: 'wss://botparty.example',
  LIVEKIT_PUBLIC_URL: 'wss://botparty.example/rtc',
  NEXT_PUBLIC_LIVEKIT_URL: 'wss://botparty.example/rtc',
  NEXT_PUBLIC_LEGAL_OPERATOR_NAME: 'Example Operator GmbH',
  NEXT_PUBLIC_LEGAL_OPERATOR_EMAIL: 'legal@botparty.example',
  NEXT_PUBLIC_LEGAL_OPERATOR_ADDRESS: 'Testweg 1, Berlin',
  NEXT_PUBLIC_LEGAL_OPERATOR_COUNTRY: 'Germany',
  NEXT_PUBLIC_LEGAL_GOVERNING_LAW: 'Germany',
  SMTP_HOST: 'smtp.botparty.example',
  SMTP_FROM: 'BotParty <mail@botparty.example>',
  LEGAL_REVIEW_REFERENCE: 'LEGAL-42',
  PRIVACY_REVIEW_REFERENCE: 'PRIVACY-42',
  BACKUP_RESTORE_REVIEW_REFERENCE: 'RESTORE-2026-07-19',
  ALERTING_REVIEW_REFERENCE: 'OPS-42',
  NGINX_CONF: './docker/nginx/nginx.ssl.conf',
  FEATURE_BILLING_ENABLED: 'false',
  FEATURE_PAYOUTS_ENABLED: 'false',
  FEATURE_PAID_CONTROLS_ENABLED: 'false',
  FEATURE_SUBSCRIPTIONS_ENABLED: 'false',
};

describe('production readiness preflight', () => {
  it('accepts a reviewed deployment while high-risk features remain disabled', () => {
    const result = evaluateProductionReadiness(completeEnvironment, { checkFiles: false });
    assert.deepEqual(result.failures, []);
    assert.equal(result.notices.length, 3);
  });

  it('fails without external review evidence', () => {
    const result = evaluateProductionReadiness(
      {
        ...completeEnvironment,
        LEGAL_REVIEW_REFERENCE: '',
        PRIVACY_REVIEW_REFERENCE: '',
        BACKUP_RESTORE_REVIEW_REFERENCE: '',
        ALERTING_REVIEW_REFERENCE: '',
      },
      { checkFiles: false },
    );

    assert.match(result.failures.join('\n'), /LEGAL_REVIEW_REFERENCE/);
    assert.match(result.failures.join('\n'), /PRIVACY_REVIEW_REFERENCE/);
    assert.match(result.failures.join('\n'), /BACKUP_RESTORE_REVIEW_REFERENCE/);
    assert.match(result.failures.join('\n'), /ALERTING_REVIEW_REFERENCE/);
  });

  it('requires provider acceptance before billing can be enabled', () => {
    const result = evaluateProductionReadiness(
      {
        ...completeEnvironment,
        FEATURE_BILLING_ENABLED: 'true',
        STRIPE_SECRET_KEY_FILE: '/run/secrets/stripe_secret_key',
      },
      { checkFiles: false },
    );

    assert.match(result.failures.join('\n'), /BILLING_PROVIDER_REVIEW_REFERENCE/);
    assert.match(result.failures.join('\n'), /STRIPE_LIVE_REVIEW_REFERENCE/);
  });

  it('requires payout and robot-safety acceptance only for enabled capabilities', () => {
    const result = evaluateProductionReadiness(
      {
        ...completeEnvironment,
        FEATURE_PAYOUTS_ENABLED: 'true',
        FEATURE_PAID_CONTROLS_ENABLED: 'true',
      },
      { checkFiles: false },
    );

    assert.match(result.failures.join('\n'), /PAYOUT_OPERATIONS_REVIEW_REFERENCE/);
    assert.match(result.failures.join('\n'), /ROBOT_SAFETY_REVIEW_REFERENCE/);
  });

  it('rejects branch-like image versions, insecure URLs and subscriptions', () => {
    const result = evaluateProductionReadiness(
      {
        ...completeEnvironment,
        APP_VERSION: 'latest',
        NEXT_PUBLIC_APP_URL: 'http://botparty.example',
        FEATURE_SUBSCRIPTIONS_ENABLED: 'true',
      },
      { checkFiles: false },
    );

    assert.match(result.failures.join('\n'), /APP_VERSION/);
    assert.match(result.failures.join('\n'), /NEXT_PUBLIC_APP_URL/);
    assert.match(result.failures.join('\n'), /FEATURE_SUBSCRIPTIONS_ENABLED/);
  });

  it('accepts all required local secret and TLS files', () => {
    const rootDirectory = mkdtempSync(join(tmpdir(), 'botparty-preflight-'));
    const secretDirectory = join(rootDirectory, 'secrets');
    const certificateDirectory = join(rootDirectory, 'docker/nginx/ssl');
    mkdirSync(secretDirectory, { recursive: true });
    mkdirSync(certificateDirectory, { recursive: true });
    for (const fileName of [
      'api_database_url',
      'redis_password',
      'jwt_secret',
      'jwt_refresh_secret',
      'robot_jwt_secret',
      'webhook_secret_encryption_key',
      'livekit_api_secret',
      'metrics_password',
      'minio_root_password',
      'backup_encryption_key',
      'alertmanager_webhook_url',
    ]) {
      writeFileSync(join(secretDirectory, fileName), 'test-secret-value', { mode: 0o600 });
    }
    writeFileSync(join(certificateDirectory, 'fullchain.pem'), 'test-certificate');
    writeFileSync(join(certificateDirectory, 'privkey.pem'), 'test-private-key', { mode: 0o600 });

    try {
      const result = evaluateProductionReadiness(
        { ...completeEnvironment, BOTPARTY_SECRET_DIR: secretDirectory },
        { rootDirectory },
      );
      assert.deepEqual(result.failures, []);
    } finally {
      rmSync(rootDirectory, { recursive: true, force: true });
    }
  });

  it('rejects PayPal sandbox mode for public billing', () => {
    const result = evaluateProductionReadiness(
      {
        ...completeEnvironment,
        FEATURE_BILLING_ENABLED: 'true',
        BILLING_PROVIDER_REVIEW_REFERENCE: 'PAYPAL-SANDBOX-42',
        PAYPAL_CLIENT_ID: 'configured-client',
        PAYPAL_ENV: 'sandbox',
      },
      { checkFiles: false },
    );

    assert.match(result.failures.join('\n'), /PAYPAL_ENV/);
    assert.match(result.failures.join('\n'), /PAYPAL_LIVE_REVIEW_REFERENCE/);
  });
});
