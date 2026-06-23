import { z } from 'zod';

export const quoteStatuses = ['draft', 'submitted', 'in_review', 'sent', 'accepted', 'rejected', 'cancelled'] as const;

export type QuoteStatus = typeof quoteStatuses[number];

export const quoteStatusSchema = z.enum(quoteStatuses);

export const quoteStatusChangeSchema = z.object({
  status: quoteStatusSchema,
  comment: z.string().trim().max(5000).optional(),
  internal_notes: z.string().trim().max(5000).optional()
}).strict();
