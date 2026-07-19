'use client';

import type { AllowedUserRecord } from '@/lib/api';

type Props = {
  visible: boolean;
  allowlistUsername: string;
  allowlistOp: string | null;
  allowlistLoading: boolean;
  allowedUsers: AllowedUserRecord[];
  onUsernameChange: (value: string) => void;
  onAdd: () => void;
  onRemove: (user: AllowedUserRecord) => void;
};

export function DashboardAllowlistSection({
  visible,
  allowlistUsername,
  allowlistOp,
  allowlistLoading,
  allowedUsers,
  onUsernameChange,
  onAdd,
  onRemove,
}: Props) {
  if (!visible) {
    return null;
  }

  return (
    <div className="order-4 rounded-lg border border-[var(--border)] bg-[var(--background)] p-3">
      <div className="mb-3">
        <p className="text-xs uppercase tracking-wide text-[var(--muted-foreground)]">Allow List</p>
        <p className="text-xs text-[var(--muted-foreground)]">
          Only these signed-in users can enter the room.
        </p>
      </div>
      <div className="mb-3 flex gap-2">
        <label htmlFor="allowlist-username" className="sr-only">Username to allow</label>
        <input
          id="allowlist-username"
          className="flex-1 rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm"
          placeholder="Username"
          value={allowlistUsername}
          onChange={(event) => onUsernameChange(event.target.value)}
        />
        <button
          type="button"
          onClick={onAdd}
          disabled={allowlistOp === 'add'}
          className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm disabled:opacity-60"
        >
          {allowlistOp === 'add' ? 'Adding...' : 'Add'}
        </button>
      </div>

      {allowlistLoading ? (
        <p className="text-xs text-[var(--muted-foreground)]">Loading allow list...</p>
      ) : allowedUsers.length === 0 ? (
        <p className="text-xs text-[var(--muted-foreground)]">No users allow-listed yet.</p>
      ) : (
        <div className="space-y-2">
          {allowedUsers.map((user) => (
            <div
              key={user.id}
              className="flex items-center justify-between rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm"
            >
              <div className="min-w-0">
                <p className="truncate font-medium">{user.displayName ?? user.username}</p>
                <p className="truncate text-xs text-[var(--muted-foreground)]">@{user.username}</p>
              </div>
              <button
                type="button"
                onClick={() => onRemove(user)}
                disabled={allowlistOp === user.id}
                className="rounded border border-red-500/40 px-2 py-1 text-xs text-red-700 disabled:opacity-50 dark:text-red-300"
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
