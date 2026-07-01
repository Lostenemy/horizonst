import { writeAuditLog } from '../../shared/audit.js';
import type { QuoteStatus } from './status.js';

type Queryable = {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }>;
};

export const insertQuoteStatusHistory = async (input: {
  quoteId: string;
  oldStatus: QuoteStatus;
  newStatus: QuoteStatus;
  comment?: string | null;
  changedBy: string;
}, client: Queryable): Promise<void> => {
  await client.query(
    `INSERT INTO store.quote_status_history (quote_id, old_status, new_status, comment, changed_by)
     VALUES ($1, $2, $3, $4, $5)`,
    [input.quoteId, input.oldStatus, input.newStatus, input.comment ?? null, input.changedBy]
  );

  await writeAuditLog({
    actorUserId: input.changedBy,
    action: 'quote_status_changed',
    entityType: 'quote',
    entityId: input.quoteId,
    payload: { previous_status: input.oldStatus, status: input.newStatus, comment: input.comment ?? null }
  }, client);
};
