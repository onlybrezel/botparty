'use client';

import type { FormEvent } from 'react';
import { ExternalLink, Plus } from 'lucide-react';
import type { RobotFormState } from './types';
import { Select } from '@/components/ui/select';

type Props = {
  createForm: RobotFormState;
  setCreateForm: (updater: (prev: RobotFormState) => RobotFormState) => void;
  onSubmit: (event: FormEvent) => void;
  creating: boolean;
  loading: boolean;
  slugOwner: string;
};

export function CreateRobotPanel({ createForm, setCreateForm, onSubmit, creating, loading, slugOwner }: Props) {
  return (
    <section id="new-robot" className="scroll-mt-24 grid grid-cols-1 border border-[var(--border)] bg-[var(--card)] lg:grid-cols-[minmax(0,1.2fr)_minmax(300px,0.8fr)] lg:divide-x lg:divide-[var(--border)]">
      <form onSubmit={onSubmit} autoComplete="off" className="p-4 sm:p-5">
        <h2 className="mb-1 text-lg font-bold">Add a robot</h2>
        <p className="mb-4 text-sm text-[var(--muted-foreground)]">Create the room first, then connect the robot client with its claim token.</p>

        <div className="space-y-3">
          <input
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
            placeholder="Robot name"
            value={createForm.name}
            onChange={(event) => setCreateForm((prev) => ({ ...prev, name: event.target.value }))}
            required
          />
          <div className="flex items-center gap-1 rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm">
            <span className="shrink-0 text-[var(--muted-foreground)]">/robot/{slugOwner}/</span>
            <input
              className="min-w-0 flex-1 bg-transparent outline-none"
              placeholder="custom-slug (optional)"
              autoComplete="off"
              inputMode="text"
              spellCheck={false}
              value={createForm.slug}
              onChange={(event) =>
                setCreateForm((prev) => ({
                  ...prev,
                  slug: event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''),
                }))
              }
              pattern="[a-z0-9](?:[a-z0-9]|-)*[a-z0-9]"
              minLength={3}
              maxLength={50}
              title="3-50 lowercase letters, numbers, and hyphens. No leading or trailing hyphen."
            />
          </div>
          <textarea
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
            placeholder="Description"
            rows={3}
            value={createForm.description}
            onChange={(event) => setCreateForm((prev) => ({ ...prev, description: event.target.value }))}
          />
          <input
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
            placeholder="Tags (comma separated)"
            value={createForm.tags}
            onChange={(event) => setCreateForm((prev) => ({ ...prev, tags: event.target.value }))}
          />
          <Select
            className="bg-[var(--background)]"
            value={createForm.roomMode}
            onChange={(event) => setCreateForm((prev) => ({ ...prev, roomMode: event.target.value as RobotFormState['roomMode'] }))}
          >
            <option value="PUBLIC">Public room</option>
            <option value="UNLISTED">Unlisted room</option>
            <option value="LINK_ONLY">Invite-only room</option>
            <option value="PASSWORD">Password protected</option>
            <option value="ALLOWED_USERS">Allowed users only</option>
            <option value="PRIVATE">Private room</option>
          </Select>

          <div className="rounded-lg border border-[var(--border)] bg-[var(--background)] p-3">
            <label className="flex items-center justify-between gap-3 text-sm font-medium">
              <span>Scheduling window</span>
              <input
                type="checkbox"
                checked={createForm.scheduleEnabled}
                onChange={(event) =>
                  setCreateForm((prev) => ({
                    ...prev,
                    scheduleEnabled: event.target.checked,
                    scheduleStart: event.target.checked ? prev.scheduleStart : '',
                    scheduleEnd: event.target.checked ? prev.scheduleEnd : '',
                  }))
                }
                className="h-4 w-4"
              />
            </label>
            <p className="mt-1 text-xs text-[var(--muted-foreground)]">
              Limit when the robot is expected to be available. Times are stored in UTC with the selected timezone for display context.
            </p>
            {createForm.scheduleEnabled ? (
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <input
                  type="datetime-local"
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm"
                  value={createForm.scheduleStart}
                  onChange={(event) => setCreateForm((prev) => ({ ...prev, scheduleStart: event.target.value }))}
                />
                <input
                  type="datetime-local"
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm"
                  value={createForm.scheduleEnd}
                  onChange={(event) => setCreateForm((prev) => ({ ...prev, scheduleEnd: event.target.value }))}
                />
                <input
                  className="sm:col-span-2 w-full rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm"
                  placeholder="Timezone, e.g. Europe/Berlin"
                  value={createForm.timezone}
                  onChange={(event) => setCreateForm((prev) => ({ ...prev, timezone: event.target.value }))}
                />
              </div>
            ) : null}
          </div>
        </div>

        <button
          type="submit"
          disabled={creating || loading}
          className="mt-4 inline-flex items-center gap-2 rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--primary-hover)] disabled:opacity-60"
        >
          <Plus className="h-4 w-4" />
          {creating ? 'Creating...' : 'Create robot'}
        </button>
      </form>

      <aside className="border-t border-[var(--border)] p-4 sm:p-5 lg:border-t-0">
        <h2 className="mb-1 text-lg font-bold">Connect the client</h2>
        <p className="mb-4 text-sm text-[var(--muted-foreground)]">After creating the room:</p>
        <ol className="space-y-3 text-sm text-[var(--muted-foreground)]">
          <li><span className="font-semibold text-[var(--foreground)]">1.</span> Install the BotParty client on the robot host.</li>
          <li><span className="font-semibold text-[var(--foreground)]">2.</span> Add the claim token to <code className="text-xs">config.yaml</code>.</li>
          <li><span className="font-semibold text-[var(--foreground)]">3.</span> Start the client and wait for the online status.</li>
        </ol>
        <a
          href="https://github.com/onlybrezel/botparty-client/blob/main/docs/index.md"
          target="_blank"
          rel="noopener noreferrer"
          className="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-[var(--foreground)] hover:text-[var(--primary)]"
        >
          Full robot setup guide
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
      </aside>
    </section>
  );
}
