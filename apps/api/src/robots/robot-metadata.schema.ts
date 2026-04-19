import { z } from 'zod';

const guestAccessSchema = z.enum(['ALL', 'AUTHENTICATED', 'DISABLED']);

const streamCameraSchema = z.object({
  id: z.string().trim().min(1),
  label: z.string().trim().min(1).optional(),
  role: z.string().trim().min(1).optional(),
  enabled: z.boolean().optional(),
  publishMode: z.string().trim().min(1).optional(),
});

const streamSchema = z.object({
  targetBitrateKbps: z.number().int().min(150).max(3000).nullable().optional(),
  activeCameraId: z.string().trim().min(1).optional(),
  cameras: z.array(streamCameraSchema).max(16).optional(),
});

const authSchema = z.object({
  boundDeviceHash: z.string().trim().min(1).optional(),
});

export const robotMetadataSchema = z.object({
  access: z
    .object({
      video: guestAccessSchema.optional(),
      control: guestAccessSchema.optional(),
      chat: guestAccessSchema.optional(),
      estop: guestAccessSchema.optional(),
    })
    .optional(),
  stream: streamSchema.optional(),
  auth: authSchema.optional(),
  claimTokenIssuedAt: z.string().datetime().optional(),
  streamKeyIssuedAt: z.string().datetime().optional(),
}).passthrough();

export type RobotMetadata = z.infer<typeof robotMetadataSchema>;

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return { ...(value as Record<string, unknown>) };
}

export function normalizeRobotMetadata(value: unknown): RobotMetadata {
  const raw = asRecord(value);
  const parsed = robotMetadataSchema.safeParse(raw);
  if (parsed.success) {
    return parsed.data;
  }

  const next: Record<string, unknown> = {};

  const accessParsed = robotMetadataSchema.shape.access.safeParse(raw.access);
  if (accessParsed.success) {
    next.access = accessParsed.data;
  }

  const streamParsed = robotMetadataSchema.shape.stream.safeParse(raw.stream);
  if (streamParsed.success) {
    next.stream = streamParsed.data;
  }

  const authParsed = robotMetadataSchema.shape.auth.safeParse(raw.auth);
  if (authParsed.success) {
    next.auth = authParsed.data;
  }

  const claimParsed = z.string().datetime().safeParse(raw.claimTokenIssuedAt);
  if (claimParsed.success) {
    next.claimTokenIssuedAt = claimParsed.data;
  }

  const streamKeyParsed = z.string().datetime().safeParse(raw.streamKeyIssuedAt);
  if (streamKeyParsed.success) {
    next.streamKeyIssuedAt = streamKeyParsed.data;
  }

  return next as RobotMetadata;
}

export function mergeRobotMetadata(
  current: unknown,
  patch: {
    access?: Record<string, unknown>;
    stream?: Record<string, unknown>;
  },
): RobotMetadata {
  const metadata = normalizeRobotMetadata(current);

  const next: Record<string, unknown> = {
    ...metadata,
  };

  if (patch.access) {
    next.access = {
      ...(asRecord(metadata.access)),
      ...patch.access,
    };
  }

  if (patch.stream) {
    next.stream = {
      ...(asRecord(metadata.stream)),
      ...patch.stream,
    };
  }

  return normalizeRobotMetadata(next);
}