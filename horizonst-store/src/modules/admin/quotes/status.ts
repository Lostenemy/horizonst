import { z } from 'zod';

export const quoteStatuses = ['draft', 'submitted', 'in_review', 'sent', 'accepted', 'rejected', 'cancelled'] as const;

export type QuoteStatus = typeof quoteStatuses[number];

export const quoteStatusSchema = z.enum(quoteStatuses);

export const quoteStatusChangeSchema = z.object({
  status: quoteStatusSchema,
  comment: z.string().trim().max(5000).optional(),
  internal_notes: z.string().trim().max(5000).optional()
}).strict();

export const allowedQuoteStatusTransitions: Record<QuoteStatus, readonly QuoteStatus[]> = {
  draft: ['submitted', 'cancelled'],
  submitted: ['in_review', 'cancelled'],
  in_review: ['sent', 'rejected', 'cancelled'],
  sent: ['accepted', 'rejected', 'cancelled'],
  accepted: [],
  rejected: [],
  cancelled: []
};

export const canTransitionQuoteStatus = (oldStatus: QuoteStatus, newStatus: QuoteStatus): boolean => (
  allowedQuoteStatusTransitions[oldStatus].includes(newStatus)
);

export const shouldRecordQuoteStatusHistory = (oldStatus: QuoteStatus, newStatus: QuoteStatus): boolean => (
  oldStatus !== newStatus && canTransitionQuoteStatus(oldStatus, newStatus)
);
