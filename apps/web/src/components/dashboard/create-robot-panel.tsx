'use client';

import type { FormEvent } from 'react';
import { Cable, ExternalLink, Plus } from 'lucide-react';
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
    <section className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <form onSubmit={onSubmit} autoComplete="off" className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 sm:p-5">
        <h2 className="mb-4 text-lg font-bold">Create Robot</h2>

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
              pattern="[a-z0-9][a-z0-9-]*[a-z0-9]"
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

      <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 sm:p-5">
        <h2 className="mb-4 text-lg font-bold">Linux Robot Client Quickstart</h2>
        <ol className="space-y-2 text-sm text-[var(--muted-foreground)]">
          <li>1. Create a robot and copy the claim token.</li>
          <li>2. On your robot host: clone the botparty-client repository.</li>
          <li>3. Create a venv, install requirements, and copy config.example.yaml to config.yaml.</li>
          <li>4. Paste your claim token in config.yaml.</li>
          <li>5. Start with python -m botparty_robot.</li>
        </ol>
        <div className="mt-4 rounded-xl border border-[var(--border)] bg-[var(--background)] p-3">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Cable className="h-4 w-4 text-violet-300" />
            Controller schema
          </div>
          <p className="mt-2 text-sm text-[var(--muted-foreground)]">
            Browser UI → BotParty API + LiveKit → Python robot client → hardware adapter
          </p>
          <div className="mt-3">
            <a
              href="https://github.com/onlybrezel/botparty-client/blob/main/docs/index.md"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-semibold text-[var(--foreground)] transition hover:border-[var(--muted-foreground)]"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Robot Setup
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
