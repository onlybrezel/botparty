'use client';

import { useRef, useState } from 'react';
import { X } from 'lucide-react';
import { api } from '@/lib/api';
import { Dialog } from '@/components/ui/dialog';

type Props = {
  robotId: string;
  robotName: string;
  ownerName?: string;
  onClose: () => void;
  onDonated?: () => void;
};

const PRESETS = [50, 100, 250, 500, 1000];

export function DonationDialog({ robotId, robotName, ownerName, onClose, onDonated }: Props) {
  const [amount, setAmount] = useState<number>(100);
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const idempotencyKey = useRef(crypto.randomUUID());

  const submit = async () => {
    if (!Number.isFinite(amount) || amount <= 0) {
      setError('Please enter a valid amount');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await api.wallet.donate(
        { robotId, amount, ...(message.trim() ? { message: message.trim() } : {}) },
        idempotencyKey.current,
      );
      setSuccess(true);
      onDonated?.();
      setTimeout(onClose, 1200);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Donation failed';
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open
      title={ownerName ? `Support ${ownerName}` : 'Support creator'}
      description={`Donate credits to ${robotName}. 10% goes to the platform, the rest to the creator.`}
      onClose={onClose}
    >
        <header className="mb-3 flex items-center justify-end">
          <button
            type="button"
            onClick={onClose}
            aria-label="Close donation dialog"
            className="rounded p-1 text-[var(--muted-foreground)] hover:bg-[var(--muted)]"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        {success ? (
          <div className="rounded-lg border border-green-500/30 bg-green-500/10 p-3 text-sm text-green-300">
            Thanks for your donation! 🎉
          </div>
        ) : (
          <>
            <div className="mb-3 flex flex-wrap gap-2">
              {PRESETS.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setAmount(preset)}
                  className={`rounded-md border px-3 py-1.5 text-sm transition ${
                    amount === preset
                      ? 'border-pink-500/60 bg-pink-500/15 text-pink-200'
                      : 'border-[var(--border)] text-[var(--muted-foreground)] hover:border-[var(--muted-foreground)]'
                  }`}
                >
                  {preset} cr
                </button>
              ))}
            </div>

            <label className="mb-3 block text-sm">
              <span className="mb-1 block text-[var(--muted-foreground)]">Amount (credits)</span>
              <input
                type="number"
                min={1}
                value={amount}
                onChange={(e) => setAmount(Number(e.target.value))}
                className="w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
              />
            </label>

            <label className="mb-3 block text-sm">
              <span className="mb-1 block text-[var(--muted-foreground)]">Message (optional)</span>
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value.slice(0, 200))}
                rows={2}
                placeholder="Say something nice…"
                className="w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
              />
            </label>

            {error && (
              <p className="mb-3 rounded-md border border-red-500/30 bg-red-500/10 p-2 text-xs text-red-300">
                {error}
              </p>
            )}

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-md border border-[var(--border)] px-3 py-1.5 text-sm hover:bg-[var(--muted)]"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={submit}
                className="rounded-md bg-pink-500 px-4 py-1.5 text-sm font-medium text-white hover:bg-pink-400 disabled:opacity-60"
              >
                {submitting ? 'Sending…' : `Donate ${amount} cr`}
              </button>
            </div>
          </>
        )}
    </Dialog>
  );
}
