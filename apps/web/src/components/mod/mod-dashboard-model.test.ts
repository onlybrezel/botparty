import { describe, expect, it } from 'vitest';
import { parseRecordingMeta, validateRobotDraftSchedule, type RobotDraft } from './mod-dashboard-model';

const draft: RobotDraft = {
  name: 'Robot',
  slug: 'robot',
  description: '',
  roomMode: 'PUBLIC',
  queueMode: 'FIRST_COME',
  scheduleEnabled: true,
  scheduleStart: '2026-07-17T10:00',
  scheduleEnd: '2026-07-17T11:00',
  timezone: 'Europe/Berlin',
  aclVideo: 'ALL',
  aclControl: 'AUTHENTICATED',
  aclChat: 'AUTHENTICATED',
  aclEStop: 'AUTHENTICATED',
  targetBitrateKbps: '1200',
  maxTurnTime: '60000',
  maxViewers: '100',
  maxControllers: '1',
  tags: '',
  accessPassword: '',
};

describe('mod dashboard model', () => {
  it('validates schedule order and IANA timezone', () => {
    expect(validateRobotDraftSchedule(draft)).toBeNull();
    expect(validateRobotDraftSchedule({ ...draft, scheduleEnd: draft.scheduleStart })).toMatch(/later/);
    expect(validateRobotDraftSchedule({ ...draft, timezone: 'Mars/Base' })).toMatch(/IANA/);
    expect(validateRobotDraftSchedule({ ...draft, scheduleEnabled: false, scheduleStart: '' })).toBeNull();
  });

  it('prefers relational recording metadata over legacy file-name parsing', () => {
    const recordedAt = '2026-07-17T09:00:00.000Z';
    expect(parseRecordingMeta({
      fileName: 'unstructured.mp4',
      robotId: 'robot-1',
      modifiedAt: recordedAt,
      cameraId: 'front',
      recordedAt,
    })).toEqual({ robotId: 'robot-1', cameraId: 'front', recordedAt: new Date(recordedAt) });
  });

  it('keeps legacy recording parsing isolated to old entries', () => {
    expect(parseRecordingMeta({
      fileName: 'robot-11111111-1111-1111-1111-111111111111-camera-front-2026-07-17T090000.mp4',
      robotId: null,
      modifiedAt: '2026-07-17T09:01:00.000Z',
      cameraId: null,
      recordedAt: null,
    })).toEqual(expect.objectContaining({
      robotId: '11111111-1111-1111-1111-111111111111',
      cameraId: 'front',
    }));
  });
});
