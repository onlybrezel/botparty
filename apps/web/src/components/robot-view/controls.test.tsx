import { fireEvent, render, screen } from '@testing-library/react';
import { ControlKey, SliderControl, XYPadControl, formatCountdown } from './controls';

describe('robot-view controls', () => {
  it('fires press and release handlers for control keys', () => {
    const onPress = vi.fn();
    const onRelease = vi.fn();

    render(
      <ControlKey
        label="Forward"
        hotKey="w"
        command="forward"
        isDown={false}
        isCrowd={false}
        onPress={onPress}
        onRelease={onRelease}
      />,
    );

    const button = screen.getByRole('button', { name: 'Forward control button' });
    fireEvent.pointerDown(button);
    fireEvent.pointerUp(button);

    expect(onPress).toHaveBeenCalledTimes(1);
    expect(onRelease).toHaveBeenCalledTimes(1);
  });

  it('uses the standard vertical range orientation, sends values, and recenters', () => {
    const onSendValue = vi.fn();

    render(
      <SliderControl
        label="Speed"
        command="speed"
        config={{
          kind: 'slider',
          min: 0,
          max: 100,
          start: 50,
          step: 10,
          direction: 'vertical',
          returnMode: 'center',
          resetOnQueueLoss: false,
          resetOnOffline: false,
          resetAfterMs: null,
        }}
        color={null}
        cooldownMs={200}
        access="QUEUE_TURN"
        isCrowd={false}
        disabled={false}
        queueResetEpoch={0}
        offlineResetEpoch={0}
        onSendValue={onSendValue}
      />,
    );

    const slider = screen.getByLabelText('Speed slider');
    expect(slider).toHaveClass('[direction:rtl]', '[writing-mode:vertical-lr]');
    expect(slider.className).not.toContain('appearance');
    fireEvent.change(slider, { target: { value: '80' } });
    fireEvent.pointerUp(slider);

    expect(onSendValue).toHaveBeenNthCalledWith(1, 80);
    expect(onSendValue).toHaveBeenNthCalledWith(2, 50);
    expect(formatCountdown(65000)).toBe('1:05');
  });

  it('supports pointer-driven XY pad controls for touch devices', () => {
    const onSendValue = vi.fn();

    render(
      <XYPadControl
        label="Drive"
        command="drive_xy"
        config={{
          kind: 'xy',
          xMin: -100,
          xMax: 100,
          xStart: 0,
          yMin: -100,
          yMax: 100,
          yStart: 0,
          returnMode: 'center',
          resetOnQueueLoss: false,
          resetOnOffline: false,
          resetAfterMs: null,
        }}
        color={null}
        cooldownMs={120}
        access="QUEUE_TURN"
        isCrowd={false}
        disabled={false}
        queueResetEpoch={0}
        offlineResetEpoch={0}
        onSendValue={onSendValue}
      />,
    );

    const pad = screen.getByRole('slider', { name: 'Drive XY pad' }) as HTMLDivElement & {
      setPointerCapture?: (pointerId: number) => void;
    };
    pad.setPointerCapture = vi.fn();
    Object.defineProperty(pad, 'getBoundingClientRect', {
      value: () => ({
        left: 0,
        top: 0,
        width: 100,
        height: 100,
        right: 100,
        bottom: 100,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }),
    });

    fireEvent(
      pad,
      Object.assign(new Event('pointerdown', { bubbles: true }), {
        clientX: 75,
        clientY: 25,
        pointerId: 1,
        buttons: 1,
      }),
    );
    fireEvent(
      pad,
      Object.assign(new Event('pointerup', { bubbles: true }), {
        pointerId: 1,
      }),
    );

    expect(onSendValue).toHaveBeenNthCalledWith(1, { x: 50, y: 50 });
    expect(onSendValue).toHaveBeenNthCalledWith(2, { x: 0, y: 0 });
  });

  it('supports arrow-key movement and keyboard reset on the XY pad', () => {
    const onSendValue = vi.fn();

    render(
      <XYPadControl
        label="Drive"
        command="drive_xy"
        config={{
          kind: 'xy',
          xMin: -100,
          xMax: 100,
          xStart: 0,
          yMin: -100,
          yMax: 100,
          yStart: 0,
          returnMode: 'center',
          resetOnQueueLoss: false,
          resetOnOffline: false,
          resetAfterMs: null,
        }}
        color={null}
        cooldownMs={120}
        access="QUEUE_TURN"
        isCrowd={false}
        disabled={false}
        queueResetEpoch={0}
        offlineResetEpoch={0}
        onSendValue={onSendValue}
      />,
    );

    const pad = screen.getByRole('slider', { name: 'Drive XY pad' });
    fireEvent.keyDown(pad, { key: 'ArrowRight' });
    fireEvent.keyDown(pad, { key: 'ArrowUp' });
    fireEvent.keyDown(pad, { key: 'Home' });

    expect(onSendValue).toHaveBeenNthCalledWith(1, { x: 10, y: 0 });
    expect(onSendValue).toHaveBeenNthCalledWith(2, { x: 10, y: 10 });
    expect(onSendValue).toHaveBeenNthCalledWith(3, { x: 0, y: 0 });
  });
});
