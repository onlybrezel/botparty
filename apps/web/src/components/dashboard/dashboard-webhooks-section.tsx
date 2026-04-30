'use client';

import { Badge } from '@/components/ui/badge';
import type { RobotWebhookRecord } from '@/lib/api';

const WEBHOOK_EVENTS = [
  'robot.online',
  'robot.offline',
  'session.started',
  'session.ended',
] as const;

type Props = {
  webhooksLoading: boolean;
  webhooks: RobotWebhookRecord[];
  webhookUrl: string;
  webhookEvents: string[];
  webhookActive: boolean;
  webhookOp: string | null;
  createdWebhookSecret: string | null;
  onWebhookUrlChange: (value: string) => void;
  onToggleEvent: (event: (typeof WEBHOOK_EVENTS)[number]) => void;
  onWebhookActiveChange: (value: boolean) => void;
  onCreateWebhook: () => void;
  onDeleteWebhook: (webhook: RobotWebhookRecord) => void;
};

export function DashboardWebhooksSection({
  webhooksLoading,
  webhooks,
  webhookUrl,
  webhookEvents,
  webhookActive,
  webhookOp,
  createdWebhookSecret,
  onWebhookUrlChange,
  onToggleEvent,
  onWebhookActiveChange,
  onCreateWebhook,
  onDeleteWebhook,
}: Props) {
  return (
    <>
      <div id="section-webhooks" className="order-5 scroll-mt-4 flex items-center gap-3 pt-2">
        <span className="shrink-0 text-[11px] font-semibold uppercase tracking-widest text-[var(--muted-foreground)]">
          Webhooks
        </span>
        <div className="h-px flex-1 bg-[var(--border)]" />
      </div>

      <div className="order-5 rounded-lg border border-[var(--border)] bg-[var(--background)] p-3">
        <div className="mb-3">
          <p className="text-xs uppercase tracking-wide text-[var(--muted-foreground)]">Integrations</p>
          <p className="text-xs text-[var(--muted-foreground)]">
            Receive signed webhook deliveries for robot presence and session lifecycle events.
          </p>
        </div>

        <div className="grid gap-3 lg:grid-cols-[1.25fr,0.75fr]">
          <div className="space-y-3">
            <label className="block text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
              Delivery URL
            </label>
            <input
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm"
              placeholder="https://example.com/botparty/webhook"
              value={webhookUrl}
              onChange={(event) => onWebhookUrlChange(event.target.value)}
            />

            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">Events</p>
              <div className="flex flex-wrap gap-2">
                {WEBHOOK_EVENTS.map((eventName) => {
                  const active = webhookEvents.includes(eventName);
                  return (
                    <button
                      key={eventName}
                      type="button"
                      onClick={() => onToggleEvent(eventName)}
                      aria-pressed={active}
                      className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                        active
                          ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                          : 'border-[var(--border)] text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
                      }`}
                    >
                      {eventName}
                    </button>
                  );
                })}
              </div>
            </div>

            <label className="flex items-center gap-3 rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm">
              <input
                type="checkbox"
                checked={webhookActive}
                onChange={(event) => onWebhookActiveChange(event.target.checked)}
                className="h-4 w-4 rounded border-[var(--border)]"
              />
              Create this webhook as active
            </label>

            <button
              type="button"
              onClick={onCreateWebhook}
              disabled={webhookOp === 'create'}
              className="rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
            >
              {webhookOp === 'create' ? 'Creating webhook...' : 'Create webhook'}
            </button>

            {createdWebhookSecret ? (
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-3 text-sm text-amber-100">
                <p className="font-semibold">Copy this signing secret now</p>
                <p className="mt-1 break-all font-mono text-xs">{createdWebhookSecret}</p>
                <p className="mt-2 text-xs text-amber-200/80">
                  BotParty stores only an encrypted version. Future deliveries use the `x-botparty-signature` HMAC header.
                </p>
              </div>
            ) : null}
          </div>

          <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-3">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">Delivery headers</p>
            <ul className="space-y-1 text-xs text-[var(--muted-foreground)]">
              <li>`x-botparty-event`</li>
              <li>`x-botparty-delivery-id`</li>
              <li>`x-botparty-signature` = `sha256=...`</li>
            </ul>
            <p className="mt-3 text-xs text-[var(--muted-foreground)]">
              Deliveries retry automatically on transient failures. Block internal targets by using a public HTTPS endpoint only.
            </p>
          </div>
        </div>

        <div className="mt-4 border-t border-[var(--border)] pt-4">
          {webhooksLoading ? (
            <p className="text-xs text-[var(--muted-foreground)]">Loading webhooks...</p>
          ) : webhooks.length === 0 ? (
            <p className="text-xs text-[var(--muted-foreground)]">No webhooks configured yet.</p>
          ) : (
            <div className="space-y-3">
              {webhooks.map((webhook) => (
                <div key={webhook.id} className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-[var(--foreground)]">{webhook.url}</p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        <Badge tone={webhook.isActive ? 'success' : 'warning'}>
                          {webhook.isActive ? 'Active' : 'Paused'}
                        </Badge>
                        {webhook.lastStatusCode ? (
                          <Badge tone={webhook.lastStatusCode < 300 ? 'success' : 'warning'}>
                            Last status {webhook.lastStatusCode}
                          </Badge>
                        ) : (
                          <Badge>Never delivered</Badge>
                        )}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => onDeleteWebhook(webhook)}
                      disabled={webhookOp === webhook.id}
                      className="rounded border border-red-500/40 px-2 py-1 text-xs text-red-300 disabled:opacity-50"
                    >
                      {webhookOp === webhook.id ? 'Deleting...' : 'Delete'}
                    </button>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2 text-xs">
                    {webhook.events.map((eventName) => (
                      <span key={eventName} className="rounded-full border border-[var(--border)] px-2 py-1 text-[var(--muted-foreground)]">
                        {eventName}
                      </span>
                    ))}
                  </div>

                  <div className="mt-3 grid gap-2 text-xs text-[var(--muted-foreground)] sm:grid-cols-3">
                    <p>Secret preview: <span className="font-mono text-[var(--foreground)]">{webhook.secretPreview}</span></p>
                    <p>Created: {new Date(webhook.createdAt).toLocaleString()}</p>
                    <p>Last delivery: {webhook.lastTriggeredAt ? new Date(webhook.lastTriggeredAt).toLocaleString() : '-'}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
