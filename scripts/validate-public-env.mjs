const required = [
  'NEXT_PUBLIC_APP_URL',
  'NEXT_PUBLIC_API_URL',
  'NEXT_PUBLIC_WS_URL',
  'NEXT_PUBLIC_LIVEKIT_URL',
  'NEXT_PUBLIC_LEGAL_OPERATOR_NAME',
  'NEXT_PUBLIC_LEGAL_OPERATOR_EMAIL',
  'NEXT_PUBLIC_LEGAL_OPERATOR_ADDRESS',
  'NEXT_PUBLIC_LEGAL_OPERATOR_COUNTRY',
  'NEXT_PUBLIC_LEGAL_GOVERNING_LAW',
];

const missing = required.filter((name) => !process.env[name]?.trim());
if (missing.length > 0) {
  throw new Error(`Missing required public build configuration: ${missing.join(', ')}`);
}

const email = process.env.NEXT_PUBLIC_LEGAL_OPERATOR_EMAIL.trim();
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  throw new Error('NEXT_PUBLIC_LEGAL_OPERATOR_EMAIL must be a valid email address.');
}

for (const name of ['NEXT_PUBLIC_APP_URL', 'NEXT_PUBLIC_API_URL']) {
  const url = new URL(process.env[name]);
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error(`${name} must use http or https.`);
  }
}

for (const name of ['NEXT_PUBLIC_WS_URL', 'NEXT_PUBLIC_LIVEKIT_URL']) {
  const url = new URL(process.env[name]);
  if (!['ws:', 'wss:'].includes(url.protocol)) {
    throw new Error(`${name} must use ws or wss.`);
  }
}

if (process.env.PUBLIC_DEPLOYMENT === 'true') {
  for (const name of ['NEXT_PUBLIC_APP_URL', 'NEXT_PUBLIC_API_URL']) {
    if (new URL(process.env[name]).protocol !== 'https:') {
      throw new Error(`${name} must use https for a public deployment.`);
    }
  }
  for (const name of ['NEXT_PUBLIC_WS_URL', 'NEXT_PUBLIC_LIVEKIT_URL']) {
    if (new URL(process.env[name]).protocol !== 'wss:') {
      throw new Error(`${name} must use wss for a public deployment.`);
    }
  }
}
