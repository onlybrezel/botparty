'use client';

import type { ChangeEvent, FormEvent } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { BellRing, Palette, Save, ShieldAlert, UserRound, ImagePlus, Trash2, Cookie, LogOut } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/store';
import { pushToast } from '@/lib/toast';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Dialog } from '@/components/ui/dialog';
import { usePreferences } from '@/lib/preferences';
import type { NotificationPreferenceRecord } from '@/lib/api/notifications';

const defaultNotificationPreferences: NotificationPreferenceRecord = {
  inAppEnabled: true,
  browserEnabled: false,
  emailTurn: true,
  emailRobot: true,
  emailFinance: true,
  quietStartMin: null,
  quietEndMin: null,
  timezone: 'UTC',
};

const minutesToTime = (minutes: number | null) => minutes === null
  ? ''
  : `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

const timeToMinutes = (value: string) => {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
};

export default function SettingsPage() {
  const router = useRouter();
  const auth = useAuth();
  const { accessToken, hasHydrated } = auth;
  const {
    theme,
    dashboardMaskToken,
    queuePositionNotifications,
    queueTurnNotifications,
    productAnalyticsEnabled,
    updatePreference,
  } = usePreferences();

  const [displayName, setDisplayName] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [exportingData, setExportingData] = useState(false);
  const [exportPassword, setExportPassword] = useState('');
  const [revokingSessions, setRevokingSessions] = useState(false);
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission | 'unsupported'>(
    'default',
  );
  const [notificationPreferences, setNotificationPreferences] = useState(defaultNotificationPreferences);

  useEffect(() => {
    if (!hasHydrated) {
      return;
    }

    if (!accessToken) {
      router.replace('/login');
      return;
    }

    if (typeof window !== 'undefined') {
      setNotificationPermission('Notification' in window ? Notification.permission : 'unsupported');
    }

    api.setToken(accessToken);
    api
      .users.getMe()
      .then((me) => {
        setDisplayName(me.displayName ?? '');
        setAvatarUrl(me.avatarUrl ?? '');
      })
      .catch(() => {
        pushToast('Failed to load profile.', 'error');
      })
      .finally(() => setLoading(false));
    void api.notifications.preferences().then(setNotificationPreferences).catch((error: unknown) => console.error('Failed to load notification preferences', error));
    void api.analytics.consent().then(({ productAnalyticsEnabled }) => updatePreference('productAnalyticsEnabled', productAnalyticsEnabled)).catch((error: unknown) => console.error('Failed to load analytics consent', error));
  }, [accessToken, hasHydrated, router, updatePreference]);

  const notificationSummary = useMemo(() => {
    if (notificationPermission === 'unsupported') {
      return 'This browser does not support desktop notifications.';
    }
    if (notificationPermission === 'granted') {
      return 'Desktop notifications are enabled for queue updates and turn handoff.';
    }
    if (notificationPermission === 'denied') {
      return 'Notifications are blocked in this browser. Update browser site permissions to enable them.';
    }
    return 'Enable desktop notifications to get queue updates when another tab is active.';
  }, [notificationPermission]);

  const handleSaveProfile = async (event: FormEvent) => {
    event.preventDefault();
    if (!accessToken) return;

    setSaving(true);
    try {
      api.setToken(accessToken);
      const me = await api.users.updateMe({
        displayName,
      });

      auth.setSession({ displayName: me.displayName ?? null, role: me.role });
      pushToast('Profile updated.', 'success');
    } catch (err) {
      pushToast(err instanceof Error ? err.message : 'Failed to save profile.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleAvatarUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !accessToken) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      pushToast('Choose a PNG, JPEG, or WebP image.', 'error');
      return;
    }
    if (file.size > 750 * 1024) {
      pushToast('The image must be 750 KB or smaller.', 'error');
      return;
    }

    setAvatarUploading(true);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Invalid image'));
        reader.onerror = () => reject(reader.error ?? new Error('Could not read image'));
        reader.readAsDataURL(file);
      });
      api.setToken(accessToken);
      const me = await api.users.uploadAvatar(dataUrl);
      setAvatarUrl(me.avatarUrl ?? '');
      pushToast('Profile photo updated.', 'success');
    } catch (err) {
      pushToast(err instanceof Error ? err.message : 'Failed to upload profile photo.', 'error');
    } finally {
      setAvatarUploading(false);
    }
  };

  const handleAvatarDelete = async () => {
    if (!accessToken) return;
    setAvatarUploading(true);
    try {
      api.setToken(accessToken);
      await api.users.deleteAvatar();
      setAvatarUrl('');
      pushToast('Profile photo removed.', 'success');
    } catch (err) {
      pushToast(err instanceof Error ? err.message : 'Failed to remove profile photo.', 'error');
    } finally {
      setAvatarUploading(false);
    }
  };

  const requestNotificationPermission = async () => {
    if (typeof window === 'undefined' || !('Notification' in window)) {
      setNotificationPermission('unsupported');
      return;
    }

    const permission = await Notification.requestPermission();
    setNotificationPermission(permission);
    if (permission === 'granted') {
      const updated = await api.notifications.updatePreferences({ browserEnabled: true });
      setNotificationPreferences(updated);
    }
    pushToast(
      permission === 'granted' ? 'Desktop notifications enabled.' : 'Desktop notifications not enabled.',
      permission === 'granted' ? 'success' : 'info',
    );
  };

  const updateNotifications = async (input: Partial<NotificationPreferenceRecord>) => {
    try {
      const updated = await api.notifications.updatePreferences(input);
      setNotificationPreferences(updated);
    } catch (error) {
      pushToast(error instanceof Error ? error.message : 'Could not save notification preferences.', 'error');
    }
  };

  const updateAnalyticsConsent = async (enabled: boolean) => {
    try {
      const result = await api.analytics.setConsent(enabled);
      updatePreference('productAnalyticsEnabled', result.productAnalyticsEnabled);
      pushToast(result.productAnalyticsEnabled ? 'Product analytics enabled.' : 'Product analytics disabled and prior events deleted.', 'success');
    } catch (error) {
      pushToast(error instanceof Error ? error.message : 'Could not save analytics preference.', 'error');
    }
  };

  const handleDeleteAccount = async () => {
    if (!accessToken) {
      return;
    }

    setDeletingAccount(true);
    try {
      api.setToken(accessToken);
      await api.users.deleteMe();
      auth.logout();
      router.push('/');
    } catch (err) {
      pushToast(err instanceof Error ? err.message : 'Failed to delete account.', 'error');
      setDeletingAccount(false);
    }
  };

  const handleExportData = async () => {
    if (!accessToken) {
      return;
    }

    setExportingData(true);
    try {
      api.setToken(accessToken);
      const payload = await api.users.exportMe(exportPassword);
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `botparty-export-${payload.profile.username}-${payload.exportedAt.slice(0, 10)}.json`;
      link.click();
      URL.revokeObjectURL(url);
      pushToast('Account export downloaded.', 'success');
      setExportPassword('');
    } catch (err) {
      pushToast(err instanceof Error ? err.message : 'Failed to export account data.', 'error');
    } finally {
      setExportingData(false);
    }
  };

  const handleRevokeAllSessions = async () => {
    if (!accessToken) return;
    if (!window.confirm('Sign out of every browser and device that is currently logged in?')) {
      return;
    }
    setRevokingSessions(true);
    try {
      api.setToken(accessToken);
      await api.auth.logoutAll();
      pushToast('Signed out from all devices.', 'success');
      auth.logout();
      router.push('/login');
    } catch (err) {
      pushToast(err instanceof Error ? err.message : 'Failed to sign out everywhere.', 'error');
      setRevokingSessions(false);
    }
  };

  if (!hasHydrated || !accessToken) return null;

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <section className="mb-6 rounded-2xl border border-[var(--border)] bg-[var(--card)] p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-3xl font-black tracking-tight">Settings</h1>
            <p className="mt-1 text-sm text-[var(--muted-foreground)]">
              Manage your profile, theme, queue notifications, and local control preferences.
            </p>
          </div>
          <Badge tone="success">Local preferences synced</Badge>
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <form onSubmit={handleSaveProfile} className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-5">
          <h2 className="mb-4 flex items-center gap-2 text-lg font-bold">
            <UserRound className="h-5 w-5 text-sky-300" />
            Account
          </h2>

          {loading ? (
            <p className="text-sm text-[var(--muted-foreground)]">Loading profile...</p>
          ) : (
            <>
              <label className="mb-2 block text-sm font-medium">Display Name</label>
              <input
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                className="mb-4 w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
                maxLength={64}
                autoComplete="nickname"
              />

              <span className="mb-2 block text-sm font-medium">Profile photo</span>
              <div className="mb-4 flex items-center gap-3">
                <div
                  className="h-16 w-16 shrink-0 rounded-full border border-[var(--border)] bg-cover bg-center bg-[var(--background)]"
                  style={avatarUrl ? { backgroundImage: `url(${avatarUrl})` } : undefined}
                  aria-label={avatarUrl ? 'Current profile photo' : 'No profile photo'}
                  role="img"
                />
                <div className="flex flex-wrap gap-2">
                  <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-[var(--border)] px-3 py-2 text-sm font-medium">
                    <ImagePlus className="h-4 w-4" />
                    {avatarUploading ? 'Uploading...' : 'Choose image'}
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      className="sr-only"
                      disabled={avatarUploading}
                      onChange={(event) => void handleAvatarUpload(event)}
                    />
                  </label>
                  {avatarUrl ? (
                    <button
                      type="button"
                      onClick={() => void handleAvatarDelete()}
                      disabled={avatarUploading}
                      className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm disabled:opacity-60"
                    >
                      Remove
                    </button>
                  ) : null}
                </div>
              </div>
              <p className="mb-4 text-xs text-[var(--muted-foreground)]">PNG, JPEG or WebP, up to 750 KB.</p>

              <button
                type="submit"
                disabled={saving}
                className="inline-flex items-center gap-2 rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
              >
                <Save className="h-4 w-4" />
                {saving ? 'Saving...' : 'Save Profile'}
              </button>
            </>
          )}
        </form>

        <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-5">
          <h2 className="mb-4 flex items-center gap-2 text-lg font-bold">
            <Palette className="h-5 w-5 text-violet-300" />
            Appearance
          </h2>
          <p className="mb-4 text-sm text-[var(--muted-foreground)]">
            Choose the theme used across navigation, dashboards, and robot rooms.
          </p>
          <div className="flex flex-wrap gap-2">
            {(['system', 'dark', 'light'] as const).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => updatePreference('theme', option)}
                aria-pressed={theme === option}
              >
                <Badge tone={theme === option ? 'success' : 'default'}>
                  {option === 'system' ? 'System' : option === 'dark' ? 'Dark' : 'Light'}
                </Badge>
              </button>
            ))}
          </div>
        </div>

        <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-5">
          <h2 className="mb-4 flex items-center gap-2 text-lg font-bold">
            <Cookie className="h-5 w-5 text-emerald-300" />
            Browser storage
          </h2>
          <p className="text-sm text-[var(--muted-foreground)]">
            BotParty stores sign-in state, room grants and local preferences needed for the features you use. Product analytics is first-party and only active after you enable it.
          </p>
        </div>

        <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-5">
          <h2 className="mb-4 text-lg font-bold">Local Dashboard Options</h2>
          <div className="space-y-3">
            <Switch
              checked={dashboardMaskToken}
              onChange={(event) => updatePreference('dashboardMaskToken', event.target.checked)}
              label="Hide claim token by default"
              description="Keep robot claim tokens masked in the dashboard until explicitly revealed."
            />
          </div>
        </div>

        <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-5">
          <h2 className="mb-4 flex items-center gap-2 text-lg font-bold">
            <BellRing className="h-5 w-5 text-amber-300" />
            Notifications
          </h2>
          <p className="mb-4 text-sm text-[var(--muted-foreground)]">{notificationSummary}</p>
          <div className="space-y-3">
            <Switch
              checked={queuePositionNotifications}
              onChange={(event) => {
                updatePreference('queuePositionNotifications', event.target.checked);
                void updateNotifications({ inAppEnabled: event.target.checked });
              }}
              label="Notify when queue position changes"
              description="Useful when you are waiting in another tab."
            />
            <Switch
              checked={queueTurnNotifications}
              onChange={(event) => {
                updatePreference('queueTurnNotifications', event.target.checked);
                void updateNotifications({ browserEnabled: event.target.checked && notificationPermission === 'granted' });
              }}
              label="Notify when your turn starts"
              description="Send a desktop notification when you reach position #1."
            />
            <Switch
              checked={notificationPreferences.emailTurn}
              onChange={(event) => void updateNotifications({ emailTurn: event.target.checked })}
              label="Email for queue turns"
              description="Email when you are next or your turn starts."
            />
            <Switch
              checked={notificationPreferences.emailRobot}
              onChange={(event) => void updateNotifications({ emailRobot: event.target.checked })}
              label="Email when a robot goes offline"
              description="For robots you host."
            />
            <Switch
              checked={notificationPreferences.emailFinance}
              onChange={(event) => void updateNotifications({ emailFinance: event.target.checked })}
              label="Email for payments and payouts"
              description="Final payment and payout status updates."
            />
            <div className="grid grid-cols-2 gap-3 pt-2">
              <label className="text-xs text-[var(--muted-foreground)]">
                Quiet hours start
                <input
                  type="time"
                  value={minutesToTime(notificationPreferences.quietStartMin)}
                  onChange={(event) => {
                    const start = timeToMinutes(event.target.value);
                    void updateNotifications({
                      quietStartMin: start,
                      quietEndMin: start === null ? null : notificationPreferences.quietEndMin ?? 480,
                      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
                    });
                  }}
                  className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-2 py-1.5"
                />
              </label>
              <label className="text-xs text-[var(--muted-foreground)]">
                Quiet hours end
                <input
                  type="time"
                  value={minutesToTime(notificationPreferences.quietEndMin)}
                  onChange={(event) => {
                    const end = timeToMinutes(event.target.value);
                    void updateNotifications({
                      quietStartMin: end === null ? null : notificationPreferences.quietStartMin ?? 1320,
                      quietEndMin: end,
                      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
                    });
                  }}
                  className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-2 py-1.5"
                />
              </label>
            </div>
          </div>
          <button
            type="button"
            onClick={() => void requestNotificationPermission()}
            disabled={notificationPermission === 'unsupported' || notificationPermission === 'granted'}
            className="mt-4 rounded-lg border border-[var(--border)] px-4 py-2 text-sm font-medium disabled:opacity-50"
          >
            {notificationPermission === 'granted' ? 'Notifications enabled' : 'Enable desktop notifications'}
          </button>
        </div>

        <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-5">
          <h2 className="mb-4 text-lg font-bold">Product analytics</h2>
          <Switch
            checked={productAnalyticsEnabled}
            onChange={(event) => void updateAnalyticsConsent(event.target.checked)}
            label="Share product usage"
            description="Share first-party events such as robot views and completed turns. No advertising identifiers or third-party trackers are used. Events are deleted after 90 days; withdrawing consent deletes your prior events."
          />
        </div>

        <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-5">
          <h2 className="mb-4 text-lg font-bold">Account Data Export</h2>
          <p className="mb-4 text-sm text-[var(--muted-foreground)]">
            Download your account, robot, session, chat, moderation, analytics, wallet, billing, payout, and recording data as JSON.
          </p>
          <label className="mb-3 block text-sm">
            <span className="mb-1 block text-[var(--muted-foreground)]">Confirm your password</span>
            <input
              type="password"
              autoComplete="current-password"
              value={exportPassword}
              onChange={(event) => setExportPassword(event.target.value)}
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2"
            />
          </label>
          <button
            type="button"
            onClick={() => void handleExportData()}
            disabled={exportingData || !exportPassword}
            className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm font-medium disabled:opacity-50"
          >
            {exportingData ? 'Preparing export...' : 'Download my data'}
          </button>
        </div>

        <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-5">
          <h2 className="mb-4 flex items-center gap-2 text-lg font-bold">
            <LogOut className="h-5 w-5 text-rose-300" />
            Active Sessions
          </h2>
          <p className="mb-4 text-sm text-[var(--muted-foreground)]">
            Sign out of every device that is currently logged in. You will need to sign in again on this device too.
          </p>
          <button
            type="button"
            onClick={() => void handleRevokeAllSessions()}
            disabled={revokingSessions}
            className="inline-flex items-center gap-2 rounded-lg border border-[var(--border)] px-4 py-2 text-sm font-medium disabled:opacity-50"
          >
            <LogOut className="h-4 w-4" />
            {revokingSessions ? 'Signing out everywhere...' : 'Sign out of all devices'}
          </button>
        </div>

        <div className="rounded-xl border border-red-800/50 bg-[var(--card)] p-5 lg:col-span-2">
          <h2 className="mb-1 flex items-center gap-2 text-lg font-bold text-red-400">
            <ShieldAlert className="h-5 w-5" />
            Danger Zone
          </h2>
          <p className="mb-4 text-sm text-[var(--muted-foreground)]">
            Permanently delete your account and all associated data. This cannot be undone.
          </p>
          <button
            type="button"
            onClick={() => setDeleteDialogOpen(true)}
            className="inline-flex items-center gap-2 rounded-lg border border-red-700/60 px-4 py-2 text-sm font-semibold text-red-400 hover:bg-red-900/20"
          >
            <Trash2 className="h-4 w-4" />
            Delete my account
          </button>
        </div>
      </section>

      <Dialog
        open={deleteDialogOpen}
        onClose={() => !deletingAccount && setDeleteDialogOpen(false)}
        title="Delete account?"
        description="This permanently removes your profile, robots, and linked room data."
      >
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => void handleDeleteAccount()}
            disabled={deletingAccount}
            className="inline-flex items-center gap-2 rounded-lg bg-red-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
          >
            <Trash2 className="h-4 w-4" />
            {deletingAccount ? 'Deleting...' : 'Yes, delete everything'}
          </button>
          <button
            type="button"
            onClick={() => setDeleteDialogOpen(false)}
            disabled={deletingAccount}
            className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm disabled:opacity-60"
          >
            Cancel
          </button>
        </div>
      </Dialog>
    </div>
  );
}
