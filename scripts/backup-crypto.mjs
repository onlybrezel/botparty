import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import { createReadStream, createWriteStream, promises as fs } from 'node:fs';
import { once } from 'node:events';

const MAGIC = Buffer.from('BOTPBACKUPv1\0\0\0\0');
const SALT_BYTES = 16;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const HEADER_BYTES = MAGIC.length + SALT_BYTES + IV_BYTES;

async function writeChunk(stream, chunk) {
  if (chunk.length > 0 && !stream.write(chunk)) {
    await once(stream, 'drain');
  }
}

async function closeStream(stream) {
  stream.end();
  await once(stream, 'close');
}

async function readKey(path) {
  const key = (await fs.readFile(path, 'utf8')).trim();
  if (key.length < 32) {
    throw new Error('Backup encryption key must contain at least 32 characters');
  }
  return key;
}

async function encrypt(inputPath, outputPath, keyPath) {
  const keyText = await readKey(keyPath);
  const salt = randomBytes(SALT_BYTES);
  const iv = randomBytes(IV_BYTES);
  const key = scryptSync(keyText, salt, 32, { N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 });
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const output = createWriteStream(outputPath, { flags: 'wx', mode: 0o600 });
  try {
    await writeChunk(output, Buffer.concat([MAGIC, salt, iv]));
    for await (const chunk of createReadStream(inputPath)) {
      await writeChunk(output, cipher.update(chunk));
    }
    await writeChunk(output, cipher.final());
    await writeChunk(output, cipher.getAuthTag());
    await closeStream(output);
  } catch (error) {
    output.destroy();
    await fs.rm(outputPath, { force: true });
    throw error;
  }
}

async function decrypt(inputPath, outputPath, keyPath) {
  const keyText = await readKey(keyPath);
  const stat = await fs.stat(inputPath);
  if (stat.size <= HEADER_BYTES + TAG_BYTES) {
    throw new Error('Encrypted backup is truncated');
  }
  const handle = await fs.open(inputPath, 'r');
  const header = Buffer.alloc(HEADER_BYTES);
  const tag = Buffer.alloc(TAG_BYTES);
  try {
    await handle.read({ buffer: header, position: 0 });
    await handle.read({ buffer: tag, position: stat.size - TAG_BYTES });
  } finally {
    await handle.close();
  }
  if (!header.subarray(0, MAGIC.length).equals(MAGIC)) {
    throw new Error('Unsupported encrypted backup format');
  }
  const salt = header.subarray(MAGIC.length, MAGIC.length + SALT_BYTES);
  const iv = header.subarray(MAGIC.length + SALT_BYTES, HEADER_BYTES);
  const key = scryptSync(keyText, salt, 32, { N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 });
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const output = createWriteStream(outputPath, { flags: 'wx', mode: 0o600 });
  try {
    for await (const chunk of createReadStream(inputPath, {
      start: HEADER_BYTES,
      end: stat.size - TAG_BYTES - 1,
    })) {
      await writeChunk(output, decipher.update(chunk));
    }
    await writeChunk(output, decipher.final());
    await closeStream(output);
  } catch (error) {
    output.destroy();
    await fs.rm(outputPath, { force: true });
    throw new Error('Backup authentication failed; the key is wrong or the archive is damaged', { cause: error });
  }
}

const [operation, inputPath, outputPath, keyPath] = process.argv.slice(2);
if (!['encrypt', 'decrypt'].includes(operation) || !inputPath || !outputPath || !keyPath) {
  console.error('usage: node backup-crypto.mjs <encrypt|decrypt> <input> <output> <key-file>');
  process.exit(64);
}

if (operation === 'encrypt') {
  await encrypt(inputPath, outputPath, keyPath);
} else {
  await decrypt(inputPath, outputPath, keyPath);
}
