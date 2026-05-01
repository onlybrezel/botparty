import { z } from 'zod';

export const updateMeSchema = z.object({
  displayName: z.string().max(64).optional(),
  avatarUrl: z.string().url().max(512).optional(),
}).strict();

export type UpdateMeInput = z.infer<typeof updateMeSchema>;

export const updateAdminUserSchema = z.object({
  username: z.string().min(3).max(32).regex(/^[a-zA-Z0-9_-]+$/).optional(),
  email: z.string().email().max(255).optional(),
  displayName: z.string().max(64).nullable().optional(),
  password: z.string().min(8).max(128).optional(),
  role: z.enum(['ADMIN', 'MOD', 'USER']).optional(),
  isActive: z.boolean().optional(),
  credits: z.number().int().optional(),
  balance: z.number().int().optional(),
}).strict();

export type UpdateAdminUserInput = z.infer<typeof updateAdminUserSchema>;
