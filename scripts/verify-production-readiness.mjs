import { accessSync, constants, readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const SEMVER_VERSION = /^v?(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/;

function enabled(value) {
  return (
    String(value ?? '')
      .trim()
      .toLowerCase() === 'true'
  );
}

function configured(env, name) {
  return Boolean(env[name]?.trim());
}

function requireValue(env, failures, name, reason) {
  if (!configured(env, name)) failures.push(`${name}: ${reason}`);
}

function requireUrl(env, failures, name, protocol) {
  const value = env[name]?.trim();
  if (!value) {
    failures.push(`${name}: is required`);
    return;
  }
  try {
    const url = new URL(value);
    if (url.protocol !== protocol) failures.push(`${name}: must use ${protocol}`);
  } catch {
    failures.push(`${name}: must be a valid URL`);
  }
}

function resolveHostSecret(env, envName, fallbackName, rootDirectory) {
  const configuredPath = env[envName]?.trim();
  const secretDirectory = resolve(
    rootDirectory,
    env.BOTPARTY_SECRET_DIR?.trim() || 'docker/secrets',
  );
  if (!configuredPath) return resolve(secretDirectory, fallbackName);
  if (configuredPath.startsWith('/run/secrets/'))
    return resolve(secretDirectory, basename(configuredPath));
  return resolve(rootDirectory, configuredPath);
}

function requireReadableFile(env, failures, envName, fallbackName, rootDirectory) {
  const path = resolveHostSecret(env, envName, fallbackName, rootDirectory);
  try {
    accessSync(path, constants.R_OK);
    if (!readFileSync(path).toString().trim()) failures.push(`${envName}: host secret file is empty`);
  } catch {
    failures.push(`${envName}: is not a readable host secret file`);
  }
}

export function evaluateProductionReadiness(env, options = {}) {
  const failures = [];
  const notices = [];
  const checkFiles = options.checkFiles ?? true;
  const rootDirectory = options.rootDirectory ?? root;

  if (env.NODE_ENV !== 'production') failures.push('NODE_ENV: must be production');
  if (!enabled(env.PUBLIC_DEPLOYMENT)) failures.push('PUBLIC_DEPLOYMENT: must be true');
  if (!SEMVER_VERSION.test(env.APP_VERSION?.trim() ?? '')) {
    failures.push('APP_VERSION: must be an explicit SemVer version such as 0.1.4');
  }

  for (const [name, protocol] of [
    ['APP_URL', 'https:'],
    ['PUBLIC_WEB_URL', 'https:'],
    ['NEXT_PUBLIC_APP_URL', 'https:'],
    ['NEXT_PUBLIC_API_URL', 'https:'],
    ['NEXT_PUBLIC_WS_URL', 'wss:'],
    ['LIVEKIT_PUBLIC_URL', 'wss:'],
    ['NEXT_PUBLIC_LIVEKIT_URL', 'wss:'],
  ]) {
    requireUrl(env, failures, name, protocol);
  }

  for (const name of [
    'NEXT_PUBLIC_LEGAL_OPERATOR_NAME',
    'NEXT_PUBLIC_LEGAL_OPERATOR_EMAIL',
    'NEXT_PUBLIC_LEGAL_OPERATOR_ADDRESS',
    'NEXT_PUBLIC_LEGAL_OPERATOR_COUNTRY',
    'NEXT_PUBLIC_LEGAL_GOVERNING_LAW',
    'SMTP_HOST',
    'SMTP_FROM',
  ]) {
    requireValue(env, failures, name, 'is required for a public production deployment');
  }

  for (const [name, reason] of [
    ['LEGAL_REVIEW_REFERENCE', 'record the approved legal-text review or ticket'],
    [
      'PRIVACY_REVIEW_REFERENCE',
      'record the approved privacy, storage and retention review or ticket',
    ],
    ['BACKUP_RESTORE_REVIEW_REFERENCE', 'record the latest restore drill for this deployment'],
    ['ALERTING_REVIEW_REFERENCE', 'record the tested alert receiver and escalation review'],
  ]) {
    requireValue(env, failures, name, reason);
  }

  const nginxConfig = env.NGINX_CONF?.trim();
  if (!nginxConfig || !nginxConfig.endsWith('nginx.ssl.conf')) {
    failures.push('NGINX_CONF: must select the generated TLS configuration');
  }

  const billing = enabled(env.FEATURE_BILLING_ENABLED);
  const payouts = enabled(env.FEATURE_PAYOUTS_ENABLED);
  const paidControls = enabled(env.FEATURE_PAID_CONTROLS_ENABLED);
  const subscriptions = enabled(env.FEATURE_SUBSCRIPTIONS_ENABLED);

  if (billing) {
    requireValue(
      env,
      failures,
      'BILLING_PROVIDER_REVIEW_REFERENCE',
      'record the successful provider sandbox acceptance',
    );
    if (
      !configured(env, 'STRIPE_SECRET_KEY') &&
      !configured(env, 'STRIPE_SECRET_KEY_FILE') &&
      !configured(env, 'PAYPAL_CLIENT_ID')
    ) {
      failures.push('FEATURE_BILLING_ENABLED: requires a configured Stripe or PayPal provider');
    }
    if (configured(env, 'PAYPAL_CLIENT_ID')) {
      if (env.PAYPAL_ENV?.trim().toLowerCase() !== 'live') {
        failures.push('PAYPAL_ENV: must be live when billing is enabled for public production');
      }
      requireValue(
        env,
        failures,
        'PAYPAL_LIVE_REVIEW_REFERENCE',
        'record the successful PayPal live-account acceptance',
      );
    }
    if (configured(env, 'STRIPE_SECRET_KEY') || configured(env, 'STRIPE_SECRET_KEY_FILE')) {
      requireValue(
        env,
        failures,
        'STRIPE_LIVE_REVIEW_REFERENCE',
        'record the successful Stripe live-account acceptance',
      );
    }
  } else {
    notices.push('Billing remains disabled.');
  }

  if (payouts) {
    requireValue(
      env,
      failures,
      'PAYOUT_OPERATIONS_REVIEW_REFERENCE',
      'record the approved KYC, tax and three-actor payout run',
    );
  } else {
    notices.push('Payouts remain disabled.');
  }

  if (paidControls) {
    requireValue(
      env,
      failures,
      'ROBOT_SAFETY_REVIEW_REFERENCE',
      'record the physical control, camera and emergency-stop acceptance',
    );
  } else {
    notices.push('Paid controls remain disabled.');
  }

  if (subscriptions) {
    failures.push(
      'FEATURE_SUBSCRIPTIONS_ENABLED: subscriptions are not release-enabled and must remain false',
    );
  }

  if (checkFiles) {
    for (const [envName, fileName] of [
      ['DATABASE_URL_FILE', 'api_database_url'],
      ['REDIS_PASSWORD_FILE', 'redis_password'],
      ['JWT_SECRET_FILE', 'jwt_secret'],
      ['JWT_REFRESH_SECRET_FILE', 'jwt_refresh_secret'],
      ['ROBOT_JWT_SECRET_FILE', 'robot_jwt_secret'],
      ['WEBHOOK_SECRET_ENCRYPTION_KEY_FILE', 'webhook_secret_encryption_key'],
      ['LIVEKIT_API_SECRET_FILE', 'livekit_api_secret'],
      ['METRICS_PASSWORD_FILE', 'metrics_password'],
      ['OBJECT_STORAGE_SECRET_ACCESS_KEY_FILE', 'object_storage_secret_access_key'],
      ['BACKUP_ENCRYPTION_KEY_FILE', 'backup_encryption_key'],
      ['ALERTMANAGER_WEBHOOK_URL_FILE', 'alertmanager_webhook_url'],
    ]) {
      requireReadableFile(env, failures, envName, fileName, rootDirectory);
    }
    if (payouts)
      requireReadableFile(
        env,
        failures,
        'PAYOUT_DESTINATION_ENCRYPTION_KEY_FILE',
        'payout_destination_encryption_key',
        rootDirectory,
      );
    if (billing && configured(env, 'STRIPE_SECRET_KEY_FILE')) {
      requireReadableFile(
        env,
        failures,
        'STRIPE_SECRET_KEY_FILE',
        'stripe_secret_key',
        rootDirectory,
      );
      requireReadableFile(
        env,
        failures,
        'STRIPE_WEBHOOK_SECRET_FILE',
        'stripe_webhook_secret',
        rootDirectory,
      );
    }
    if (billing && configured(env, 'PAYPAL_CLIENT_ID')) {
      requireReadableFile(
        env,
        failures,
        'PAYPAL_CLIENT_SECRET_FILE',
        'paypal_client_secret',
        rootDirectory,
      );
      requireReadableFile(
        env,
        failures,
        'PAYPAL_WEBHOOK_ID_FILE',
        'paypal_webhook_id',
        rootDirectory,
      );
    }
    for (const certificate of ['docker/nginx/ssl/fullchain.pem', 'docker/nginx/ssl/privkey.pem']) {
      try {
        accessSync(resolve(rootDirectory, certificate), constants.R_OK);
      } catch {
        failures.push(`${certificate}: is not readable`);
      }
    }
  }

  return { failures, notices };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { failures, notices } = evaluateProductionReadiness(process.env);
  for (const notice of notices) console.log(`- ${notice}`);
  if (failures.length > 0) {
    console.error('Production preflight failed:');
    for (const failure of failures) console.error(`- ${failure}`);
    process.exitCode = 1;
  } else {
    console.log(
      'Production preflight passed. Required deployment approvals and local files are present.',
    );
  }
}
