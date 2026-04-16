import { useEffect, useRef, useState, useCallback } from 'react';

interface UseGamepadOptions {
  enabled?: boolean;
  onCommand?: (direction: 'up' | 'down' | 'left' | 'right' | 'button', buttonName?: string) => void;
}

/**
 * Custom hook for Gamepad API support (D-Pad and analog stick).
 * Provides real-time gamepad input handling.
 */
export function useGamepad({ enabled = true, onCommand }: UseGamepadOptions) {
  const [gamepadConnected, setGamepadConnected] = useState(false);
  const gamepadIndexRef = useRef<number | null>(null);
  const lastCommandRef = useRef<string | null>(null);
  const pollIntervalRef = useRef<number | null>(null);

  const handleGamepadInput = useCallback(() => {
    if (!enabled || gamepadIndexRef.current === null) return;

    const gamepads = navigator.getGamepads?.();
    const gamepad = gamepads?.[gamepadIndexRef.current];

    if (!gamepad) {
      setGamepadConnected(false);
      gamepadIndexRef.current = null;
      return;
    }

    // D-Pad: buttons[12] (up), [13] (down), [14] (left), [15] (right)
    if (gamepad.buttons[12]?.pressed) onCommand?.('up');
    if (gamepad.buttons[13]?.pressed) onCommand?.('down');
    if (gamepad.buttons[14]?.pressed) onCommand?.('left');
    if (gamepad.buttons[15]?.pressed) onCommand?.('right');

    // Left stick (analog; >0.5 threshold)
    const axisX = gamepad.axes[0];
    const axisY = gamepad.axes[1];

    if (Math.abs(axisX) > 0.5) {
      const direction = axisX > 0 ? 'right' : 'left';
      if (lastCommandRef.current !== direction) {
        lastCommandRef.current = direction;
        onCommand?.(direction as any);
      }
    } else if (Math.abs(axisY) > 0.5) {
      const direction = axisY > 0 ? 'down' : 'up';
      if (lastCommandRef.current !== direction) {
        lastCommandRef.current = direction;
        onCommand?.(direction as any);
      }
    } else {
      lastCommandRef.current = null;
    }

    // A Button (index 0)
    if (gamepad.buttons[0]?.pressed) onCommand?.('button', 'A');
  }, [enabled, onCommand]);

  const handleGamepadConnected = (event: GamepadEvent) => {
    if (enabled) {
      gamepadIndexRef.current = event.gamepad.index;
      setGamepadConnected(true);
    }
  };

  const handleGamepadDisconnected = () => {
    setGamepadConnected(false);
    gamepadIndexRef.current = null;
  };

  useEffect(() => {
    if (!enabled) return;

    window.addEventListener('gamepadconnected', handleGamepadConnected);
    window.addEventListener('gamepaddisconnected', handleGamepadDisconnected);

    // Poll gamepad state on an interval
    pollIntervalRef.current = window.setInterval(handleGamepadInput, 100);

    return () => {
      window.removeEventListener('gamepadconnected', handleGamepadConnected);
      window.removeEventListener('gamepaddisconnected', handleGamepadDisconnected);
      if (pollIntervalRef.current !== null) {
        clearInterval(pollIntervalRef.current);
      }
    };
  }, [enabled, handleGamepadInput]);

  return {
    gamepadConnected,
  };
}
