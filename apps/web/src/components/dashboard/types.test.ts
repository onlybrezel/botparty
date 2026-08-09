import { ControlButtonAccess, QueueMode, RobotAccessMode, RobotStatus, RobotVisibility } from '@botparty/shared';
import type { ControlButtonRecord, RobotManaged } from '@/lib/api';
import {
  applyControlPreset,
  buildWidgetSpec,
  DEFAULT_CONTROL_DRAFT,
  DEFAULT_CREATE_FORM,
  detectRoomMode,
  draftFromControl,
  formFromRobot,
  queueModeDescription,
  roomModeToFields,
  toUpdatePayload,
  validateRobotFormSchedule,
} from './types';
import type { RoomMode } from './types';
import { createRobotManaged } from '@/test/robot-fixtures';

const robot = createRobotManaged({
  id: 'robot-1',
  name: 'Rover',
  slug: 'rover',
  description: null,
  thumbnailUrl: null,
  visibility: RobotVisibility.PUBLIC,
  accessMode: RobotAccessMode.OPEN,
  queueMode: QueueMode.FIRST_COME,
  status: RobotStatus.ONLINE,
  maxTurnTime: 60_000,
  maxViewers: 100,
  maxControllers: 5,
  scheduleStart: null,
  scheduleEnd: null,
  tags: ['demo'],
  metadata: null,
});

const button: ControlButtonRecord = {
  id: 'button-1',
  label: 'Pan',
  command: 'ptz_pan',
  hotKey: null,
  icon: null,
  cooldownMs: 200,
  costCredits: 0,
  access: ControlButtonAccess.QUEUE_TURN,
  position: 0,
  color: null,
  isEnabled: true,
};

describe('dashboard domain mappings', () => {
  it('applies every control preset while retaining explicit labels and commands', () => {
    const pan = applyControlPreset(DEFAULT_CONTROL_DRAFT, 'ptz-pan');
    expect(pan).toEqual(
      expect.objectContaining({ label: 'Pan', command: 'ptz_pan', sliderDirection: 'horizontal' }),
    );
    expect(applyControlPreset(DEFAULT_CONTROL_DRAFT, 'ptz-tilt')).toEqual(
      expect.objectContaining({ label: 'Tilt', command: 'ptz_tilt', sliderDirection: 'vertical' }),
    );
    expect(applyControlPreset(DEFAULT_CONTROL_DRAFT, 'drive-speed')).toEqual(
      expect.objectContaining({ label: 'Speed', command: 'set_speed', sliderStart: '50' }),
    );
    expect(applyControlPreset(DEFAULT_CONTROL_DRAFT, 'gripper')).toEqual(
      expect.objectContaining({ label: 'Gripper', widgetReturn: 'center' }),
    );
    expect(applyControlPreset(DEFAULT_CONTROL_DRAFT, 'arm-xy')).toEqual(
      expect.objectContaining({ label: 'Arm XY', command: 'arm_xy', controlKind: 'xy' }),
    );
    expect(
      applyControlPreset(
        { ...DEFAULT_CONTROL_DRAFT, label: 'Custom', command: 'custom' },
        'ptz-pan',
      ),
    ).toEqual(expect.objectContaining({ label: 'Custom', command: 'custom' }));
  });

  it('maps every room mode in both directions', () => {
    const roomModes: RoomMode[] = [
      'PUBLIC',
      'UNLISTED',
      'LINK_ONLY',
      'PASSWORD',
      'ALLOWED_USERS',
      'PRIVATE',
    ];
    expect(detectRoomMode({ visibility: 'PRIVATE', accessMode: 'OPEN' })).toBe('PRIVATE');
    expect(detectRoomMode({ visibility: 'UNLISTED', accessMode: 'OPEN' })).toBe('UNLISTED');
    expect(detectRoomMode({ visibility: 'PUBLIC', accessMode: 'ALLOWED_USERS' })).toBe(
      'ALLOWED_USERS',
    );
    expect(detectRoomMode({ visibility: 'PUBLIC', accessMode: 'LINK_ONLY' })).toBe('LINK_ONLY');
    expect(detectRoomMode({ visibility: 'PUBLIC', accessMode: 'PASSWORD' })).toBe('PASSWORD');
    expect(detectRoomMode({ visibility: 'PUBLIC', accessMode: 'OPEN' })).toBe('PUBLIC');
    expect(
      roomModes.map(roomModeToFields),
    ).toEqual([
      { visibility: 'PUBLIC', accessMode: 'OPEN' },
      { visibility: 'UNLISTED', accessMode: 'OPEN' },
      { visibility: 'UNLISTED', accessMode: 'LINK_ONLY' },
      { visibility: 'PUBLIC', accessMode: 'PASSWORD' },
      { visibility: 'UNLISTED', accessMode: 'ALLOWED_USERS' },
      { visibility: 'PRIVATE', accessMode: 'OPEN' },
    ]);
  });

  it('describes each queue mode', () => {
    expect(queueModeDescription('VOTING')).toContain('vote');
    expect(queueModeDescription('DISABLED')).toContain('no queue');
    expect(queueModeDescription('FIRST_COME')).toContain('First come');
  });

  it('normalizes robot form payloads, schedule, limits, access, and tags', () => {
    const payload = toUpdatePayload({
      ...DEFAULT_CREATE_FORM,
      name: ' Rover ',
      slug: ' rover ',
      description: ' Demo ',
      thumbnailUrl: ' https://example.test/robot.jpg ',
      roomMode: 'PASSWORD',
      queueMode: 'VOTING',
      targetBitrateKbps: '1999.7',
      scheduleEnabled: true,
      scheduleStart: '2026-07-17T12:00',
      scheduleEnd: '2026-07-17T13:00',
      timezone: ' Europe/Berlin ',
      tags: ' demo, indoor, ,',
      accessPassword: ' secret ',
    });
    expect(payload).toEqual(
      expect.objectContaining({
        name: 'Rover',
        slug: 'rover',
        description: 'Demo',
        thumbnailUrl: 'https://example.test/robot.jpg',
        visibility: 'PUBLIC',
        accessMode: 'PASSWORD',
        queueMode: 'VOTING',
        stream: { targetBitrateKbps: 2000 },
        timezone: 'Europe/Berlin',
        tags: ['demo', 'indoor'],
        accessPassword: 'secret',
      }),
    );
    expect(payload.scheduleStart).toMatch(/2026-07-17T/);
    expect(payload.scheduleEnd).toMatch(/2026-07-17T/);

    const defaults = toUpdatePayload({
      ...DEFAULT_CREATE_FORM,
      name: 'Robot',
      targetBitrateKbps: 'invalid',
      timezone: '',
    });
    expect(defaults).toEqual(
      expect.objectContaining({
        scheduleStart: null,
        scheduleEnd: null,
        stream: {},
      }),
    );
    expect(defaults).not.toHaveProperty('slug');
    expect(defaults).not.toHaveProperty('description');
    expect(defaults).not.toHaveProperty('thumbnailUrl');
    expect(defaults).not.toHaveProperty('accessPassword');
    expect(defaults.timezone).toBeTruthy();
  });

  it('validates every schedule failure and accepts valid IANA schedules', () => {
    expect(validateRobotFormSchedule(DEFAULT_CREATE_FORM)).toBeNull();
    const enabled = { ...DEFAULT_CREATE_FORM, scheduleEnabled: true };
    expect(validateRobotFormSchedule(enabled)).toContain('both');
    expect(
      validateRobotFormSchedule({ ...enabled, scheduleStart: 'bad', scheduleEnd: 'also bad' }),
    ).toContain('valid');
    expect(
      validateRobotFormSchedule({
        ...enabled,
        scheduleStart: '2026-07-17T13:00',
        scheduleEnd: '2026-07-17T12:00',
      }),
    ).toContain('later');
    expect(
      validateRobotFormSchedule({
        ...enabled,
        scheduleStart: '2026-07-17T12:00',
        scheduleEnd: '2026-07-17T13:00',
        timezone: ' ',
      }),
    ).toContain('required');
    expect(
      validateRobotFormSchedule({
        ...enabled,
        scheduleStart: '2026-07-17T12:00',
        scheduleEnd: '2026-07-17T13:00',
        timezone: 'Mars/Olympus',
      }),
    ).toContain('IANA');
    expect(
      validateRobotFormSchedule({
        ...enabled,
        scheduleStart: '2026-07-17T12:00',
        scheduleEnd: '2026-07-17T13:00',
        timezone: 'Europe/Berlin',
      }),
    ).toBeNull();
  });

  it('creates editable forms from sparse and fully configured robots', () => {
    expect(formFromRobot(robot)).toEqual(
      expect.objectContaining({
        name: 'Rover',
        description: '',
        thumbnailUrl: '',
        roomMode: 'PUBLIC',
        aclVideo: 'AUTHENTICATED',
        targetBitrateKbps: '',
        scheduleEnabled: false,
        scheduleStart: '',
        scheduleEnd: '',
        tags: 'demo',
      }),
    );
    const configured = formFromRobot({
      ...robot,
      visibility: 'UNLISTED',
      accessMode: 'LINK_ONLY',
      description: 'Description',
      thumbnailUrl: 'https://example.test/image.jpg',
      scheduleStart: '2026-07-17T12:00:00.000Z',
      scheduleEnd: 'invalid',
      timezone: 'UTC',
      metadata: {
        access: { video: 'ALL', control: 'DISABLED', chat: 'ALL', estop: 'AUTHENTICATED' },
        stream: { targetBitrateKbps: 1200 },
      },
    } as RobotManaged);
    expect(configured).toEqual(
      expect.objectContaining({
        roomMode: 'LINK_ONLY',
        aclVideo: 'ALL',
        aclControl: 'DISABLED',
        targetBitrateKbps: '1200',
        scheduleEnabled: true,
        scheduleEnd: '',
      }),
    );
  });

  it('serializes button, slider, and XY widget specifications', () => {
    expect(buildWidgetSpec({ ...DEFAULT_CONTROL_DRAFT, icon: 'Light' })).toBe('Light');
    expect(buildWidgetSpec(DEFAULT_CONTROL_DRAFT)).toBeUndefined();
    expect(
      buildWidgetSpec({
        ...DEFAULT_CONTROL_DRAFT,
        controlKind: 'slider',
        sliderDirection: 'vertical',
        widgetReturn: 'center',
        resetOnQueueLoss: true,
        resetOnOffline: false,
        resetAfterMs: '250.4',
      }),
    ).toBe('widget:s:min=-100:max=100:start=0:step=1:dir=v:r=c:rq=1:ro=0:ttl=250');
    expect(
      buildWidgetSpec({
        ...DEFAULT_CONTROL_DRAFT,
        controlKind: 'xy',
        resetAfterMs: '20',
      }),
    ).toBe('widget:xy:xn=-100:xx=100:x0=0:yn=-100:yx=100:y0=0:r=n:rq=0:ro=1');
  });

  it('parses plain, slider aliases, defaults, and XY widget controls', () => {
    expect(draftFromControl(button)).toEqual(
      expect.objectContaining({ controlKind: 'button', icon: '', hotKey: '', color: '' }),
    );
    expect(draftFromControl({ ...button, icon: 'light', hotKey: 'l', color: '#fff' })).toEqual(
      expect.objectContaining({ controlKind: 'button', icon: 'light', hotKey: 'l', color: '#fff' }),
    );
    const slider = draftFromControl({
      ...button,
      icon: 'widget:slider:min=0:max=10:v0=4:step=2:dir=v:return=c:rq=1:ro=0:ttl=500:ignored',
    });
    expect(slider).toEqual(
      expect.objectContaining({
        controlKind: 'slider',
        sliderMin: '0',
        sliderMax: '10',
        sliderStart: '4',
        sliderStep: '2',
        sliderDirection: 'vertical',
        widgetReturn: 'center',
        resetOnQueueLoss: true,
        resetOnOffline: false,
        resetAfterMs: '500',
      }),
    );
    expect(draftFromControl({ ...button, icon: 'widget:s' })).toEqual(
      expect.objectContaining({
        controlKind: 'slider',
        sliderMin: '-100',
        sliderDirection: 'horizontal',
      }),
    );
    expect(
      draftFromControl({
        ...button,
        icon: 'widget:xy:xmin=-1:xmax=1:xstart=.2:ymin=-2:ymax=2:ystart=.5',
      }),
    ).toEqual(
      expect.objectContaining({
        controlKind: 'xy',
        xyXMin: '-1',
        xyXMax: '1',
        xyXStart: '.2',
        xyYMin: '-2',
        xyYMax: '2',
        xyYStart: '.5',
      }),
    );
  });
});
