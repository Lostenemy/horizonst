import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { pool } from '../../db/pool.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { journalConnection } from './notification-journal.js';

// No body, address, transport response text or resend operation is exposed.
export function createNotificationsRouter(db = pool, auth: RequestHandler = requireAuth) {
  const router = Router();
  router.get('/quotes/:id/notifications', auth, requireRole('customer', 'distributor', 'admin'), async (req, res) => {
    const id = z.string().uuid().safeParse(req.params.id);
    if (!id.success) { res.status(400).json({ error: 'Invalid quote' }); return; }
    try {
      const rows = await journalConnection(db, async c => {
        const quote = await c.query('SELECT id FROM store.quotes WHERE id=$1 AND ($2::boolean OR user_id=$3::uuid)',
          [id.data, req.user!.role === 'admin', req.user!.sub]);
        if (!quote.rows.length) return null;
        return (await c.query(`SELECT d.id,d.notification_type,d.recipient_role,d.state,d.result_code,d.smtp_code,
          d.created_at,d.started_at,d.finished_at,d.reviewed_at FROM store.notification_deliveries d
          JOIN store.quote_status_history h ON h.id=d.status_history_id WHERE h.quote_id=$1
          ORDER BY d.created_at,d.id`, [id.data])).rows;
      });
      if (rows === null) res.status(404).json({ error: 'Quote not found' });
      else res.json({ notifications: rows, smtpAcceptanceIsNotDelivery: true });
    } catch { res.status(503).json({ error: 'notification_journal_unavailable' }); }
  });
  router.post('/admin/notifications/:id/cancel', auth, requireRole('admin'), async (req, res) => {
    const id = z.string().uuid().safeParse(req.params.id);
    if (!id.success) { res.status(400).json({ error: 'Invalid notification' }); return; }
    try {
      const changed = await journalConnection(db, async c => {
        await c.query('BEGIN');
        try {
          const row = await c.query(`UPDATE store.notification_deliveries SET state='cancelled',
            reviewed_by=$2::uuid,reviewed_at=clock_timestamp(),finished_at=clock_timestamp(),result_code='operator_cancelled'
            WHERE id=$1::uuid AND state='pending' RETURNING id`, [id.data, req.user!.sub]);
          if (row.rows.length) await c.query(`INSERT INTO store.audit_log(actor_user_id,action,entity_type,entity_id,payload)
            VALUES($1,'notification_cancelled','notification',$2,'{"previous_state":"pending","state":"cancelled"}'::jsonb)`, [req.user!.sub, id.data]);
          await c.query('COMMIT'); return row.rows.length > 0;
        } catch (error) { await c.query('ROLLBACK'); throw error; }
      });
      res.status(changed ? 200 : 409).json(changed ? { state: 'cancelled' } : { error: 'notification_not_pending' });
    } catch { res.status(503).json({ error: 'notification_journal_unavailable' }); }
  });
  router.post('/admin/notifications/:id/review', auth, requireRole('admin'), async (req, res) => {
    const id = z.string().uuid().safeParse(req.params.id);
    const input = z.object({ decision: z.literal('acknowledge_no_resend') }).strict().safeParse(req.body);
    if (!id.success || !input.success) { res.status(400).json({ error: 'Invalid review' }); return; }
    try {
      const changed = await journalConnection(db, async c => {
        await c.query('BEGIN');
        try {
          const row = await c.query(`UPDATE store.notification_deliveries SET reviewed_by=$2::uuid,reviewed_at=clock_timestamp()
            WHERE id=$1::uuid AND state IN ('uncertain','failed_before_send','rejected_temporary','rejected_permanent','smtp_accepted')
            AND reviewed_at IS NULL RETURNING id,state`, [id.data, req.user!.sub]);
          if (row.rows.length) await c.query(`INSERT INTO store.audit_log(actor_user_id,action,entity_type,entity_id,payload)
            VALUES($1,'notification_reviewed','notification',$2,'{"decision":"acknowledge_no_resend"}'::jsonb)`, [req.user!.sub, id.data]);
          await c.query('COMMIT'); return row.rows[0];
        } catch (error) { await c.query('ROLLBACK'); throw error; }
      });
      res.status(changed ? 200 : 409).json(changed ? { state: changed.state, resend: false } : { error: 'notification_not_reviewable' });
    } catch { res.status(503).json({ error: 'notification_journal_unavailable' }); }
  });
  return router;
}
export const notificationsRouter = createNotificationsRouter();
