import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'crypto';

type KeyEntry = { id: string; key: Buffer };

function keyEntry(raw: string): KeyEntry {
  const key = createHash('sha256').update(raw, 'utf8').digest();
  return { id: createHash('sha256').update(key).digest('hex').slice(0, 12), key };
}

export class AeadCipher {
  private readonly active: KeyEntry;
  private readonly keys: Map<string, Buffer>;

  constructor(activeKey: string, previousKeys: string[] = []) {
    if (activeKey.trim().length < 32) {
      throw new Error('Encryption key must contain at least 32 characters.');
    }
    this.active = keyEntry(activeKey.trim());
    const entries = [this.active, ...previousKeys.filter(Boolean).map(keyEntry)];
    this.keys = new Map(entries.map((entry) => [entry.id, entry.key]));
  }

  encrypt(plaintext: string, associatedData: string): string {
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.active.key, nonce);
    cipher.setAAD(Buffer.from(associatedData, 'utf8'));
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return ['v1', this.active.id, nonce.toString('base64url'), encrypted.toString('base64url'), tag.toString('base64url')].join('.');
  }

  decrypt(ciphertext: string, associatedData: string): { plaintext: string; needsRotation: boolean } {
    const [version, keyId, nonceText, encryptedText, tagText, extra] = ciphertext.split('.');
    if (version !== 'v1' || !keyId || !nonceText || encryptedText === undefined || !tagText || extra) {
      throw new Error('Unsupported encrypted value format.');
    }
    const key = this.keys.get(keyId);
    if (!key) throw new Error(`Unknown encryption key id ${keyId}.`);
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(nonceText, 'base64url'));
    decipher.setAAD(Buffer.from(associatedData, 'utf8'));
    decipher.setAuthTag(Buffer.from(tagText, 'base64url'));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(encryptedText, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
    return { plaintext, needsRotation: !timingSafeEqual(key, this.active.key) };
  }
}
