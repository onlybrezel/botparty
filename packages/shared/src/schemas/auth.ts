import { z } from 'zod';
import './zod.js';
import { LEGAL_POLICY_VERSIONS } from '../constants/index.js';

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
  acceptedTermsVersion: z.literal(LEGAL_POLICY_VERSIONS.TERMS),
  acceptedPrivacyVersion: z.literal(LEGAL_POLICY_VERSIONS.PRIVACY),
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

