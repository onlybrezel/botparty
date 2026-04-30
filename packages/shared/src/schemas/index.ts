import { z } from 'zod';
import { LIMITS } from '../constants/index.js';

const robotStreamCameraSchema = z.object({
  id: z.string().min(1).max(64),
  label: z.string().min(1).max(64).optional(),
  role: z.string().min(1).max(32).optional(),
  enabled: z.boolean().optional(),
  publishMode: z.enum(['always_on', 'preview_only', 'on_demand']).optional(),
});

const robotSlugSchema = z
  .string()
  .min(3)
  .max(50)
  .regex(
    /^[a-z0-9][a-z0-9-]*[a-z0-9]$/,
    'Slug must be 3-50 lowercase alphanumeric characters and hyphens, without a leading or trailing hyphen',
  );

const robotScheduleDateTimeSchema = z.string().datetime({ offset: true });

function validateRobotScheduleRange(
  data: { scheduleStart?: string | null; scheduleEnd?: string | null },
  ctx: z.RefinementCtx,
) {
  if (!data.scheduleStart || !data.scheduleEnd) {
    return;
  }

  const start = Date.parse(data.scheduleStart);
  const end = Date.parse(data.scheduleEnd);
  if (Number.isNaN(start) || Number.isNaN(end)) {
    return;
  }

  if (end <= start) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['scheduleEnd'],
      message: 'Schedule end must be later than schedule start',
    });
  }
}

// ─── Auth Schemas ────────────────────────────────────
export const usernameSchema = z
  .string()
  .min(3)
  .max(32)
  .regex(/^[a-zA-Z0-9_-]+$/, 'Only alphanumeric, hyphens, and underscores');

export const emailSchema = z.string().email();

export const passwordSchema = z.string().min(8).max(128);

export const registerSchema = z.object({
  username: usernameSchema,
  email: emailSchema,
  password: passwordSchema,
  displayName: z.string().min(1).max(64).optional(),
});

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1),
});

export const forgotPasswordSchema = z.object({
  email: emailSchema,
});

export const resetPasswordSchema = z.object({
  token: z.string().min(16).max(256),
  password: passwordSchema,
});

// ─── Robot Schemas ───────────────────────────────────
const robotWriteSchema = z.object({
  name: z.string().min(1).max(LIMITS.MAX_ROBOT_NAME_LENGTH),
  slug: robotSlugSchema.optional(),
  description: z.string().max(LIMITS.MAX_ROBOT_DESCRIPTION_LENGTH).optional(),
  thumbnailUrl: z.string().url().max(512).optional(),
  visibility: z.enum(['PUBLIC', 'UNLISTED', 'PRIVATE']).default('PUBLIC'),
  accessMode: z.enum(['OPEN', 'PASSWORD', 'LINK_ONLY', 'ALLOWED_USERS']).default('OPEN'),
  accessPassword: z.string().min(4).max(64).optional(),
  queueMode: z.enum(['FIRST_COME', 'VOTING', 'DISABLED']).default('FIRST_COME'),
  maxTurnTime: z
    .number()
    .int()
    .min(LIMITS.MIN_TURN_TIME_MS)
    .max(LIMITS.MAX_TURN_TIME_MS)
    .default(LIMITS.DEFAULT_TURN_TIME_MS),
  maxViewers: z.number().int().min(1).max(LIMITS.MAX_VIEWERS).default(1000),
  maxControllers: z.number().int().min(1).max(LIMITS.MAX_CONTROLLERS).default(10),
  tags: z
    .array(z.string().max(LIMITS.MAX_TAG_LENGTH))
    .max(LIMITS.MAX_TAGS)
    .default([]),
  acl: z
    .object({
      video: z.enum(['ALL', 'AUTHENTICATED', 'DISABLED']).default('AUTHENTICATED'),
      control: z.enum(['ALL', 'AUTHENTICATED', 'DISABLED']).default('AUTHENTICATED'),
      chat: z.enum(['ALL', 'AUTHENTICATED', 'DISABLED']).default('AUTHENTICATED'),
      estop: z.enum(['ALL', 'AUTHENTICATED', 'DISABLED']).default('AUTHENTICATED'),
    })
    .optional(),
  stream: z
    .object({
      targetBitrateKbps: z.number().int().min(150).max(3000).optional(),
      activeCameraId: z.string().min(1).max(64).optional(),
      cameras: z.array(robotStreamCameraSchema).max(8).optional(),
    })
    .optional(),
  scheduleStart: robotScheduleDateTimeSchema.nullable().optional(),
  scheduleEnd: robotScheduleDateTimeSchema.nullable().optional(),
  timezone: z.string().trim().min(1).max(64).default('UTC'),
});

export const createRobotSchema = robotWriteSchema.superRefine(validateRobotScheduleRange);

export const updateRobotSchema = robotWriteSchema.partial().extend({
  slug: robotSlugSchema.optional(),
}).superRefine(validateRobotScheduleRange);

// ─── Control Schemas ─────────────────────────────────
export const controlCommandSchema = z.object({
  command: z.string().min(1).max(64),
  value: z.union([z.number(), z.string(), z.boolean()]).optional(),
  timestamp: z.number(),
});

// ─── Chat Schemas ────────────────────────────────────
export const chatMessageSchema = z.object({
  content: z.string().min(1).max(LIMITS.MAX_CHAT_MESSAGE_LENGTH),
  robotId: z.string().uuid(),
});

// ─── Queue Schemas ───────────────────────────────────
export const queueJoinSchema = z.object({
  robotId: z.string().uuid(),
  priority: z.boolean().default(false),
});

// ─── Wallet & Billing Schemas ────────────────────────
export const donationRequestSchema = z.object({
  robotId: z.string().uuid(),
  amount: z
    .number()
    .int()
    .min(LIMITS.MIN_DONATION_CREDITS)
    .max(LIMITS.MAX_DONATION_CREDITS),
  message: z.string().trim().max(280).optional(),
});

export const checkoutRequestSchema = z.object({
  provider: z.enum(['stripe', 'paypal']),
  packageId: z.string().min(1).max(64),
  successUrl: z.string().url().max(512).optional(),
  cancelUrl: z.string().url().max(512).optional(),
});

export const payoutRequestSchema = z.object({
  amount: z
    .number()
    .int()
    .min(LIMITS.MIN_PAYOUT_REQUEST_CREDITS)
    .max(LIMITS.MAX_PAYOUT_REQUEST_CREDITS),
  destination: z.string().trim().min(3).max(128),
  notes: z.string().trim().max(1000).optional(),
});
