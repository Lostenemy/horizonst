import { Router } from 'express';
import { pool } from '../../db/pool.js';
import { requireAuth, requireRole } from '../auth/middleware.js';

export const adminDashboardRouter = Router();
adminDashboardRouter.use(requireAuth, requireRole('admin'));

const countBy = (rows: Array<{ status?: string; validation_status?: string; count: number }>, key: string) =>
  rows.find((row) => row.status === key || row.validation_status === key)?.count ?? 0;

adminDashboardRouter.get('/dashboard', async (_req, res, next) => {
  try {
    const [customers, distributors, quoteCounts, values, latestAudit, latestQuotes, latestDistributors] = await Promise.all([
      pool.query(`SELECT COUNT(*)::int AS count FROM store.users WHERE role = 'customer'`),
      pool.query(`SELECT validation_status, COUNT(*)::int AS count FROM store.distributor_profiles WHERE validation_status IN ('pending','approved') GROUP BY validation_status`),
      pool.query(`SELECT status, COUNT(*)::int AS count FROM store.quotes WHERE status IN ('submitted','in_review','sent','accepted') GROUP BY status`),
      pool.query(`SELECT COALESCE(SUM(total_cents) FILTER (WHERE status IN ('submitted','in_review','sent')),0)::int AS open_value_cents, COALESCE(SUM(total_cents) FILTER (WHERE status = 'accepted'),0)::int AS accepted_value_cents FROM store.quotes`),
      pool.query(`SELECT a.id, a.action, a.entity_type, a.entity_id, a.created_at, u.email AS actor_email FROM store.audit_log a LEFT JOIN store.users u ON u.id = a.actor_user_id ORDER BY a.created_at DESC LIMIT 10`),
      pool.query(`SELECT q.id, q.quote_number, q.status, q.total_cents, q.created_at, u.email FROM store.quotes q JOIN store.users u ON u.id = q.user_id ORDER BY q.created_at DESC LIMIT 10`),
      pool.query(`SELECT dp.id, dp.company_name, dp.validation_status, dp.created_at, u.email FROM store.distributor_profiles dp JOIN store.users u ON u.id = dp.user_id ORDER BY dp.created_at DESC LIMIT 10`)
    ]);

    res.json({
      metrics: {
        customers_registered: customers.rows[0].count,
        distributors_pending: countBy(distributors.rows, 'pending'),
        distributors_approved: countBy(distributors.rows, 'approved'),
        quotes_submitted: countBy(quoteCounts.rows, 'submitted'),
        quotes_in_review: countBy(quoteCounts.rows, 'in_review'),
        quotes_sent: countBy(quoteCounts.rows, 'sent'),
        quotes_accepted: countBy(quoteCounts.rows, 'accepted'),
        open_value_cents: values.rows[0].open_value_cents,
        accepted_value_cents: values.rows[0].accepted_value_cents
      },
      latestAudit: latestAudit.rows,
      latestQuotes: latestQuotes.rows,
      latestDistributors: latestDistributors.rows
    });
  } catch (error) {
    next(error);
  }
});
