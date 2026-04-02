'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Save, UserRound, Eye, EyeOff } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/store';
import { pushToast } from '@/lib/toast';

const PREF_KEY = 'botparty.settings.v1';

type LocalSettings = {
  dashboardMaskToken: boolean;
  keyboardTabSwitchOnlyWhenEmpty: boolean;
};

const DEFAULT_SETTINGS: LocalSettings = {
  dashboardMaskToken: true,
  keyboardTabSwitchOnlyWhenEmpty: true,
};

export default function SettingsPage() {
  const router = useRouter();
  const auth = useAuth();
  const { accessToken } = auth;

  const [displayName, setDisplayName] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [prefs, setPrefs] = useState<LocalSettings>(DEFAULT_SETTINGS);
  const [showAvatar, setShowAvatar] = useState(false);

  useEffect(() => {
    if (!accessToken) {
      router.replace('/login');
      return;
    }

    const rawPrefs = window.localStorage.getItem(PREF_KEY);
    if (rawPrefs) {
      try {
        const parsed = JSON.parse(rawPrefs) as Partial<LocalSettings>;
        setPrefs({ ...DEFAULT_SETTINGS, ...parsed });
      } catch {
        setPrefs(DEFAULT_SETTINGS);
      }
    }

    api.setToken(accessToken);
    api
      .getMe()
      .then((me) => {
        setDisplayName(me.displayName ?? '');
        setAvatarUrl(me.avatarUrl ?? '');
      })
      .catch(() => {
        pushToast('Profil konnte nicht geladen werden.', 'error');
      })
      .finally(() => setLoading(false));
  }, [accessToken, router]);

  const savePrefs = (next: LocalSettings) => {
    setPrefs(next);
    window.localStorage.setItem(PREF_KEY, JSON.stringify(next));
    pushToast('Lokale Einstellungen gespeichert.', 'success');
  };

  const handleSaveProfile = async (event: FormEvent) => {
    event.preventDefault();
    if (!accessToken) return;

    setSaving(true);
    try {
      api.setToken(accessToken);
      const me = await api.updateMe({
        displayName,
        avatarUrl,
      });

      auth.setSession({ displayName: me.displayName ?? null });
      pushToast('Profil aktualisiert.', 'success');
    } catch (err) {
      pushToast(err instanceof Error ? err.message : 'Profil konnte nicht gespeichert werden.', 'error');
    } finally {
      setSaving(false);
    }
  };

  if (!accessToken) return null;

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <section className="mb-6 rounded-2xl border border-[var(--border)] bg-[var(--card)] p-6">
        <h1 className="text-3xl font-black tracking-tight">Settings</h1>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">
          Profil und lokale Dashboard-Praeferenzen.
        </p>
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <form onSubmit={handleSaveProfile} className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-5">
          <h2 className="mb-4 flex items-center gap-2 text-lg font-bold">
            <UserRound className="h-5 w-5 text-sky-300" />
            Account
          </h2>

          {loading ? (
            <p className="text-sm text-[var(--muted-foreground)]">Lade Profil...</p>
          ) : (
            <>
              <label className="mb-2 block text-sm font-medium">Display Name</label>
              <input
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                className="mb-4 w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
                maxLength={64}
              />

              <label className="mb-2 block text-sm font-medium">Avatar URL</label>
              <div className="mb-4 flex gap-2">
                <input
                  type={showAvatar ? 'text' : 'password'}
                  value={avatarUrl}
                  onChange={(event) => setAvatarUrl(event.target.value)}
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
                  maxLength={512}
                />
                <button
                  type="button"
                  onClick={() => setShowAvatar((prev) => !prev)}
                  className="rounded-lg border border-[var(--border)] px-3"
                  aria-label="Avatar URL anzeigen"
                >
                  {showAvatar ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>

              <button
                type="submit"
                disabled={saving}
                className="inline-flex items-center gap-2 rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
              >
                <Save className="h-4 w-4" />
                {saving ? 'Speichern...' : 'Profil speichern'}
              </button>
            </>
          )}
        </form>

        <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-5">
          <h2 className="mb-4 text-lg font-bold">Lokale Dashboard-Optionen</h2>

          <div className="space-y-3 text-sm">
            <label className="flex cursor-pointer items-center justify-between rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2">
              <span>Claim Token standardmaessig ausblenden</span>
              <input
                type="checkbox"
                checked={prefs.dashboardMaskToken}
                onChange={(event) =>
                  savePrefs({
                    ...prefs,
                    dashboardMaskToken: event.target.checked,
                  })
                }
              />
            </label>

            <label className="flex cursor-pointer items-center justify-between rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2">
              <span>TAB im Chat wechselt nur bei leerem Feld</span>
              <input
                type="checkbox"
                checked={prefs.keyboardTabSwitchOnlyWhenEmpty}
                onChange={(event) =>
                  savePrefs({
                    ...prefs,
                    keyboardTabSwitchOnlyWhenEmpty: event.target.checked,
                  })
                }
              />
            </label>
          </div>
        </div>
      </section>
    </div>
  );
}
