import { timingSafeEqual } from 'crypto';

type BasicAuthCredentials = {
  username: string;
  password: string;
};

function decodeBasicAuth(header: string | undefined): BasicAuthCredentials | null {
  if (!header?.startsWith('Basic ')) {
    return null;
  }

  try {
    const decoded = Buffer.from(header.slice('Basic '.length), 'base64').toString('utf8');
    const separatorIndex = decoded.indexOf(':');
    if (separatorIndex < 0) {
      return null;
    }

    return {
      username: decoded.slice(0, separatorIndex),
      password: decoded.slice(separatorIndex + 1),
    };
  } catch {
    return null;
  }
}

export function hasBasicAuthCredentials(
  username: string | null | undefined,
  password: string | null | undefined,
): username is string {
  return Boolean(username?.trim()) && Boolean(password?.trim());
}

export function isAuthorizedBasicAuth(
  header: string | undefined,
  expected: BasicAuthCredentials,
): boolean {
  const provided = decodeBasicAuth(header);
  if (!provided) {
    return false;
  }

  const usernameBuffer = Buffer.from(provided.username);
  const expectedUsernameBuffer = Buffer.from(expected.username);
  const passwordBuffer = Buffer.from(provided.password);
  const expectedPasswordBuffer = Buffer.from(expected.password);

  return (
    usernameBuffer.length === expectedUsernameBuffer.length
    && passwordBuffer.length === expectedPasswordBuffer.length
    && timingSafeEqual(usernameBuffer, expectedUsernameBuffer)
    && timingSafeEqual(passwordBuffer, expectedPasswordBuffer)
  );
}
