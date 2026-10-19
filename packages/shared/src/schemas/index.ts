import { z } from 'zod';
import './zod.js';
import { LEGAL_POLICY_VERSIONS, LIMITS } from '../constants/index.js';
import { isValidTimezone } from '../validation.js';

export { isValidTimezone } from '../validation.js';

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
const robotTimezoneSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .refine((value) => isValidTimezone(value), 'Timezone must be a valid IANA timezone');

function validateRobotScheduleRange(
  data: {
    scheduleStart?: string | null | undefined;
    scheduleEnd?: string | null | undefined;
  },
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
export * from './auth.js';

// ─── Robot Schemas ───────────────────────────────────
const robotWriteSchema = z.object({
  name: z.string().min(1).max(LIMITS.MAX_ROBOT_NAME_LENGTH),
  slug: robotSlugSchema.optional(),
  description: z.string().max(LIMITS.MAX_ROBOT_DESCRIPTION_LENGTH).optional(),
  thumbnailUrl: z.string().url().max(512).optional(),
  visibility: z.enum(['PUBLIC', 'UNLISTED', 'PRIVATE']).default('PRIVATE'),
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
  timezone: robotTimezoneSchema.default('UTC'),
});

export const createRobotSchema = robotWriteSchema.superRefine(validateRobotScheduleRange);

export const updateRobotSchema = robotWriteSchema.partial().extend({
  slug: robotSlugSchema.optional(),
}).superRefine(validateRobotScheduleRange);

// ─── Control Schemas ─────────────────────────────────
export const controlCommandSchema = z.object({
  commandId: z.string().uuid(),
  buttonId: z.string().uuid().optional(),
  command: z.string().min(1).max(64),
  value: z.union([z.number(), z.string(), z.boolean()]).optional(),
  timestamp: z.number(),
});

// ─── Chat Schemas ────────────────────────────────────
export const chatMessageSchema = z.object({
  content: z.string().min(1).max(LIMITS.MAX_CHAT_MESSAGE_LENGTH),
  robotId: z.string().uuid(),
  clientMessageId: z.string().uuid(),
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
  termsVersion: z.literal(LEGAL_POLICY_VERSIONS.TERMS),
  immediateDeliveryConsent: z.literal(true),
});

export const subscriptionCheckoutRequestSchema = z.object({
  provider: z.enum(['stripe']),
  planId: z.string().min(1).max(64),
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
  destinationType: z.enum(['PAYPAL_EMAIL', 'IBAN']),
  notes: z.string().trim().max(1000).optional(),
}).superRefine((value, context) => {
  const destination = value.destination.replace(/\s+/g, '');
  if (value.destinationType === 'PAYPAL_EMAIL' && !/^\S+@\S+\.\S+$/.test(destination)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['destination'], message: 'Invalid PayPal email address' });
  }
  if (value.destinationType === 'IBAN' && !/^[A-Z]{2}[A-Z0-9]{13,32}$/i.test(destination)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['destination'], message: 'Invalid IBAN' });
  }
});

// ─── Notification and analytics schemas ─────────────
export const updateNotificationPreferencesSchema = z.object({
  inAppEnabled: z.boolean().optional(),
  browserEnabled: z.boolean().optional(),
  emailTurn: z.boolean().optional(),
  emailRobot: z.boolean().optional(),
  emailFinance: z.boolean().optional(),
  quietStartMin: z.number().int().min(0).max(1439).nullable().optional(),
  quietEndMin: z.number().int().min(0).max(1439).nullable().optional(),
  timezone: z.string().min(1).max(64).refine(isValidTimezone, 'Timezone must be a valid IANA timezone').optional(),
}).strict().superRefine((value, context) => {
  const hasStart = value.quietStartMin !== undefined && value.quietStartMin !== null;
  const hasEnd = value.quietEndMin !== undefined && value.quietEndMin !== null;
  if (hasStart !== hasEnd) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Quiet hours require both a start and end time' });
  }
  if (hasStart && value.quietStartMin === value.quietEndMin) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Quiet hours must have different start and end times' });
  }
});

export const analyticsEventSchema = z.discriminatedUnion('event', [
  z.object({
    event: z.enum(['DISCOVERY_ROBOT_VIEW', 'HOST_ONBOARDING_VIEW', 'WALLET_VIEW']),
    robotId: z.string().uuid().optional(),
  }).strict(),
  z.object({
    event: z.literal('PERFORMANCE_WEB_VITAL'),
    payload: z.object({
      metric: z.enum(['CLS', 'FCP', 'FID', 'INP', 'LCP', 'TTFB']),
      value: z.number().finite().min(0).max(10_000_000),
      rating: z.enum(['good', 'needs-improvement', 'poor']),
      path: z.string().startsWith('/').max(200),
      navigationType: z.string().max(40).optional(),
    }).strict(),
  }).strict(),
]);

export const analyticsConsentSchema = z.object({ enabled: z.boolean() }).strict();
