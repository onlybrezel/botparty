import { expect, test, type APIRequestContext } from '@playwright/test';
import { randomBytes } from 'node:crypto';
import { LEGAL_POLICY_VERSIONS } from '@botparty/shared';

const API_PREFIX = '/api/v1';
const PRIVATE_THUMBNAIL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVQImWPQSDnxH4QZYAwATewJTUPIsxsAAAAASUVORK5CYII=';

type RegisteredAccount = {
  context: APIRequestContext;
  token: string;
  username: string;
  userId: string;
};

async function registerAccount(
  context: APIRequestContext,
  identity: string,
): Promise<RegisteredAccount> {
  const username = `audit_${identity}`;
  const response = await context.post(`${API_PREFIX}/auth/register`, {
    data: {
      username,
      email: `${username}@example.test`,
      password: 'OwnerIsolation!2026',
      acceptedTermsVersion: LEGAL_POLICY_VERSIONS.TERMS,
      acceptedPrivacyVersion: LEGAL_POLICY_VERSIONS.PRIVACY,
    },
  });
  expect(response.status()).toBe(201);
  const body = (await response.json()) as { accessToken: string; user: { id: string } };
  expect(body.accessToken).toBeTruthy();
  expect(body.user.id).toBeTruthy();
  return { context, token: body.accessToken, username, userId: body.user.id };
}

function bearer(account: RegisteredAccount, extra: Record<string, string> = {}) {
  return { Authorization: `Bearer ${account.token}`, ...extra };
}

test('private robot data and files remain isolated between owners', async ({
  playwright,
}, testInfo) => {
  const baseURL = String(testInfo.project.use.baseURL);
  const suffix = `${Date.now().toString(36)}_${randomBytes(3).toString('hex')}`;
  const ownerContext = await playwright.request.newContext({ baseURL });
  const foreignContext = await playwright.request.newContext({ baseURL });
  const anonymousContext = await playwright.request.newContext({ baseURL });

  try {
    const owner = await registerAccount(ownerContext, `owner_${suffix}`);
    const foreign = await registerAccount(foreignContext, `foreign_${suffix}`);
    const avatarUpload = await ownerContext.post(`${API_PREFIX}/users/me/avatar`, {
      headers: bearer(owner),
      data: { dataUrl: PRIVATE_THUMBNAIL },
    });
    expect(avatarUpload.status()).toBe(201);
    const avatarProfile = (await avatarUpload.json()) as { avatarUrl: string };
    expect(avatarProfile.avatarUrl).toBe(`${API_PREFIX}/users/${owner.userId}/avatar-image`);
    const avatarImage = await anonymousContext.get(avatarProfile.avatarUrl);
    expect(avatarImage.status()).toBe(200);
    expect(avatarImage.headers()['content-type']).toContain('image/webp');
    const clearedAvatar = await ownerContext.delete(`${API_PREFIX}/users/me/avatar`, {
      headers: bearer(owner),
    });
    expect(clearedAvatar.status()).toBe(200);
    expect((await anonymousContext.get(avatarProfile.avatarUrl)).status()).toBe(404);
    const restoredAvatar = await ownerContext.post(`${API_PREFIX}/users/me/avatar`, {
      headers: bearer(owner),
      data: { dataUrl: PRIVATE_THUMBNAIL },
    });
    expect(restoredAvatar.status()).toBe(201);

    const slug = `private-${suffix.replaceAll('_', '-').toLowerCase()}`.slice(0, 50);
    const created = await ownerContext.post(`${API_PREFIX}/robots`, {
      headers: bearer(owner),
      data: { name: 'Private isolation robot', slug, visibility: 'PRIVATE' },
    });
    expect(created.status()).toBe(201);
    const robot = (await created.json()) as { id: string };
    expect(robot.id).toBeTruthy();

    const uploaded = await ownerContext.post(`${API_PREFIX}/robots/${robot.id}/thumbnail`, {
      headers: bearer(owner),
      data: { dataUrl: PRIVATE_THUMBNAIL },
    });
    expect(uploaded.status()).toBe(201);

    const ownerThumbnail = await ownerContext.get(
      `${API_PREFIX}/robots/${robot.id}/thumbnail-image`,
      { headers: bearer(owner) },
    );
    expect(ownerThumbnail.status()).toBe(200);
    expect(ownerThumbnail.headers()['content-type']).toContain('image/webp');
    expect(ownerThumbnail.headers()['cache-control']).toBe('private, no-store');

    const hiddenRequests = [
      foreignContext.get(`${API_PREFIX}/robots/private/${slug}`, { headers: bearer(foreign) }),
      foreignContext.put(`${API_PREFIX}/robots/${robot.id}`, {
        headers: bearer(foreign),
        data: { name: 'Stolen robot' },
      }),
      foreignContext.delete(`${API_PREFIX}/robots/${robot.id}`, { headers: bearer(foreign) }),
      foreignContext.get(`${API_PREFIX}/robots/${robot.id}/allowed-users`, {
        headers: bearer(foreign),
      }),
      foreignContext.get(`${API_PREFIX}/robots/${robot.id}/onboarding`, {
        headers: bearer(foreign),
      }),
      foreignContext.post(`${API_PREFIX}/robots/${robot.id}/access/verify`, {
        headers: bearer(foreign),
        data: {},
      }),
      foreignContext.get(`${API_PREFIX}/robots/${robot.id}/chat-messages`, {
        headers: bearer(foreign),
      }),
      foreignContext.get(`${API_PREFIX}/robots/${robot.id}/thumbnail-image`, {
        headers: bearer(foreign),
      }),
      foreignContext.get(`${API_PREFIX}/sessions/robot/${robot.id}`, {
        headers: bearer(foreign),
      }),
      foreignContext.get(`${API_PREFIX}/queue/${robot.id}`, { headers: bearer(foreign) }),
      foreignContext.get(`${API_PREFIX}/controls/robot/${robot.id}`, {
        headers: bearer(foreign),
      }),
      foreignContext.post(`${API_PREFIX}/livekit/token/viewer/${robot.id}`, {
        headers: bearer(foreign),
      }),
      anonymousContext.get(`${API_PREFIX}/robots/${robot.id}/thumbnail-image`),
      anonymousContext.get(`${API_PREFIX}/robots/${slug}`),
      anonymousContext.get(`${API_PREFIX}/robots/${owner.username}/${slug}`),
    ];
    const hiddenResponses = await Promise.all(hiddenRequests);
    expect(hiddenResponses.map((response) => response.status())).toEqual(
      Array(hiddenResponses.length).fill(404),
    );

    const forgedRole = await foreignContext.put(`${API_PREFIX}/robots/admin/${robot.id}`, {
      headers: bearer(foreign, { 'x-user-role': 'ADMIN' }),
      data: { name: 'Forged admin update' },
    });
    expect(forgedRole.status()).toBe(403);

    const ownerUpdate = await ownerContext.put(`${API_PREFIX}/robots/${robot.id}`, {
      headers: bearer(owner),
      data: { name: 'Owner controlled robot' },
    });
    expect(ownerUpdate.status()).toBe(200);

    const foreignDeletion = await foreignContext.delete(`${API_PREFIX}/users/me`, {
      headers: bearer(foreign),
    });
    expect(foreignDeletion.status()).toBe(204);
    const revokedForeignToken = await foreignContext.get(`${API_PREFIX}/users/me`, {
      headers: bearer(foreign),
    });
    expect(revokedForeignToken.status()).toBe(401);

    const ownerDeletion = await ownerContext.delete(`${API_PREFIX}/users/me`, {
      headers: bearer(owner),
    });
    expect(ownerDeletion.status()).toBe(204);
    const revokedOwnerToken = await ownerContext.get(`${API_PREFIX}/users/me`, {
      headers: bearer(owner),
    });
    expect(revokedOwnerToken.status()).toBe(401);
  } finally {
    await Promise.all([
      ownerContext.dispose(),
      foreignContext.dispose(),
      anonymousContext.dispose(),
    ]);
  }
});
