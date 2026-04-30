'use client';

import type { FormEvent } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { BellRing, Palette, Save, ShieldAlert, UserRound, Eye, EyeOff, Trash2, Cookie, LogOut } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/store';
import { pushToast } from '@/lib/toast';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Dialog } from '@/components/ui/dialog';
import { usePreferences } from '@/lib/preferences';

export default function SettingsPage() {
  const router = useRouter();
  const auth = useAuth();
  const { accessToken, hasHydrated } = auth;
  const {
    theme,
    cookieConsent,
    dashboardMaskToken,
    keyboardTabSwitchOnlyWhenEmpty,
    queuePositionNotifications,
    queueTurnNotifications,
    updatePreference,
  } = usePreferences();

  const [displayName, setDisplayName] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showAvatar, setShowAvatar] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [exportingData, setExportingData] = useState(false);
  const [revokingSessions, setRevokingSessions] = useState(false);
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission | 'unsupported'>(
    'default',
  );

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
  }, [accessToken, hasHydrated, router]);

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

  const cookieConsentSummary = useMemo(() => {
    if (cookieConsent === 'accepted') {
      return 'You accepted the cookie notice. BotParty still only uses essential browser storage today.';
    }
    if (cookieConsent === 'declined') {
      return 'You declined optional acknowledgement. Only essential browser storage remains active.';
    }
    return 'You have not responded to the cookie notice yet.';
  }, [cookieConsent]);

  const handleSaveProfile = async (event: FormEvent) => {
    event.preventDefault();
    if (!accessToken) return;

    setSaving(true);
    try {
      api.setToken(accessToken);
      const me = await api.users.updateMe({
        displayName,
        avatarUrl,
      });

      auth.setSession({ displayName: me.displayName ?? null, role: me.role });
      pushToast('Profile updated.', 'success');
    } catch (err) {
      pushToast(err instanceof Error ? err.message : 'Failed to save profile.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const requestNotificationPermission = async () => {
    if (typeof window === 'undefined' || !('Notification' in window)) {
      setNotificationPermission('unsupported');
      return;
    }

    const permission = await Notification.requestPermission();
    setNotificationPermission(permission);
    pushToast(
      permission === 'granted' ? 'Desktop notifications enabled.' : 'Desktop notifications not enabled.',
      permission === 'granted' ? 'success' : 'info',
    );
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
      const payload = await api.users.exportMe();
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `botparty-export-${payload.profile.username}-${payload.exportedAt.slice(0, 10)}.json`;
      link.click();
      URL.revokeObjectURL(url);
      pushToast('Account export downloaded.', 'success');
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

              <label className="mb-2 block text-sm font-medium">Avatar URL</label>
              <div className="mb-4 flex gap-2">
                <input
                  type={showAvatar ? 'text' : 'password'}
                  value={avatarUrl}
                  onChange={(event) => setAvatarUrl(event.target.value)}
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
                  maxLength={512}
                  autoComplete="url"
                />
                <button
                  type="button"
                  onClick={() => setShowAvatar((prev) => !prev)}
                  className="rounded-lg border border-[var(--border)] px-3"
                  aria-label="Toggle avatar URL visibility"
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
            Cookie Notice
          </h2>
          <p className="mb-4 text-sm text-[var(--muted-foreground)]">{cookieConsentSummary}</p>
          <div className="mb-4 flex flex-wrap gap-2">
            <Badge tone={cookieConsent === 'accepted' ? 'success' : cookieConsent === 'declined' ? 'warning' : 'default'}>
              {cookieConsent === 'accepted'
                ? 'Accepted'
                : cookieConsent === 'declined'
                  ? 'Declined'
                  : 'Not decided'}
            </Badge>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="secondary" onClick={() => updatePreference('cookieConsent', 'declined')}>
              Decline optional acknowledgement
            </Button>
            <Button type="button" onClick={() => updatePreference('cookieConsent', 'accepted')}>
              Accept
            </Button>
          </div>
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
            <Switch
              checked={keyboardTabSwitchOnlyWhenEmpty}
              onChange={(event) => updatePreference('keyboardTabSwitchOnlyWhenEmpty', event.target.checked)}
              label="Only switch chat focus on empty TAB"
              description="TAB toggles between controls and chat only when the chat input is empty."
            />
          </div>
        </div>

        <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-5">
          <h2 className="mb-4 flex items-center gap-2 text-lg font-bold">
            <BellRing className="h-5 w-5 text-amber-300" />
            Queue Notifications
          </h2>
          <p className="mb-4 text-sm text-[var(--muted-foreground)]">{notificationSummary}</p>
          <div className="space-y-3">
            <Switch
              checked={queuePositionNotifications}
              onChange={(event) => updatePreference('queuePositionNotifications', event.target.checked)}
              label="Notify when queue position changes"
              description="Useful when you are waiting in another tab."
            />
            <Switch
              checked={queueTurnNotifications}
              onChange={(event) => updatePreference('queueTurnNotifications', event.target.checked)}
              label="Notify when your turn starts"
              description="Send a desktop notification when you reach position #1."
            />
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
          <h2 className="mb-4 text-lg font-bold">Account Data Export</h2>
          <p className="mb-4 text-sm text-[var(--muted-foreground)]">
            Download a JSON export of your profile, robots, recent sessions, and queue history.
          </p>
          <button
            type="button"
            onClick={() => void handleExportData()}
            disabled={exportingData}
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
