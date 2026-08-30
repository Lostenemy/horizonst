import { access } from 'node:fs/promises';
import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { pool } from '../../db/pool.js';
import { resolveDistributorResourcePath } from '../../resources/distributor-resource-documents.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { writeAuditLog } from '../shared/audit.js';
import { safeDownloadFilename } from '../shared/multipart.js';

const idSchema = z.string().uuid();
const resourceColumns = `d.id, d.title, d.description, d.original_filename, d.mime_type, d.file_size_bytes,
  d.visibility, d.category, d.published_at, d.created_at`;

type ResourceRouterDependencies = {
  authMiddleware?: RequestHandler;
  roleMiddleware?: RequestHandler;
  query?: (sql: string, values?: unknown[]) => Promise<{ rows: any[] }>;
  audit?: typeof writeAuditLog;
  resolvePath?: typeof resolveDistributorResourcePath;
};

export const createDistributorResourcesRouter = (dependencies: ResourceRouterDependencies = {}) => {
  const router = Router();
  const query = dependencies.query ?? ((sql: string, values?: unknown[]) => pool.query(sql, values));
  const audit = dependencies.audit ?? writeAuditLog;
  const resolvePath = dependencies.resolvePath ?? resolveDistributorResourcePath;
  router.use(dependencies.authMiddleware ?? requireAuth, dependencies.roleMiddleware ?? requireRole('distributor'));

router.get('/resources', async (req, res, next) => {
  try {
    const { rows } = await query(`SELECT ${resourceColumns}
      FROM store.distributor_resource_documents d
      WHERE d.active = true AND (d.visibility = 'global' OR EXISTS (
        SELECT 1 FROM store.distributor_resource_assignments a
        WHERE a.document_id = d.id AND a.distributor_user_id = $1
      )) ORDER BY d.category, d.published_at DESC, d.title`, [req.user!.sub]);
    res.json({ resources: rows });
  } catch (error) { next(error); }
});

router.get('/resources/:id/download', async (req, res, next) => {
  try {
    const id = idSchema.parse(req.params.id);
    const { rows } = await query(`SELECT d.id, d.original_filename, d.mime_type, d.storage_kind, d.storage_key
      FROM store.distributor_resource_documents d
      WHERE d.id = $1 AND d.active = true AND (d.visibility = 'global' OR EXISTS (
        SELECT 1 FROM store.distributor_resource_assignments a
        WHERE a.document_id = d.id AND a.distributor_user_id = $2
      ))`, [id, req.user!.sub]);
    const document = rows[0];
    if (!document) { res.status(404).json({ error: 'Document not found' }); return; }
    const filePath = resolvePath(document);
    try { await access(filePath); } catch { res.status(404).json({ error: 'Document file not found' }); return; }
    await audit({ actorUserId: req.user!.sub, action: 'distributor_resource_downloaded', entityType: 'distributor_resource_document', entityId: id });
    res.download(filePath, safeDownloadFilename(document.original_filename), { headers: { 'Content-Type': document.mime_type, 'X-Content-Type-Options': 'nosniff' } }, (error) => error ? next(error) : undefined);
  } catch (error) { next(error); }
});
  return router;
};

export const distributorResourcesRouter = createDistributorResourcesRouter();
