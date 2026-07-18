import type { RefObject } from 'react';
import type { ChatMsg, FocusMode } from './types';

interface Props {
  messages: ChatMsg[];
  hasOlderMessages: boolean;
  historyLoading: boolean;
  chatInput: string;
  setChatInput: (value: string) => void;
  chatRestriction: string | null;
  focusMode: FocusMode;
  currentViewerId: string;
  canModerate: boolean;
  moderatingUserId: string | null;
  chatScrollRef: RefObject<HTMLDivElement | null>;
  chatPanelRef: RefObject<HTMLDivElement | null>;
  chatInputRef: RefObject<HTMLInputElement | null>;
  chatShouldStickRef: RefObject<boolean>;
  onLoadOlder: () => void;
  onSend: () => void;
  onModerate: (userId: string, action: 'TIMEOUT' | 'BAN' | 'UNBAN', username: string) => void;
}

export function RobotChatPanel({
  messages,
  hasOlderMessages,
  historyLoading,
  chatInput,
  setChatInput,
  chatRestriction,
  focusMode,
  currentViewerId,
  canModerate,
  moderatingUserId,
  chatScrollRef,
  chatPanelRef,
  chatInputRef,
  chatShouldStickRef,
  onLoadOlder,
  onSend,
  onModerate,
}: Props) {
  return (
    <div
      ref={chatPanelRef}
      className={`rounded-xl border p-4 transition-colors ${
        focusMode === 'chat' ? 'border-[var(--primary)]/50 bg-[var(--card)]' : 'border-[var(--border)] bg-[var(--card)]'
      }`}
    >
      <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
        Chat
      </p>

      {(hasOlderMessages || historyLoading) && (
        <button
          type="button"
          onClick={onLoadOlder}
          disabled={historyLoading || !hasOlderMessages}
          className="mb-2 w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-xs font-medium text-[var(--muted-foreground)] transition hover:border-[var(--primary)]/40 hover:text-[var(--foreground)] disabled:cursor-wait disabled:opacity-60"
        >
          {historyLoading ? 'Loading earlier messages...' : 'Load older messages'}
        </button>
      )}

      <div
        ref={chatScrollRef}
        aria-live="polite"
        onScroll={(event) => {
          const container = event.currentTarget;
          const distanceFromBottom =
            container.scrollHeight - container.scrollTop - container.clientHeight;
          chatShouldStickRef.current = distanceFromBottom < 80;
        }}
        className="mb-2 h-64 overflow-y-auto rounded-lg bg-[var(--background)] px-2 py-1.5 text-sm sm:h-52 lg:h-44"
      >
        <div className="flex min-h-full flex-col justify-end gap-1.5">
          {messages.map((msg) => (
            <div
              key={`${msg.userId}-${msg.timestamp}-${msg.content.slice(0, 24)}`}
              className={`animate-fade-in rounded-md border px-2.5 py-1.5 ${
                msg.isSystem
                  ? 'border-[var(--border)] bg-[var(--muted)]/30'
                  : msg.userId === currentViewerId
                    ? 'border-violet-500/25 bg-violet-500/7'
                    : 'border-[var(--border)] bg-[var(--card)]/70'
              }`}
            >
            {msg.isSystem ? (
              <div className="space-y-0.5">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--muted-foreground)]">
                    System
                  </span>
                  <span className="text-[10px] text-[var(--muted-foreground)]">
                    {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
                <p className="text-xs italic text-[var(--muted-foreground)]">{msg.content}</p>
              </div>
            ) : (
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-xs font-semibold text-violet-400">{msg.username}</span>
                  <span className="text-[10px] text-[var(--muted-foreground)]">
                    {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
                <p className="whitespace-pre-wrap break-words text-xs text-[var(--foreground)]/90">{msg.content}</p>
                {canModerate &&
                  msg.userId !== 'system' &&
                  msg.userId !== currentViewerId && (
                    <div className="inline-flex flex-wrap items-center gap-1">
                      <button
                        type="button"
                        onClick={() => onModerate(msg.userId, 'TIMEOUT', msg.username)}
                        disabled={moderatingUserId === msg.userId}
                        className="rounded border border-amber-500/40 px-1.5 py-0.5 text-[10px] text-amber-300 transition-all hover:border-amber-500/80 hover:bg-amber-500/10 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        Timeout
                      </button>
                      <button
                        type="button"
                        onClick={() => onModerate(msg.userId, 'BAN', msg.username)}
                        disabled={moderatingUserId === msg.userId}
                        className="rounded border border-red-500/40 px-1.5 py-0.5 text-[10px] text-red-300 transition-all hover:border-red-500/80 hover:bg-red-500/10 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        Ban
                      </button>
                      <button
                        type="button"
                        onClick={() => onModerate(msg.userId, 'UNBAN', msg.username)}
                        disabled={moderatingUserId === msg.userId}
                        className="rounded border border-emerald-500/40 px-1.5 py-0.5 text-[10px] text-emerald-300 transition-all hover:border-emerald-500/80 hover:bg-emerald-500/10 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        Unban
                      </button>
                    </div>
                  )}
              </div>
            )}
            </div>
          ))}
        </div>
      </div>

      <div className="flex gap-2">
        <input
          ref={chatInputRef}
          type="text"
          aria-label="Chat message input"
          value={chatInput}
          onChange={(e) => setChatInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); onSend(); }
          }}
          placeholder={focusMode === 'chat' ? 'Say something...' : 'Write a message...'}
          maxLength={300}
          className="flex-1 rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm outline-none transition-colors focus:border-[var(--primary)]"
        />
        <button
          type="button"
          aria-label="Send chat message"
          onClick={onSend}
          disabled={!chatInput.trim()}
          className="rounded-lg bg-[var(--primary)] px-3 py-2 text-sm font-medium text-white transition-all hover:bg-[var(--primary-hover)] active:scale-95 disabled:opacity-50"
        >
          Send
        </button>
      </div>
      <p className="mt-1 text-right text-[10px] text-[var(--muted-foreground)]">
        {chatInput.length}/300
      </p>
      {chatRestriction && (
        <p className="mt-2 rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-xs text-amber-300">
          {chatRestriction}
        </p>
      )}
    </div>
  );
}
