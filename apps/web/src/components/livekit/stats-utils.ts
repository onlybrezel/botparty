import type { TrackReference } from '@livekit/components-react';
import type { RobotStreamCameraConfig } from '@botparty/shared';

export type SparklineBounds = {
  min: number;
  max: number;
};

export type CameraTrackView = {
  id: string;
  label: string;
  role: string | null;
  order: number;
  trackRef: TrackReference;
  trackName: string;
};

export type StreamConfig = {
  activeCameraId?: string;
  cameras?: RobotStreamCameraConfig[];
} | null | undefined;

export type PanelPosition = {
  x: number;
  y: number;
};

export type DragState = {
  offsetX: number;
  offsetY: number;
};

export type VolumePreference = {
  volume: number;
  isMuted: boolean;
};

const DEFAULT_VOLUME_PREFERENCE: VolumePreference = {
  volume: 100,
  isMuted: false,
};

export function formatStat(value: string | number | null | undefined, suffix = '') {
  if (value === null || value === undefined || value === '') {
    return 'n/a';
  }
  return `${value}${suffix}`;
}

export function maskIdentifier(value: string | undefined, visible = 8) {
  if (!value) {
    return 'n/a';
  }
  if (value.length <= visible) {
    return value;
  }
  return `${value.slice(0, visible)}...`;
}

export function formatPercent(value: number | null | undefined) {
  if (value === null || value === undefined) {
    return 'n/a';
  }
  return `${value}%`;
}

function prettifyCameraId(id: string) {
  return id
    .replace(/[._-]+/g, ' ')
    .trim()
    .replace(/\b\w/g, (part) => part.toUpperCase()) || 'Camera';
}

function readTrackName(trackRef: TrackReference) {
  const publication = trackRef.publication as { trackName?: string; name?: string } | undefined;
  return publication?.trackName ?? publication?.name ?? '';
}

function readParticipantIdentity(trackRef: TrackReference) {
  const participant = trackRef.participant as { identity?: string; name?: string } | undefined;
  const publication = trackRef.publication as {
    participant?: { identity?: string; name?: string };
  } | undefined;
  return (
    participant?.identity
    ?? publication?.participant?.identity
    ?? participant?.name
    ?? publication?.participant?.name
    ?? ''
  );
}

function parseCameraIdFromTrackName(trackName: string) {
  const trimmed = trackName.trim();
  if (!trimmed) {
    return null;
  }

  if (trimmed === 'camera') {
    return 'front';
  }

  const match = /^camera[.:]([a-zA-Z0-9_-]+)$/.exec(trimmed);
  if (match) {
    return match[1];
  }

  return null;
}

function parseCameraIdFromParticipantIdentity(identity: string) {
  const trimmed = identity.trim();
  if (!trimmed) {
    return null;
  }

  const robotMediaMatch = /^robot-media:[^:]+:(.+)$/.exec(trimmed);
  if (robotMediaMatch) {
    return robotMediaMatch[1];
  }

  return null;
}

function parseCameraIdFromParticipantLabel(
  identityOrName: string,
  configuredCameras: RobotStreamCameraConfig[] = [],
) {
  const normalized = identityOrName.trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  const match = configuredCameras.find((camera) => {
    const label = camera.label?.trim().toLowerCase();
    const id = camera.id?.trim().toLowerCase();
    return Boolean((label && normalized.endsWith(label)) || (id && normalized.endsWith(id)));
  });

  return match?.id ?? null;
}

export function buildCameraTracks(trackRefs: TrackReference[], streamConfig?: StreamConfig): CameraTrackView[] {
  const configuredCameras = streamConfig?.cameras ?? [];

  return trackRefs
    .map((trackRef, index) => {
      const trackName = readTrackName(trackRef);
      const participantIdentity = readParticipantIdentity(trackRef);
      const parsedCameraId =
        parseCameraIdFromTrackName(trackName)
        ?? parseCameraIdFromParticipantIdentity(participantIdentity)
        ?? parseCameraIdFromParticipantLabel(participantIdentity, configuredCameras);
      const configured =
        (parsedCameraId ? configuredCameras.find((camera) => camera.id === parsedCameraId) : undefined);
      const id = configured?.id ?? parsedCameraId ?? `camera-${index + 1}`;
      const label = configured?.label?.trim() || prettifyCameraId(id);
      const role = configured?.role?.trim() || (index === 0 ? 'primary' : null);
      const order = configuredCameras.findIndex((camera) => camera.id === id);

      return {
        id,
        label,
        role,
        order: order >= 0 ? order : index,
        trackRef,
        trackName,
      };
    })
    .sort((left, right) => left.order - right.order);
}

export function readVolumePreference(storageKey?: string | null): VolumePreference {
  if (!storageKey || typeof window === 'undefined') {
    return DEFAULT_VOLUME_PREFERENCE;
  }

  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) {
      return DEFAULT_VOLUME_PREFERENCE;
    }

    const parsed = JSON.parse(raw) as Partial<VolumePreference>;
    return {
      volume:
        typeof parsed.volume === 'number' ? Math.max(0, Math.min(parsed.volume, 100)) : DEFAULT_VOLUME_PREFERENCE.volume,
      isMuted: Boolean(parsed.isMuted),
    };
  } catch {
    return DEFAULT_VOLUME_PREFERENCE;
  }
}

export function clampFloatingPosition(
  nextPosition: PanelPosition,
  containerWidth: number,
  containerHeight: number,
  floatingWidth: number,
  floatingHeight: number,
  margin = 12,
): PanelPosition {
  return {
    x: Math.max(margin, Math.min(nextPosition.x, Math.max(margin, containerWidth - floatingWidth - margin))),
    y: Math.max(margin, Math.min(nextPosition.y, Math.max(margin, containerHeight - floatingHeight - margin))),
  };
}

export function getSparklineBounds(
  values: Array<number | null>,
  {
    baseline = 0,
    minRange = 1,
    paddingRatio = 0.12,
  }: {
    baseline?: number;
    minRange?: number;
    paddingRatio?: number;
  } = {},
): SparklineBounds | null {
  const numericValues = values.filter((value): value is number => value !== null && Number.isFinite(value));
  if (numericValues.length === 0) {
    return null;
  }

  let min = Math.min(...numericValues, baseline);
  let max = Math.max(...numericValues, baseline);
  const rawRange = max - min;
  const paddedRange = Math.max(rawRange, minRange);
  const padding = paddedRange * paddingRatio;

  min -= padding;
  max += padding;

  if (baseline >= 0) {
    min = Math.max(0, min);
  }

  if (max - min < minRange) {
    const deficit = minRange - (max - min);
    min = Math.max(baseline >= 0 ? 0 : Number.NEGATIVE_INFINITY, min - deficit / 2);
    max += deficit / 2;
  }

  return { min, max };
}

export function buildSparklinePath(values: Array<number | null>, width: number, height: number, bounds: SparklineBounds | null) {
  const numericValues = values.filter((value): value is number => value !== null && Number.isFinite(value));
  if (numericValues.length < 2 || !bounds) {
    return '';
  }

  const { min, max } = bounds;
  const range = Math.max(max - min, 1);
  const stepX = values.length > 1 ? width / (values.length - 1) : width;

  let path = '';
  values.forEach((value, index) => {
    if (value === null || !Number.isFinite(value)) {
      return;
    }
    const x = index * stepX;
    const y = height - ((value - min) / range) * height;
    path += path ? ` L ${x} ${y}` : `M ${x} ${y}`;
  });

  return path;
}
