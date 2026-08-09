'use client';

import { useEffect, useRef, type Dispatch, type RefObject, type SetStateAction } from 'react';
import { WASD, type ControlButton, type FocusMode } from './types';

type SendCommand = (
  command: string,
  options?: { cooldownMs?: number; access?: ControlButton['access']; value?: unknown; buttonId?: string },
) => void;

export function useHeldControlRepeater({
  activeCommands,
  controlButtons,
  sendCommand,
}: {
  activeCommands: Set<string>;
  controlButtons: ControlButton[];
  sendCommand: SendCommand;
}) {
  useEffect(() => {
    const held = [...activeCommands].filter((command) => ['forward', 'backward', 'left', 'right'].includes(command));
    if (held.length === 0) return;
    const interval = window.setInterval(() => {
      for (const command of held) {
        const button = controlButtons.find((entry) => entry.command === command);
        sendCommand(command, {
          cooldownMs: 0,
          access: 'QUEUE_TURN',
          ...(button ? { buttonId: button.id } : {}),
        });
      }
    }, 400);
    return () => window.clearInterval(interval);
  }, [activeCommands, controlButtons, sendCommand]);
}

export function useControlKeyboard({
  controlButtons,
  focusMode,
  chatInputRef,
  activeMotionKeysRef,
  setActiveKeys,
  setActiveCommands,
  canUseEStop,
  sendCommand,
  triggerEStop,
  releaseLocalControls,
}: {
  controlButtons: ControlButton[];
  focusMode: FocusMode;
  chatInputRef: RefObject<HTMLInputElement | null>;
  activeMotionKeysRef: RefObject<Set<string>>;
  setActiveKeys: Dispatch<SetStateAction<Set<string>>>;
  setActiveCommands: Dispatch<SetStateAction<Set<string>>>;
  canUseEStop: boolean;
  sendCommand: SendCommand;
  triggerEStop: () => void;
  releaseLocalControls: (sendStop?: boolean) => void;
}) {
  useEffect(() => {
    const keyToButton = new Map(
      controlButtons.flatMap((button) =>
        button.hotKey ? [[button.hotKey.toLowerCase(), button] as const] : [],
      ),
    );
    const isEditing = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      return ['INPUT', 'TEXTAREA'].includes(target.tagName)
        || target.isContentEditable
        || target === chatInputRef.current
        || focusMode === 'chat';
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key === 'Escape' && canUseEStop) {
        triggerEStop();
        return;
      }
      if (isEditing(event)) return;

      const key = event.key.toLowerCase();
      if (WASD[key] && !event.repeat) {
        event.preventDefault();
        const button = keyToButton.get(key);
        const command = button?.command ?? WASD[key];
        setActiveKeys((current) => new Set(current).add(key));
        setActiveCommands((current) => new Set(current).add(command));
        activeMotionKeysRef.current.add(key);
        sendCommand(command, {
          ...(button ? { cooldownMs: button.cooldownMs, buttonId: button.id } : {}),
          access: button?.access ?? 'QUEUE_TURN',
        });
      } else if (keyToButton.has(key) && !event.repeat) {
        event.preventDefault();
        const button = keyToButton.get(key);
        if (!button) return;
        setActiveKeys((current) => new Set(current).add(key));
        sendCommand(button.command, {
          cooldownMs: button.cooldownMs,
          access: button.access,
          buttonId: button.id,
        });
      }
    };

    const onKeyUp = (event: KeyboardEvent) => {
      if (isEditing(event)) return;
      const key = event.key.toLowerCase();
      setActiveKeys((current) => {
        const next = new Set(current);
        next.delete(key);
        return next;
      });
      if (!WASD[key]) return;
      const command = WASD[key];
      setActiveCommands((current) => {
        const next = new Set(current);
        next.delete(command);
        return next;
      });
      activeMotionKeysRef.current.delete(key);
      if (activeMotionKeysRef.current.size === 0) {
        sendCommand('stop', { cooldownMs: 0, access: 'QUEUE_TURN' });
      }
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      releaseLocalControls(false);
    };
  }, [
    activeMotionKeysRef,
    canUseEStop,
    chatInputRef,
    controlButtons,
    focusMode,
    releaseLocalControls,
    sendCommand,
    setActiveCommands,
    setActiveKeys,
    triggerEStop,
  ]);
}

export function useGamepadControl({
  enabled,
  isMyTurn,
  controlButtons,
  sendCommand,
}: {
  enabled: boolean;
  isMyTurn: boolean;
  controlButtons: ControlButton[];
  sendCommand: SendCommand;
}) {
  const activeCommandsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!enabled) return;
    let timer = 0;
    const sync = () => {
      const pad = (navigator.getGamepads?.() ?? []).find((entry) => entry?.connected);
      const next = new Set<string>();
      if (pad && isMyTurn) {
        const x = pad.axes[0] ?? 0;
        const y = pad.axes[1] ?? 0;
        if (y <= -0.45 || pad.buttons[12]?.pressed) next.add('forward');
        if (y >= 0.45 || pad.buttons[13]?.pressed) next.add('backward');
        if (x <= -0.45 || pad.buttons[14]?.pressed) next.add('left');
        if (x >= 0.45 || pad.buttons[15]?.pressed) next.add('right');
      }
      const previous = activeCommandsRef.current;
      for (const command of next) {
        if (!previous.has(command)) {
          const button = controlButtons.find((entry) => entry.command === command);
          sendCommand(command, {
            cooldownMs: 0,
            access: 'QUEUE_TURN',
            ...(button ? { buttonId: button.id } : {}),
          });
        }
      }
      if (previous.size > 0 && next.size === 0) sendCommand('stop', { cooldownMs: 0, access: 'QUEUE_TURN' });
      activeCommandsRef.current = next;
      timer = window.setTimeout(sync, 120);
    };
    timer = window.setTimeout(sync, 120);
    return () => {
      window.clearTimeout(timer);
      if (activeCommandsRef.current.size > 0) {
        activeCommandsRef.current.clear();
        sendCommand('stop', { cooldownMs: 0, access: 'QUEUE_TURN' });
      }
    };
  }, [controlButtons, enabled, isMyTurn, sendCommand]);
}
