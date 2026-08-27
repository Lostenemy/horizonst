import { randomUUID } from 'node:crypto';
import { access, mkdir, unlink, writeFile } from 'node:fs/promises';
import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../../db/pool.js';
import { distributorResourceCategories, distributorResourceMaxBytes, distributorResourceStorageRoot, distributorResourceVisibilities, resolveDistributorResourcePath, validateDistributorResourcePdf } from '../../resources/distributor-resource-documents.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { writeAuditLog } from '../shared/audit.js';
import { readMultipartForm, safeDownloadFilename } from '../shared/multipart.js';

const idSchema = z.string().uuid();
export const adminDistributorResourceUploadSchema = z.object({
  title: z.string().trim().min(1).max(200), description: z.string().trim().max(2000).optional(),
  category: z.enum(distributorResourceCategories), visibility: z.enum(distributorResourceVisibilities),
  distributor_user_ids: z.array(z.string().uuid()).max(200).default([])
}).strict().superRefine((input, context) => {
  if (input.visibility === 'targeted' && input.distributor_user_ids.length === 0) context.addIssue({ code: z.ZodIssueCode.custom, path: ['distributor_user_ids'], message: 'Selecciona al menos un distribuidor.' });
  if (input.visibility === 'global' && input.distributor_user_ids.length > 0) context.addIssue({ code: z.ZodIssueCode.custom, path: ['distributor_user_ids'], message: 'Un documento global no admite asignaciones.' });
});
export const adminDistributorResourceUpdateSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(), description: z.string().trim().max(2000).nullable().optional(),
  category: z.enum(distributorResourceCategories).optional(), visibility: z.enum(distributorResourceVisibilities).optional(),
  distributor_user_ids: z.array(z.string().uuid()).max(200).optional(), active: z.boolean().optional()
}).strict().superRefine((input, context) => {
  if (input.visibility === 'global' && input.distributor_user_ids?.length) context.addIssue({ code: z.ZodIssueCode.custom, path: ['distributor_user_ids'], message: 'Un documento global no admite asignaciones.' });
});

const parseTargetIds = (value: string | undefined) => {
  if (!value) return [];
  try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? [...new Set(parsed.map(String))] : []; }
  catch { return [...new Set(value.split(',').map((item) => item.trim()).filter(Boolean))]; }
};

const ensureDistributorUsers = async (client: any, ids: string[]) => {
  if (ids.length === 0) return;
  const { rows } = await client.query(`SELECT id FROM store.users WHERE role = 'distributor' AND id = ANY($1::uuid[])`, [ids]);
  if (rows.length !== ids.length) throw Object.assign(new Error('Uno o varios distribuidores no son válidos.'), { status: 400 });
};

export const adminDistributorResourcesRouter = Router();
adminDistributorResourcesRouter.use(requireAuth, requireRole('admin'));

adminDistributorResourcesRouter.get('/distributor-resources/distributors', async (_req, res, next) => {
  try {
    const { rows } = await pool.query(`SELECT u.id, u.email, u.full_name, dp.company_name
      FROM store.users u JOIN store.distributor_profiles dp ON dp.user_id = u.id
      WHERE u.role = 'distributor' ORDER BY dp.company_name, u.email LIMIT 500`);
    res.json({ distributors: rows });
  } catch (error) { next(error); }
});

adminDistributorResourcesRouter.get('/distributor-resources', async (_req, res, next) => {
  try {
    const { rows } = await pool.query(`SELECT d.id, d.title, d.description, d.original_filename, d.mime_type, d.file_size_bytes,
      d.visibility, d.category, d.active, d.published_at, d.created_at, d.updated_at,
      COALESCE((SELECT json_agg(json_build_object('id', u.id, 'email', u.email, 'full_name', u.full_name, 'company_name', dp.company_name) ORDER BY dp.company_name)
        FROM store.distributor_resource_assignments a JOIN store.users u ON u.id = a.distributor_user_id
        JOIN store.distributor_profiles dp ON dp.user_id = u.id WHERE a.document_id = d.id), '[]'::json) AS distributors
      FROM store.distributor_resource_documents d ORDER BY d.active DESC, d.published_at DESC, d.title`);
    res.json({ resources: rows });
  } catch (error) { next(error); }
});

adminDistributorResourcesRouter.post('/distributor-resources', async (req, res, next) => {
  let storedPath: string | undefined;
  try {
    const multipart = await readMultipartForm(req, distributorResourceMaxBytes);
    if (!multipart.file) { res.status(400).json({ error: 'El archivo es obligatorio.' }); return; }
    validateDistributorResourcePdf(multipart.file);
    const input = adminDistributorResourceUploadSchema.parse({
      title: multipart.fields.title, description: multipart.fields.description || undefined,
      category: multipart.fields.category, visibility: multipart.fields.visibility,
      distributor_user_ids: parseTargetIds(multipart.fields.distributor_user_ids)
    });
    const client = await pool.connect();
    try {
      await ensureDistributorUsers(client, input.distributor_user_ids);
      const storageKey = `${randomUUID()}.pdf`;
      const root = distributorResourceStorageRoot(); await mkdir(root, { recursive: true });
      storedPath = resolveDistributorResourcePath({ storage_kind: 'uploaded', storage_key: storageKey });
      await writeFile(storedPath, multipart.file.buffer, { flag: 'wx' });
      await client.query('BEGIN');
      const { rows } = await client.query(`INSERT INTO store.distributor_resource_documents
        (title, description, original_filename, storage_key, storage_kind, mime_type, file_size_bytes, visibility, category, created_by)
        VALUES ($1,$2,$3,$4,'uploaded',$5,$6,$7,$8,$9)
        RETURNING id, title, description, original_filename, mime_type, file_size_bytes, visibility, category, active, published_at, created_at`,
        [input.title, input.description ?? null, multipart.file.originalFilename, storageKey, multipart.file.mimeType, multipart.file.buffer.length, input.visibility, input.category, req.user!.sub]);
      for (const distributorUserId of input.distributor_user_ids) await client.query(`INSERT INTO store.distributor_resource_assignments (document_id, distributor_user_id) VALUES ($1,$2)`, [rows[0].id, distributorUserId]);
      await writeAuditLog({ actorUserId: req.user!.sub, action: 'distributor_resource_uploaded', entityType: 'distributor_resource_document', entityId: rows[0].id, payload: { visibility: input.visibility, category: input.category, assigned_distributor_ids: input.distributor_user_ids } }, client);
      await client.query('COMMIT'); res.status(201).json({ resource: rows[0] });
    } catch (error) { await client.query('ROLLBACK'); if (storedPath) await unlink(storedPath).catch(() => undefined); throw error; }
    finally { client.release(); }
  } catch (error: any) { if (error?.status) res.status(error.status).json({ error: error.message }); else next(error); }
});

adminDistributorResourcesRouter.patch('/distributor-resources/:id', async (req, res, next) => {
  const client = await pool.connect();
  try {
    const id = idSchema.parse(req.params.id); const input = adminDistributorResourceUpdateSchema.parse(req.body);
    await client.query('BEGIN');
    const existing = await client.query('SELECT id, visibility, active FROM store.distributor_resource_documents WHERE id = $1 FOR UPDATE', [id]);
    if (!existing.rows[0]) { await client.query('ROLLBACK'); res.status(404).json({ error: 'Document not found' }); return; }
    const visibility = input.visibility ?? existing.rows[0].visibility;
    const targetIds = input.distributor_user_ids;
    if ((visibility === 'targeted' && targetIds?.length === 0) || (input.visibility === 'targeted' && existing.rows[0].visibility !== 'targeted' && !targetIds)) { await client.query('ROLLBACK'); res.status(400).json({ error: 'Selecciona al menos un distribuidor.' }); return; }
    if (targetIds) await ensureDistributorUsers(client, targetIds);
    const { rows } = await client.query(`UPDATE store.distributor_resource_documents SET
      title = COALESCE($2, title), description = CASE WHEN $3::boolean THEN $4 ELSE description END,
      category = COALESCE($5, category), visibility = $6, active = COALESCE($7, active), updated_at = now()
      WHERE id = $1 RETURNING id, title, description, original_filename, mime_type, file_size_bytes, visibility, category, active, published_at, updated_at`,
      [id, input.title ?? null, Object.prototype.hasOwnProperty.call(input, 'description'), input.description ?? null, input.category ?? null, visibility, input.active ?? null]);
    if (visibility === 'global' || targetIds) {
      await client.query('DELETE FROM store.distributor_resource_assignments WHERE document_id = $1', [id]);
      if (visibility === 'targeted') for (const distributorUserId of targetIds ?? []) await client.query('INSERT INTO store.distributor_resource_assignments (document_id, distributor_user_id) VALUES ($1,$2)', [id, distributorUserId]);
    }
    await writeAuditLog({ actorUserId: req.user!.sub, action: input.active === false ? 'distributor_resource_archived' : 'distributor_resource_updated', entityType: 'distributor_resource_document', entityId: id, payload: { fields: Object.keys(input), visibility, assigned_distributor_ids: targetIds } }, client);
    await client.query('COMMIT'); res.json({ resource: rows[0] });
  } catch (error) { await client.query('ROLLBACK'); next(error); } finally { client.release(); }
});

adminDistributorResourcesRouter.delete('/distributor-resources/:id', async (req, res, next) => {
  const client = await pool.connect();
  try {
    const id = idSchema.parse(req.params.id); await client.query('BEGIN');
    const { rows } = await client.query('UPDATE store.distributor_resource_documents SET active = false, updated_at = now() WHERE id = $1 RETURNING id', [id]);
    if (!rows[0]) { await client.query('ROLLBACK'); res.status(404).json({ error: 'Document not found' }); return; }
    await writeAuditLog({ actorUserId: req.user!.sub, action: 'distributor_resource_archived', entityType: 'distributor_resource_document', entityId: id }, client);
    await client.query('COMMIT'); res.status(204).end();
  } catch (error) { await client.query('ROLLBACK'); next(error); } finally { client.release(); }
});

adminDistributorResourcesRouter.get('/distributor-resources/:id/download', async (req, res, next) => {
  try {
    const id = idSchema.parse(req.params.id);
    const { rows } = await pool.query('SELECT id, original_filename, mime_type, storage_kind, storage_key FROM store.distributor_resource_documents WHERE id = $1', [id]);
    if (!rows[0]) { res.status(404).json({ error: 'Document not found' }); return; }
    const filePath = resolveDistributorResourcePath(rows[0]);
    try { await access(filePath); } catch { res.status(404).json({ error: 'Document file not found' }); return; }
    await writeAuditLog({ actorUserId: req.user!.sub, action: 'admin_distributor_resource_downloaded', entityType: 'distributor_resource_document', entityId: id });
    res.download(filePath, safeDownloadFilename(rows[0].original_filename), { headers: { 'Content-Type': rows[0].mime_type, 'X-Content-Type-Options': 'nosniff' } }, (error) => error ? next(error) : undefined);
  } catch (error) { next(error); }
});
