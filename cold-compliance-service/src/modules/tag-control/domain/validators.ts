import { z } from 'zod';

const state = z.union([z.literal(0), z.literal(1)]);

export const ledSchema = z.object({
  state,
  duration: z.number().int().min(0).max(65535)
});

export const buzzerSchema = z.object({
  state,
  frequency: z.number().int().min(1).max(5000),
  duration: z.number().int().min(0).max(65535)
});

export const vibrationSchema = z.object({
  state,
  intensity: z.number().int().min(0).max(100),
  duration: z.number().int().min(0).max(65535)
});
