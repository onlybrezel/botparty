import { createCipheriv, createHash, createHmac, randomBytes } from 'node:crypto';
import { createPrismaClient } from '../packages/prisma/client.js';

const activeSecret = process.env.WEBHOOK_SECRET_ENCRYPTION_KEY?.trim();
if (!activeSecret || activeSecret.length < 32) {
  throw new Error('WEBHOOK_SECRET_ENCRYPTION_KEY with at least 32 characters is required');
}
const legacySecret = process.env.WEBHOOK_SECRET_LEGACY_KEY?.trim() || activeSecret;
const activeKey = createHash('sha256').update(activeSecret, 'utf8').digest();
const activeKeyId = createHash('sha256').update(activeKey).digest('hex').slice(0, 12);
const prisma = createPrismaClient();

function decodeLegacy(webhookId, stored) {
  if (/^[a-f0-9]{64}$/i.test(stored)) return stored.toLowerCase();
  if (stored.startsWith('v1.')) return null;
  const encrypted = Buffer.from(stored, 'base64url');
  if (encrypted.length !== 32) throw new Error(`Webhook ${webhookId} has an unsupported secret format`);
  const keyStream = createHmac('sha256', legacySecret).update(webhookId).digest();
  const plain = Buffer.alloc(encrypted.length);
  for (let index = 0; index < encrypted.length; index += 1) {
    plain[index] = encrypted[index] ^ keyStream[index % keyStream.length];
  }
  return plain.toString('hex');
}

function encrypt(webhookId, plaintext) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', activeKey, nonce);
  cipher.setAAD(Buffer.from(`robot-webhook:${webhookId}`, 'utf8'));
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return [
    'v1',
    activeKeyId,
    nonce.toString('base64url'),
    encrypted.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
  ].join('.');
}

try {
  let migrated = 0;
  for (;;) {
    const hooks = await prisma.robotWebhook.findMany({
      where: { NOT: { secret: { startsWith: 'v1.' } } },
      select: { id: true, secret: true },
      take: 100,
      orderBy: { id: 'asc' },
    });
    if (hooks.length === 0) break;
    await prisma.$transaction(
      hooks.map((hook) => {
        const plaintext = decodeLegacy(hook.id, hook.secret);
        if (!plaintext) throw new Error(`Webhook ${hook.id} could not be migrated`);
        return prisma.robotWebhook.update({
          where: { id: hook.id },
          data: { secret: encrypt(hook.id, plaintext) },
        });
      }),
    );
    migrated += hooks.length;
  }
  console.log(`Webhook secret migration complete (${migrated} migrated).`);
} finally {
  await prisma.$disconnect();
}
