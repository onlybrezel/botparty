'use client';

import { Copy, Eye, EyeOff, RefreshCcw } from 'lucide-react';
import type { RobotManaged } from '@/lib/api';

type Props = {
  robot: RobotManaged;
  showToken: boolean;
  regenerating: boolean;
  embedCode: string;
  onToggleVisibility: () => void;
  onCopyToken: () => void;
  onCopyEmbedCode: () => void;
  onRegenerate: () => void;
};

export function DashboardTokenSection({
  robot,
  showToken,
  regenerating,
  embedCode,
  onToggleVisibility,
  onCopyToken,
  onCopyEmbedCode,
  onRegenerate,
}: Props) {
  const claimToken = robot.claimToken;

  return (
    <>
      <div id="section-token" className="order-2 scroll-mt-4 flex items-center gap-3 pt-2">
        <span className="shrink-0 text-[11px] font-semibold uppercase tracking-widest text-[var(--muted-foreground)]">
          Token & Links
        </span>
        <div className="h-px flex-1 bg-[var(--border)]" />
      </div>

      <div className="order-2 rounded-lg border border-[var(--border)] bg-[var(--background)] p-3">
        <p className="mb-2 text-xs uppercase tracking-wide text-[var(--muted-foreground)]">Claim Token</p>
        <div className="flex items-center gap-2">
          <code className="block min-h-5 flex-1 break-all text-xs text-[var(--foreground)]">
            {claimToken
              ? showToken
                ? claimToken
                : `${claimToken.slice(0, 6)}••••••••••••••••••••`
              : 'Not available'}
          </code>
          <button
            type="button"
            onClick={onToggleVisibility}
            disabled={!claimToken}
            className="rounded border border-[var(--border)] p-1.5 disabled:cursor-not-allowed disabled:opacity-50"
            aria-label="Toggle token visibility"
          >
            {showToken ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
          </button>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onCopyToken}
            disabled={!claimToken}
            className="inline-flex items-center gap-2 rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Copy className="h-3.5 w-3.5" />
            Copy token
          </button>
          <button
            type="button"
            onClick={onRegenerate}
            disabled={regenerating}
            className="inline-flex items-center gap-2 rounded-lg border border-amber-500/40 px-3 py-1.5 text-xs text-amber-700 disabled:opacity-60 dark:text-amber-300"
          >
            <RefreshCcw className="h-3.5 w-3.5" />
            {regenerating ? 'Regenerating...' : 'Regenerate token'}
          </button>
        </div>
        {!claimToken ? (
          <p className="mt-2 text-xs text-[var(--muted-foreground)]">
            Generate a new token to connect another client.
          </p>
        ) : null}

        <div className="mt-5 border-t border-[var(--border)] pt-4">
          <p className="mb-2 text-xs uppercase tracking-wide text-[var(--muted-foreground)]">Embed Widget</p>
          <code className="block break-all rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-xs text-[var(--foreground)]">
            {embedCode}
          </code>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={onCopyEmbedCode}
              className="inline-flex items-center gap-2 rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs"
            >
              <Copy className="h-3.5 w-3.5" />
              Copy embed code
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
