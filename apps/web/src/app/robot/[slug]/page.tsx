'use client';

import { useEffect, useRef, useCallback, useState, use } from 'react';

// ─── Types ────────────────────────────────────────────────────────────────────

type FocusMode = 'controls' | 'chat';

interface ControlButton {
  id: string;
  label: string;
  command: string;
  hotKey?: string;
  icon?: string;
  cooldownMs: number;
  access: string;
  position: number;
  color?: string;
}

interface ChatMsg {
  userId: string;
  username: string;
  content: string;
  timestamp: number;
  isSystem?: boolean;
}

interface Viewer {
  userId: string;
  username: string;
  joinedAt: number;
}

// ─── Hooks ────────────────────────────────────────────────────────────────────

function useCooldown(cooldownMs: number) {
  const lastRef = useRef<number>(0);
  return useCallback(() => {
    const now = Date.now();
    if (now - lastRef.current < cooldownMs) return false;
    lastRef.current = now;
    return true;
  }, [cooldownMs]);
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function RobotPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);

  const [focusMode, setFocusMode] = useState<FocusMode>('controls');
  const [controlButtons, setControlButtons] = useState<ControlButton[]>([]);
  const [activeKeys, setActiveKeys] = useState<Set<string>>(new Set());
  const [viewers, setViewers] = useState<Viewer[]>([]);
  const [crowdInputs, setCrowdInputs] = useState<Map<string, number>>(new Map()); // command → timestamp
  const [messages, setMessages] = useState<ChatMsg[]>([
    { userId: 'system', username: 'system', content: 'Welcome to the chat!', timestamp: Date.now(), isSystem: true },
  ]);
  const [chatInput, setChatInput] = useState('');
  const [connected, setConnected] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const chatInputRef = useRef<HTMLInputElement>(null);
  const cooldownMap = useRef<Map<string, number>>(new Map());

  // ─── WebSocket ──────────────────────────────────────────────────────────────

  useEffect(() => {
    const ws = new WebSocket(
      (process.env.NEXT_PUBLIC_WS_URL ?? 'ws://localhost:3001') + '/ws',
    );
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      // Join the robot room (anonymous for now; pass userId/username if logged in)
      ws.send(JSON.stringify({ event: 'room:join', data: { robotId: slug } }));
    };

    ws.onclose = () => setConnected(false);

    ws.onmessage = (e) => {
      try {
        const { event, data } = JSON.parse(e.data as string);
        handleWsEvent(event, data);
      } catch {
        // ignore
      }
    };

    return () => ws.close();
  }, [slug]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch control buttons
  useEffect(() => {
    fetch(`/api/v1/controls/robot/${slug}`)
      .then((r) => (r.ok ? r.json() : []))
      .then(setControlButtons)
      .catch(() => {});
  }, [slug]);

  const handleWsEvent = useCallback((event: string, data: unknown) => {
    const d = data as Record<string, unknown>;
    switch (event) {
      case 'presence:update':
        setViewers((d.viewers as Viewer[]) ?? []);
        break;
      case 'presence:join':
        setViewers((v) => {
          if (v.some((x) => x.userId === d.userId)) return v;
          return [...v, { userId: d.userId as string, username: d.username as string, joinedAt: Date.now() }];
        });
        break;
      case 'presence:leave':
        setViewers((v) => v.filter((x) => x.userId !== d.userId));
        break;
      case 'crowd:input':
        setCrowdInputs((prev) => new Map(prev).set(d.command as string, Date.now()));
        break;
      case 'chat:message':
        setMessages((prev) => [
          ...prev.slice(-200),
          {
            userId: d.userId as string,
            username: d.username as string,
            content: d.content as string,
            timestamp: d.timestamp as number,
          },
        ]);
        break;
      case 'chat:system':
        setMessages((prev) => [
          ...prev.slice(-200),
          { userId: 'system', username: 'system', content: d.message as string, timestamp: Date.now(), isSystem: true },
        ]);
        break;
    }
  }, []);

  // ─── Keyboard & control ─────────────────────────────────────────────────────

  const sendCommand = useCallback(
    (command: string, button?: ControlButton) => {
      if (wsRef.current?.readyState !== WebSocket.OPEN) return;

      const cooldown = button?.cooldownMs ?? 200;
      const lastAt = cooldownMap.current.get(command) ?? 0;
      if (Date.now() - lastAt < cooldown) return;
      cooldownMap.current.set(command, Date.now());

      wsRef.current.send(
        JSON.stringify({
          event: 'control:command',
          data: { robotId: slug, command, timestamp: Date.now() },
        }),
      );
    },
    [slug],
  );

  const triggerEStop = useCallback(() => {
    if (wsRef.current?.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(
      JSON.stringify({ event: 'control:emergency-stop', data: { robotId: slug } }),
    );
  }, [slug]);

  // Keyboard handler
  useEffect(() => {
    const WASD: Record<string, string> = {
      w: 'forward', arrowup: 'forward',
      s: 'backward', arrowdown: 'backward',
      a: 'left', arrowleft: 'left',
      d: 'right', arrowright: 'right',
    };

    const keyToButton = new Map<string, ControlButton>(
      controlButtons.filter((b) => b.hotKey).map((b) => [b.hotKey!.toLowerCase(), b]),
    );

    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      const inInput = tag === 'INPUT' || tag === 'TEXTAREA';

      // Tab toggles focus mode (always intercept)
      if (e.key === 'Tab') {
        e.preventDefault();
        setFocusMode((m) => {
          const next = m === 'controls' ? 'chat' : 'controls';
          if (next === 'chat') setTimeout(() => chatInputRef.current?.focus(), 50);
          return next;
        });
        return;
      }

      // ESC triggers E-STOP from anywhere
      if (e.key === 'Escape') {
        triggerEStop();
        return;
      }

      if (inInput || focusMode === 'chat') return;

      const key = e.key.toLowerCase();

      // WASD / arrow keys
      if (WASD[key] && !e.repeat) {
        e.preventDefault();
        setActiveKeys((s) => new Set(s).add(key));
        sendCommand(WASD[key]);
      }

      // Custom hotkeys from button config
      if (keyToButton.has(key) && !e.repeat) {
        e.preventDefault();
        const btn = keyToButton.get(key)!;
        setActiveKeys((s) => new Set(s).add(key));
        sendCommand(btn.command, btn);
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      setActiveKeys((s) => {
        const next = new Set(s);
        next.delete(key);
        return next;
      });
      if (WASD[key]) sendCommand('stop');
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [focusMode, controlButtons, sendCommand, triggerEStop]);

  // Auto-scroll chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // ─── Chat send ──────────────────────────────────────────────────────────────

  const sendChat = useCallback(() => {
    const text = chatInput.trim();
    if (!text || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(
      JSON.stringify({ event: 'chat:message', data: { robotId: slug, content: text } }),
    );
    setChatInput('');
  }, [chatInput, slug]);

  // ─── UI ─────────────────────────────────────────────────────────────────────

  const isCrowdActive = (command: string) =>
    Date.now() - (crowdInputs.get(command) ?? 0) < 600;

  const defaultButtons: ControlButton[] = [
    { id: 'w', label: 'W', command: 'forward', hotKey: 'w', cooldownMs: 100, access: 'QUEUE_TURN', position: 0 },
    { id: 'a', label: 'A', command: 'left',    hotKey: 'a', cooldownMs: 100, access: 'QUEUE_TURN', position: 1 },
    { id: 's', label: 'S', command: 'backward', hotKey: 's', cooldownMs: 100, access: 'QUEUE_TURN', position: 2 },
    { id: 'd', label: 'D', command: 'right',   hotKey: 'd', cooldownMs: 100, access: 'QUEUE_TURN', position: 3 },
  ];
  const buttons = controlButtons.length > 0 ? controlButtons : defaultButtons;

  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      {/* Focus mode indicator */}
      <div className="mb-3 flex items-center gap-3">
        <button
          onClick={() => setFocusMode('controls')}
          className={`rounded-lg px-3 py-1 text-xs font-bold transition ${
            focusMode === 'controls'
              ? 'bg-[var(--primary)] text-white'
              : 'border border-[var(--border)] text-[var(--muted-foreground)] hover:text-white'
          }`}
        >
          🎮 CONTROLS
        </button>
        <button
          onClick={() => { setFocusMode('chat'); setTimeout(() => chatInputRef.current?.focus(), 50); }}
          className={`rounded-lg px-3 py-1 text-xs font-bold transition ${
            focusMode === 'chat'
              ? 'bg-[var(--primary)] text-white'
              : 'border border-[var(--border)] text-[var(--muted-foreground)] hover:text-white'
          }`}
        >
          💬 CHAT
        </button>
        <span className="text-xs text-[var(--muted-foreground)]">Tab to toggle · ESC = E-STOP</span>
        <div className="ml-auto flex items-center gap-2">
          <span
            className={`h-2 w-2 rounded-full ${connected ? 'bg-green-500' : 'bg-red-500'}`}
          />
          <span className="text-xs text-[var(--muted-foreground)]">
            {connected ? `${viewers.length} viewer${viewers.length !== 1 ? 's' : ''}` : 'Disconnected'}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Video + Controls */}
        <div className="lg:col-span-2">
          {/* Video Stream */}
          <div className="aspect-video overflow-hidden rounded-xl border border-[var(--border)] bg-black">
            <div className="flex h-full items-center justify-center text-[var(--muted-foreground)]">
              <div className="text-center">
                <p className="text-lg font-medium">LiveKit Video Stream</p>
                <p className="text-sm">Connecting to robot...</p>
              </div>
            </div>
          </div>

          {/* Controls Panel */}
          <div
            className={`mt-4 rounded-xl border p-6 transition ${
              focusMode === 'controls'
                ? 'border-[var(--primary)] bg-[var(--card)]'
                : 'border-[var(--border)] bg-[var(--card)] opacity-60'
            }`}
          >
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-sm font-medium text-[var(--muted-foreground)]">CONTROLS</h3>
              {focusMode !== 'controls' && (
                <span className="text-xs text-[var(--muted-foreground)]">
                  Press Tab to enable controls
                </span>
              )}
            </div>

            {/* WASD grid + custom buttons */}
            <div className="flex flex-wrap items-start gap-4">
              {/* WASD layout (always shown) */}
              <div className="grid grid-cols-3 gap-1">
                <div />
                {['w', 'a', 's', 'd'].slice(0, 1).map((k) => {
                  const btn = buttons.find((b) => b.hotKey === k);
                  const cmd = btn?.command ?? 'forward';
                  const isDown = activeKeys.has(k);
                  const isCrowd = isCrowdActive(cmd);
                  return (
                    <button
                      key={k}
                      onMouseDown={() => sendCommand(cmd, btn)}
                      className={`flex h-12 w-12 items-center justify-center rounded-lg border font-mono text-sm font-bold transition select-none ${
                        isDown
                          ? 'border-[var(--primary)] bg-[var(--primary)] text-white scale-95'
                          : isCrowd
                          ? 'border-yellow-500 bg-yellow-500/20 text-yellow-300'
                          : 'border-[var(--border)] bg-[var(--muted)] hover:bg-[var(--primary)] hover:text-white'
                      }`}
                    >
                      {btn?.icon ?? k.toUpperCase()}
                    </button>
                  );
                })}
                <div />
                {['a', 's', 'd'].map((k) => {
                  const btn = buttons.find((b) => b.hotKey === k);
                  const cmd = btn?.command ?? (k === 'a' ? 'left' : k === 's' ? 'backward' : 'right');
                  const isDown = activeKeys.has(k);
                  const isCrowd = isCrowdActive(cmd);
                  return (
                    <button
                      key={k}
                      onMouseDown={() => sendCommand(cmd, btn)}
                      className={`flex h-12 w-12 items-center justify-center rounded-lg border font-mono text-sm font-bold transition select-none ${
                        isDown
                          ? 'border-[var(--primary)] bg-[var(--primary)] text-white scale-95'
                          : isCrowd
                          ? 'border-yellow-500 bg-yellow-500/20 text-yellow-300'
                          : 'border-[var(--border)] bg-[var(--muted)] hover:bg-[var(--primary)] hover:text-white'
                      }`}
                    >
                      {btn?.icon ?? k.toUpperCase()}
                    </button>
                  );
                })}
              </div>

              {/* Extra custom buttons */}
              {buttons
                .filter((b) => !['w', 'a', 's', 'd'].includes(b.hotKey ?? ''))
                .map((btn) => {
                  const isCrowd = isCrowdActive(btn.command);
                  return (
                    <button
                      key={btn.id}
                      onMouseDown={() => sendCommand(btn.command, btn)}
                      style={btn.color ? { borderColor: btn.color } : undefined}
                      className={`flex h-12 min-w-[3rem] items-center justify-center gap-1 rounded-lg border px-3 text-sm font-bold transition select-none ${
                        isCrowd
                          ? 'bg-yellow-500/20 text-yellow-300'
                          : 'border-[var(--border)] bg-[var(--muted)] hover:bg-[var(--primary)] hover:text-white'
                      }`}
                    >
                      {btn.icon && <span>{btn.icon}</span>}
                      {btn.label}
                      {btn.hotKey && (
                        <span className="ml-1 text-xs opacity-50">[{btn.hotKey}]</span>
                      )}
                    </button>
                  );
                })}

              <div className="mx-4 h-12 w-px bg-[var(--border)] self-center" />

              {/* Emergency Stop */}
              <button
                onMouseDown={triggerEStop}
                className="flex h-14 w-28 items-center justify-center rounded-xl bg-red-600 font-bold text-white shadow-lg shadow-red-500/25 transition hover:bg-red-500 active:scale-95"
              >
                🛑 E-STOP
              </button>
            </div>

            <p className="mt-3 text-center text-xs text-[var(--muted-foreground)]">
              WASD or arrow keys to move · <span className="text-yellow-400">yellow</span> = someone else just pressed it · ESC = E-STOP
            </p>
          </div>
        </div>

        {/* Sidebar */}
        <div className="space-y-4">
          {/* Robot Info */}
          <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
            <h2 className="text-lg font-bold">{slug}</h2>
            <p className="text-sm text-[var(--muted-foreground)]">by creator_name</p>
            <div className="mt-3 flex gap-1">
              <span className="rounded-full bg-green-500/20 px-2 py-0.5 text-xs text-green-400">
                ● Online
              </span>
            </div>
          </div>

          {/* Crowd Presence */}
          {viewers.length > 0 && (
            <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
              <h3 className="mb-2 text-xs font-medium text-[var(--muted-foreground)]">
                VIEWERS ({viewers.length})
              </h3>
              <div className="flex flex-wrap gap-1">
                {viewers.slice(0, 12).map((v) => (
                  <span
                    key={v.userId}
                    className="rounded-full bg-[var(--muted)] px-2 py-0.5 text-xs text-[var(--muted-foreground)]"
                    title={v.username}
                  >
                    {v.username.slice(0, 12)}
                  </span>
                ))}
                {viewers.length > 12 && (
                  <span className="rounded-full bg-[var(--muted)] px-2 py-0.5 text-xs text-[var(--muted-foreground)]">
                    +{viewers.length - 12}
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Queue */}
          <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
            <h3 className="mb-3 text-sm font-medium text-[var(--muted-foreground)]">
              CONTROL QUEUE
            </h3>
            <button className="w-full rounded-lg bg-[var(--primary)] py-2 text-sm font-medium text-white transition hover:opacity-90">
              Join Queue
            </button>
            <div className="mt-3 space-y-2">
              <div className="flex items-center gap-2 text-sm">
                <span className="h-6 w-6 rounded-full bg-[var(--muted)]" />
                <span>user_123</span>
                <span className="ml-auto text-xs text-[var(--muted-foreground)]">Controlling</span>
              </div>
            </div>
          </div>

          {/* Chat */}
          <div
            className={`rounded-xl border p-4 transition ${
              focusMode === 'chat'
                ? 'border-[var(--primary)] bg-[var(--card)]'
                : 'border-[var(--border)] bg-[var(--card)]'
            }`}
          >
            <h3 className="mb-3 text-sm font-medium text-[var(--muted-foreground)]">CHAT</h3>
            <div className="mb-3 h-52 space-y-1 overflow-y-auto rounded-lg bg-[var(--background)] p-2 text-sm">
              {messages.map((msg, i) => (
                <p key={i}>
                  {msg.isSystem ? (
                    <span className="text-[var(--muted-foreground)] italic">{msg.content}</span>
                  ) : (
                    <>
                      <span className="font-medium text-purple-400">{msg.username}:</span>{' '}
                      <span>{msg.content}</span>
                    </>
                  )}
                </p>
              ))}
              <div ref={chatEndRef} />
            </div>
            <div className="flex gap-2">
              <input
                ref={chatInputRef}
                type="text"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); sendChat(); }
                  if (e.key === 'Tab') { e.preventDefault(); setFocusMode('controls'); }
                }}
                placeholder={focusMode === 'chat' ? 'Say something...' : 'Tab to chat'}
                maxLength={300}
                className="flex-1 rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm outline-none focus:border-[var(--primary)]"
              />
              <button
                onClick={sendChat}
                className="rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-medium text-white transition hover:opacity-90"
              >
                Send
              </button>
            </div>
            <p className="mt-1 text-right text-xs text-[var(--muted-foreground)]">
              {chatInput.length}/300
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
