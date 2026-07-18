'use client';

import { Search, Trash2, Save, X } from 'lucide-react';
import { Select } from '@/components/ui/select';
import {
  successButtonClass,
  secondaryButtonClass,
  dangerButtonClass,
} from './utils';

type UserRole = 'ADMIN' | 'MOD' | 'USER';

type StaffUser = {
  id: string;
  username: string;
  displayName: string | null;
  email?: string;
  role: UserRole;
  isActive: boolean;
  credits?: number;
  balance?: number;
  lastLoginAt?: string | null;
};

type UserDraft = {
  username: string;
  email: string;
  displayName: string;
  password: string;
  role: UserRole;
  isActive: boolean;
  credits: string;
  balance: string;
};

type UsersViewProps = {
  filteredUsers: StaffUser[];
  query: string;
  onQueryChange: (value: string) => void;
  editingUserId: string | null;
  userDraft: UserDraft | null;
  onStartUserEdit: (user: StaffUser) => void;
  onUserDraftChange: (updater: (prev: UserDraft | null) => UserDraft | null) => void;
  onSaveUserEdit: () => Promise<void>;
  onCancelUserEdit: () => void;
  onDeleteUser: () => Promise<void>;
  viewerIsAdmin: boolean;
};

export function UsersView({
  filteredUsers,
  query,
  onQueryChange,
  editingUserId,
  userDraft,
  onStartUserEdit,
  onUserDraftChange,
  onSaveUserEdit,
  onCancelUserEdit,
  onDeleteUser,
  viewerIsAdmin,
}: UsersViewProps) {
  return (
    <section className="mb-6 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
      <div className="mb-3 flex items-center gap-2">
        <h2 className="text-lg font-bold">Users</h2>
        <div className="relative ml-auto w-full max-w-xs">
          <Search className="pointer-events-none absolute left-2 top-2.5 h-4 w-4 text-[var(--muted-foreground)]" />
          <input
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] py-2 pl-8 pr-3 text-sm"
            placeholder="Search users..."
          />
        </div>
      </div>

      <div className="max-h-[36rem] space-y-3 overflow-auto rounded-lg">
        {filteredUsers.map((user) => {
          const isEditing = editingUserId === user.id && userDraft;
          return (
            <div key={user.id} className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--background)]">
              <button
                type="button"
                onClick={() => viewerIsAdmin && onStartUserEdit(user)}
                disabled={!viewerIsAdmin}
                className="grid w-full grid-cols-12 gap-2 px-3 py-3 text-left text-sm transition hover:bg-[var(--muted)]/70"
              >
                <span className="col-span-4 truncate font-medium">{user.displayName ?? user.username}</span>
                <span className="col-span-4 truncate text-[var(--muted-foreground)]">{user.email ?? 'Contact details hidden'}</span>
                <span className="col-span-2 text-xs text-[var(--muted-foreground)]">{user.role}</span>
                <span className="col-span-1 text-right text-xs text-[var(--muted-foreground)]">{viewerIsAdmin ? `${user.credits ?? 0} cr` : ''}</span>
                <span className="col-span-1 text-right text-xs text-sky-300">{viewerIsAdmin ? (isEditing ? 'Open' : 'Edit') : ''}</span>
              </button>

              {isEditing && viewerIsAdmin ? (
                <div className="border-t border-[var(--border)] bg-[var(--card)]/80 p-4">
                  <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-xs uppercase tracking-wide text-[var(--muted-foreground)]">Edit user</p>
                      <p className="mt-1 text-sm font-semibold">{user.username}</p>
                      <p className="text-xs text-[var(--muted-foreground)]">
                        {viewerIsAdmin
                          ? 'All staff-editable account fields are available here.'
                          : 'Mods can update the visible profile and economy fields. Credentials stay admin-only.'}
                      </p>
                    </div>
                    <div className="rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-xs text-[var(--muted-foreground)]">
                      <p>Role: {user.role}</p>
                      <p>Status: {user.isActive ? 'Active' : 'Inactive'}</p>
                      <p>Last login: {user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString() : 'Never'}</p>
                    </div>
                  </div>

                  <div className="grid gap-4 lg:grid-cols-3">
                    <div className="space-y-2 rounded-2xl border border-[var(--border)] bg-[var(--background)] p-3">
                      <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">Identity</p>
                      <input
                        value={userDraft.username}
                        onChange={(event) => onUserDraftChange((prev) => (prev ? { ...prev, username: event.target.value } : prev))}
                        placeholder="Username"
                        disabled={!viewerIsAdmin}
                        className="w-full rounded-xl border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-60"
                      />
                      <input
                        value={userDraft.email}
                        onChange={(event) => onUserDraftChange((prev) => (prev ? { ...prev, email: event.target.value } : prev))}
                        placeholder="Email"
                        type="email"
                        disabled={!viewerIsAdmin}
                        className="w-full rounded-xl border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-60"
                      />
                      <input
                        value={userDraft.displayName}
                        onChange={(event) => onUserDraftChange((prev) => (prev ? { ...prev, displayName: event.target.value } : prev))}
                        placeholder="Display name"
                        className="w-full rounded-xl border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm"
                      />
                    </div>

                    <div className="space-y-2 rounded-2xl border border-[var(--border)] bg-[var(--background)] p-3">
                      <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">Access & status</p>
                      <Select
                        value={userDraft.role}
                        onChange={(event) => onUserDraftChange((prev) => (prev ? { ...prev, role: event.target.value as UserRole } : prev))}
                        disabled={!viewerIsAdmin}
                        className="h-[42px] rounded-xl border bg-[var(--card)] px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        <option value="USER">USER</option>
                        <option value="MOD">MOD</option>
                        <option value="ADMIN">ADMIN</option>
                      </Select>
                      <label className="inline-flex items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm">
                        <input
                          type="checkbox"
                          checked={userDraft.isActive}
                          onChange={(event) => onUserDraftChange((prev) => (prev ? { ...prev, isActive: event.target.checked } : prev))}
                        />
                        Account active
                      </label>
                      <input
                        value={userDraft.password}
                        onChange={(event) => onUserDraftChange((prev) => (prev ? { ...prev, password: event.target.value } : prev))}
                        placeholder={viewerIsAdmin ? 'New password (optional)' : 'Password changes are admin-only'}
                        type="password"
                        autoComplete="new-password"
                        disabled={!viewerIsAdmin}
                        className="w-full rounded-xl border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-60"
                      />
                      <p className="text-xs text-[var(--muted-foreground)]">
                        Leave the password empty to keep the current one.
                      </p>
                    </div>

                    <div className="space-y-2 rounded-2xl border border-[var(--border)] bg-[var(--background)] p-3">
                      <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">Economy</p>
                      <input
                        value={userDraft.credits}
                        onChange={(event) => onUserDraftChange((prev) => (prev ? { ...prev, credits: event.target.value } : prev))}
                        placeholder="Credits"
                        className="w-full rounded-xl border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm"
                      />
                      <input
                        value={userDraft.balance}
                        onChange={(event) => onUserDraftChange((prev) => (prev ? { ...prev, balance: event.target.value } : prev))}
                        placeholder="Balance"
                        className="w-full rounded-xl border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm"
                      />
                      <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-xs text-[var(--muted-foreground)]">
                        Credits affect platform usage, while balance is the wallet-style numeric field used elsewhere in staff tooling.
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    <button type="button" onClick={() => void onSaveUserEdit()} className={successButtonClass}>
                      <Save className="h-4 w-4" />
                      Save user
                    </button>
                    <button
                      type="button"
                      onClick={onCancelUserEdit}
                      className={secondaryButtonClass}
                    >
                      <X className="h-4 w-4" />
                      Cancel
                    </button>
                    {viewerIsAdmin ? (
                      <button type="button" onClick={() => void onDeleteUser()} className={`ml-auto ${dangerButtonClass}`}>
                        <Trash2 className="h-4 w-4" />
                        Delete user
                      </button>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}
