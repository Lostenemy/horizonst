import path from 'node:path';
import { Router } from 'express';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { pool } from '../../db/pool.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { writeAuditLog } from '../shared/audit.js';

export const adminDistributorsRouter = Router();
adminDistributorsRouter.use(requireAuth, requireRole('admin'));

const statusValues = ['pending', 'needs_more_info', 'approved', 'rejected', 'suspended', 'closed'] as const;
const documentStatusValues = ['pending', 'approved', 'rejected', 'replaced'] as const;
const idSchema = z.string().uuid();

export const hasBlockingActiveDistributorDocuments = (summary: { blocking_documents?: number | string | null }): boolean => Number(summary.blocking_documents ?? 0) > 0;

adminDistributorsRouter.get('/distributors', async (req, res, next) => {
  try {
    const query = z.object({ validation_status: z.enum(statusValues).optional(), email: z.string().optional(), company_name: z.string().optional() }).parse(req.query);
    const params: unknown[] = []; const where: string[] = [];
    if (query.validation_status) { params.push(query.validation_status); where.push(`dp.validation_status = $${params.length}`); }
    if (query.email) { params.push(`%${query.email}%`); where.push(`u.email ILIKE $${params.length}`); }
    if (query.company_name) { params.push(`%${query.company_name}%`); where.push(`dp.company_name ILIKE $${params.length}`); }
    const { rows } = await pool.query(`SELECT dp.id, dp.validation_status, dp.company_name, dp.tax_id, dp.created_at, dp.updated_at, dp.approved_at,
      u.id AS user_id, u.email, u.full_name, u.status AS user_status
      FROM store.distributor_profiles dp JOIN store.users u ON u.id = dp.user_id
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY dp.created_at DESC LIMIT 200`, params);
    res.json(rows);
  } catch (error) { next(error); }
});

adminDistributorsRouter.get('/distributors/:id', async (req, res, next) => {
  try {
    const id = idSchema.parse(req.params.id);
    const { rows } = await pool.query(`SELECT dp.*, u.email, u.full_name, u.phone, u.role, u.status AS user_status FROM store.distributor_profiles dp JOIN store.users u ON u.id = dp.user_id WHERE dp.id = $1`, [id]);
    if (!rows[0]) { res.status(404).json({ error: 'Distributor not found' }); return; }
    const docs = await pool.query(`SELECT id, document_type, file_name, mime_type, file_size_bytes, status, created_at, reviewed_at, reviewed_by, review_notes FROM store.distributor_documents WHERE distributor_profile_id = $1 ORDER BY created_at DESC`, [id]);
    res.json({ distributor: rows[0], documents: docs.rows });
  } catch (error) { next(error); }
});

const statusSchema = z.object({ validation_status: z.enum(statusValues), review_notes: z.string().trim().min(1).max(2000).optional() }).strict();
adminDistributorsRouter.patch('/distributors/:id/status', async (req, res, next) => {
  const client = await pool.connect();
  try {
    const id = idSchema.parse(req.params.id); const input = statusSchema.parse(req.body);
    if ((input.validation_status === 'rejected' || input.validation_status === 'needs_more_info') && !input.review_notes) {
      res.status(400).json({ error: 'review_notes is required for rejected and needs_more_info statuses' }); return;
    }
    await client.query('BEGIN');
    const existingDistributor = await client.query('SELECT id FROM store.distributor_profiles WHERE id = $1', [id]);
    if (!existingDistributor.rows[0]) { res.status(404).json({ error: 'Distributor not found' }); await client.query('ROLLBACK'); return; }
    if (input.validation_status === 'approved') {
      const docs = await client.query(`SELECT
        COUNT(*)::int AS total_documents,
        COUNT(*) FILTER (WHERE status <> 'replaced')::int AS active_documents,
        COUNT(*) FILTER (WHERE status <> 'replaced' AND status <> 'approved')::int AS blocking_documents
        FROM store.distributor_documents WHERE distributor_profile_id = $1`, [id]);
      const summary = docs.rows[0];
      if (!summary || summary.total_documents < 1 || summary.active_documents < 1) {
        await client.query('ROLLBACK'); res.status(409).json({ error: 'Cannot approve distributor without non-replaced documentation' }); return;
      }
      if (hasBlockingActiveDistributorDocuments(summary)) {
        await client.query('ROLLBACK'); res.status(409).json({ error: 'Cannot approve distributor while active documents are not approved' }); return;
      }
    }
    const { rows } = await client.query(`UPDATE store.distributor_profiles SET validation_status = $2, review_notes = COALESCE($3, review_notes),
      approved_at = CASE WHEN $2 = 'approved' THEN now() ELSE approved_at END,
      approved_by = CASE WHEN $2 = 'approved' THEN $4 ELSE approved_by END,
      reviewed_at = now(), reviewed_by = $4, updated_at = now()
      WHERE id = $1 RETURNING *`, [id, input.validation_status, input.review_notes ?? null, req.user!.sub]);
    await writeAuditLog({ actorUserId: req.user!.sub, action: 'distributor_validation_status_changed', entityType: 'distributor_profile', entityId: id, payload: { validation_status: input.validation_status, review_notes: input.review_notes ?? null } }, client);
    await client.query('COMMIT'); res.json({ distributor: rows[0] });
  } catch (error) { await client.query('ROLLBACK'); next(error); } finally { client.release(); }
});

adminDistributorsRouter.get('/distributor-documents/:id', async (req, res, next) => {
  try {
    const id = idSchema.parse(req.params.id);
    const { rows } = await pool.query(`SELECT dd.id, dd.distributor_profile_id, dd.document_type, dd.file_name, dd.mime_type, dd.file_size_bytes,
      dd.status, dd.created_at, dd.reviewed_at, dd.reviewed_by, dd.review_notes,
      dp.user_id, dp.company_name, u.email
      FROM store.distributor_documents dd
      JOIN store.distributor_profiles dp ON dp.id = dd.distributor_profile_id
      JOIN store.users u ON u.id = dp.user_id
      WHERE dd.id = $1`, [id]);
    if (!rows[0]) { res.status(404).json({ error: 'Document not found' }); return; }
    res.json({ document: rows[0] });
  } catch (error) { next(error); }
});

const documentStatusSchema = z.object({ status: z.enum(documentStatusValues), review_notes: z.string().trim().min(1).max(2000).optional() }).strict();
adminDistributorsRouter.patch('/distributor-documents/:id/status', async (req, res, next) => {
  const client = await pool.connect();
  try {
    const id = idSchema.parse(req.params.id); const input = documentStatusSchema.parse(req.body);
    if (input.status === 'rejected' && !input.review_notes) { res.status(400).json({ error: 'review_notes is required when rejecting a document' }); return; }
    await client.query('BEGIN');
    const { rows } = await client.query(`UPDATE store.distributor_documents SET status = $2, reviewed_at = now(), reviewed_by = $3,
      review_notes = COALESCE($4, review_notes) WHERE id = $1 RETURNING id, distributor_profile_id, document_type, status, created_at, reviewed_at, reviewed_by, review_notes`,
      [id, input.status, req.user!.sub, input.review_notes ?? null]);
    if (!rows[0]) { res.status(404).json({ error: 'Document not found' }); await client.query('ROLLBACK'); return; }
    const action = input.status === 'approved' ? 'distributor_document_approved' : input.status === 'rejected' ? 'distributor_document_rejected' : input.status === 'replaced' ? 'distributor_document_replaced' : 'distributor_document_status_changed';
    await writeAuditLog({ actorUserId: req.user!.sub, action, entityType: 'distributor_document', entityId: id, payload: { status: input.status, review_notes: input.review_notes ?? null } }, client);
    await client.query('COMMIT'); res.json({ document: rows[0] });
  } catch (error) { await client.query('ROLLBACK'); next(error); } finally { client.release(); }
});

adminDistributorsRouter.get('/distributor-documents/:id/download', async (req, res, next) => {
  try {
    const id = idSchema.parse(req.params.id);
    const { rows } = await pool.query('SELECT id, file_path, file_name FROM store.distributor_documents WHERE id = $1', [id]);
    if (!rows[0]) { res.status(404).json({ error: 'Document not found' }); return; }
    const base = path.resolve(env.documentsPath); const filePath = path.resolve(rows[0].file_path);
    if (!filePath.startsWith(base + path.sep) && filePath !== base) { res.status(403).json({ error: 'Forbidden' }); return; }
    await writeAuditLog({ actorUserId: req.user!.sub, action: 'admin_distributor_document_downloaded', entityType: 'distributor_document', entityId: id });
    res.download(filePath, rows[0].file_name, { headers: { 'Content-Type': 'application/pdf' } });
  } catch (error) { next(error); }
});
