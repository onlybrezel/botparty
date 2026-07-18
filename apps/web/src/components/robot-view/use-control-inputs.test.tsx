import { act, fireEvent, renderHook } from '@testing-library/react';
import {
  useControlKeyboard,
  useGamepadControl,
  useHeldControlRepeater,
} from './use-control-inputs';
import type { ControlButton } from './types';

const forwardButton: ControlButton = {
  id: 'button-forward',
  label: 'Forward',
  command: 'forward',
  hotKey: 'w',
  icon: null,
  cooldownMs: 100,
  costCredits: 0,
  access: 'QUEUE_TURN',
  position: 0,
  color: null,
};

const customButton: ControlButton = {
  ...forwardButton,
  id: 'button-horn',
  label: 'Horn',
  command: 'horn',
  hotKey: 'h',
  access: 'EVERYONE',
  position: 1,
};

describe('robot control input hooks', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    Object.defineProperty(navigator, 'getGamepads', {
      configurable: true,
      writable: true,
      value: vi.fn(() => []),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('repeats only held motion commands with their button identity', () => {
    const sendCommand = vi.fn();
    const { rerender, unmount } = renderHook(
      ({ activeCommands }) =>
        useHeldControlRepeater({
          activeCommands,
          controlButtons: [forwardButton],
          sendCommand,
        }),
      { initialProps: { activeCommands: new Set<string>() } },
    );
    act(() => vi.advanceTimersByTime(800));
    expect(sendCommand).not.toHaveBeenCalled();

    rerender({ activeCommands: new Set(['forward', 'horn']) });
    act(() => vi.advanceTimersByTime(800));
    expect(sendCommand).toHaveBeenCalledTimes(2);
    expect(sendCommand).toHaveBeenCalledWith('forward', {
      cooldownMs: 0,
      access: 'QUEUE_TURN',
      buttonId: 'button-forward',
    });
    unmount();
    act(() => vi.advanceTimersByTime(400));
    expect(sendCommand).toHaveBeenCalledTimes(2);
  });

  it('maps keyboard motion, custom buttons, release-stop, and emergency stop', () => {
    const sendCommand = vi.fn();
    const triggerEStop = vi.fn();
    const releaseLocalControls = vi.fn();
    const activeMotionKeysRef = { current: new Set<string>() };
    const setActiveKeys = vi.fn();
    const setActiveCommands = vi.fn();
    const chatInput = document.createElement('input');

    const { unmount } = renderHook(() =>
      useControlKeyboard({
        controlButtons: [forwardButton, customButton],
        focusMode: 'controls',
        chatInputRef: { current: chatInput },
        activeMotionKeysRef,
        setActiveKeys,
        setActiveCommands,
        canUseEStop: true,
        sendCommand,
        triggerEStop,
        releaseLocalControls,
      }),
    );

    fireEvent.keyDown(window, { key: 'w' });
    expect(sendCommand).toHaveBeenCalledWith('forward', {
      cooldownMs: 100,
      access: 'QUEUE_TURN',
      buttonId: 'button-forward',
    });
    expect(activeMotionKeysRef.current.has('w')).toBe(true);
    fireEvent.keyUp(window, { key: 'w' });
    expect(sendCommand).toHaveBeenLastCalledWith('stop', {
      cooldownMs: 0,
      access: 'QUEUE_TURN',
    });

    fireEvent.keyDown(window, { key: 'h' });
    expect(sendCommand).toHaveBeenCalledWith('horn', {
      cooldownMs: 100,
      access: 'EVERYONE',
      buttonId: 'button-horn',
    });
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(triggerEStop).toHaveBeenCalledTimes(1);
    unmount();
    expect(releaseLocalControls).toHaveBeenCalledWith(false);
  });

  it('ignores repeats, modified keys, chat/editing targets, and non-motion keyup', () => {
    const sendCommand = vi.fn();
    const activeMotionKeysRef = { current: new Set<string>() };
    const input = document.createElement('input');
    document.body.append(input);
    const { rerender } = renderHook(
      ({ focusMode, canUseEStop }) =>
        useControlKeyboard({
          controlButtons: [],
          focusMode: focusMode as 'controls' | 'chat',
          chatInputRef: { current: input },
          activeMotionKeysRef,
          setActiveKeys: vi.fn(),
          setActiveCommands: vi.fn(),
          canUseEStop,
          sendCommand,
          triggerEStop: vi.fn(),
          releaseLocalControls: vi.fn(),
        }),
      { initialProps: { focusMode: 'controls', canUseEStop: false } },
    );

    fireEvent.keyDown(window, { key: 'w', ctrlKey: true });
    fireEvent.keyDown(window, { key: 'w', repeat: true });
    fireEvent.keyDown(input, { key: 'w' });
    fireEvent.keyUp(input, { key: 'w' });
    fireEvent.keyUp(window, { key: 'h' });
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(sendCommand).not.toHaveBeenCalled();

    rerender({ focusMode: 'chat', canUseEStop: false });
    fireEvent.keyDown(window, { key: 'w' });
    expect(sendCommand).not.toHaveBeenCalled();
    input.remove();
  });

  it('polls a connected gamepad, sends edges, and stops when input returns neutral', () => {
    let pads: Array<Partial<Gamepad> | null> = [
      {
        connected: true,
        axes: [0.8, -0.8],
        buttons: Array.from({ length: 16 }, () => ({ pressed: false })) as GamepadButton[],
      },
    ];
    vi.mocked(navigator.getGamepads).mockImplementation(() => pads as Gamepad[]);
    const sendCommand = vi.fn();
    const { unmount } = renderHook(() =>
      useGamepadControl({
        enabled: true,
        isMyTurn: true,
        controlButtons: [forwardButton],
        sendCommand,
      }),
    );

    act(() => vi.advanceTimersByTime(120));
    expect(sendCommand).toHaveBeenCalledWith('forward', {
      cooldownMs: 0,
      access: 'QUEUE_TURN',
      buttonId: 'button-forward',
    });
    expect(sendCommand).toHaveBeenCalledWith('right', {
      cooldownMs: 0,
      access: 'QUEUE_TURN',
      buttonId: undefined,
    });

    pads = [{ connected: true, axes: [0, 0], buttons: [] as GamepadButton[] }];
    act(() => vi.advanceTimersByTime(120));
    expect(sendCommand).toHaveBeenLastCalledWith('stop', {
      cooldownMs: 0,
      access: 'QUEUE_TURN',
    });
    unmount();
  });

  it('supports d-pad controls, turn gating, disabled mode, and cleanup stop', () => {
    const buttons = Array.from({ length: 16 }, () => ({ pressed: false })) as GamepadButton[];
    buttons[12] = { pressed: true } as GamepadButton;
    buttons[14] = { pressed: true } as GamepadButton;
    vi.mocked(navigator.getGamepads).mockReturnValue([
      { connected: true, axes: [], buttons } as unknown as Gamepad,
    ] as unknown as Gamepad[]);
    const sendCommand = vi.fn();
    const enabled = renderHook(() =>
      useGamepadControl({ enabled: true, isMyTurn: true, controlButtons: [], sendCommand }),
    );
    act(() => vi.advanceTimersByTime(120));
    expect(sendCommand).toHaveBeenCalledWith('forward', expect.anything());
    expect(sendCommand).toHaveBeenCalledWith('left', expect.anything());
    enabled.unmount();
    expect(sendCommand).toHaveBeenLastCalledWith('stop', {
      cooldownMs: 0,
      access: 'QUEUE_TURN',
    });

    sendCommand.mockClear();
    const noTurn = renderHook(() =>
      useGamepadControl({ enabled: true, isMyTurn: false, controlButtons: [], sendCommand }),
    );
    act(() => vi.advanceTimersByTime(240));
    expect(sendCommand).not.toHaveBeenCalled();
    noTurn.unmount();

    const disabled = renderHook(() =>
      useGamepadControl({ enabled: false, isMyTurn: true, controlButtons: [], sendCommand }),
    );
    act(() => vi.advanceTimersByTime(240));
    expect(sendCommand).not.toHaveBeenCalled();
    disabled.unmount();
  });
});
