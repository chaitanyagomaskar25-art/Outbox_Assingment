import { z } from 'zod';

export const googleCallbackQuerySchema = z.object({
  code: z.string().min(1, 'Authorization code is required'),
  state: z.string().min(1, 'OAuth state is required'),
});

export const emailPasswordLoginSchema = z.object({
  email: z.string().trim().email('Enter a valid email address').max(254).transform((email) => email.toLowerCase()),
  password: z.string().min(1, 'Password is required').max(128),
});

export const emailPasswordSignupSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(100),
  email: z.string().trim().email('Enter a valid email address').max(254).transform((email) => email.toLowerCase()),
  password: z.string().min(8, 'Password must be at least 8 characters').max(128),
});
