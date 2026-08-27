import { randomUUID } from 'node:crypto';
import { access, mkdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { pool } from '../../db/pool.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { writeAuditLog } from '../shared/audit.js';
import { readMultipartForm } from '../shared/multipart.js';
import { normalizeWebsiteUrl } from '../../resources/distributor-registration-rules.js';
import { canReplaceDistributorDocument, distributorDocumentRequirementForType, distributorDocumentTypes, isAllowedDistributorDocumentType, requiredDistributorDocuments } from '../../resources/distributor-required-documents.js';
import { safeDownloadFilename } from '../shared/multipart.js';

const profileSelect = `
  u.id AS user_id, u.email, u.full_name, u.phone, u.role, u.status AS user_status, u.created_at AS user_created_at, u.updated_at AS user_updated_at,
  dp.id AS distributor_profile_id, dp.company_name, dp.tax_id, dp.billing_address, dp.city, dp.region, dp.province, dp.postal_code, dp.country,
  dp.website, dp.contact_person, dp.validation_status, dp.discount_percent, dp.approved_at, dp.approved_by, dp.review_notes,
  dp.created_at AS profile_created_at, dp.updated_at AS profile_updated_at`;

const updateSchema = z.object({
  company_name: z.string().min(1).max(200).optional(),
  tax_id: z.string().min(1).max(80).optional(),
  billing_address: z.string().max(500).nullable().optional(),
  city: z.string().max(120).nullable().optional(),
  province: z.string().max(120).nullable().optional(),
  postal_code: z.string().max(30).nullable().optional(),
  country: z.string().max(2).nullable().optional(),
  website: z.preprocess((value) => typeof value === 'string' ? (value.trim() ? normalizeWebsiteUrl(value) ?? value.trim() : undefined) : value, z.string().max(300).refine((value) => normalizeWebsiteUrl(value) !== undefined, 'Invalid website URL').nullable().optional()),
  contact_person: z.string().max(200).nullable().optional()
}).strict();

type DistributorRouterDependencies = {
  pool?: any;
  authMiddleware?: RequestHandler;
  roleMiddleware?: RequestHandler;
  audit?: typeof writeAuditLog;
  documentsPath?: string;
};

export const createDistributorRouter = (dependencies: DistributorRouterDependencies = {}) => {
const distributorRouter = Router();
const routerPool = dependencies.pool ?? pool;
const audit = dependencies.audit ?? writeAuditLog;
const documentsPath = dependencies.documentsPath ?? env.documentsPath;
distributorRouter.use(dependencies.authMiddleware ?? requireAuth, dependencies.roleMiddleware ?? requireRole('distributor'));

const getProfile = async (userId: string) => {
  const { rows } = await routerPool.query(`SELECT ${profileSelect} FROM store.users u LEFT JOIN store.distributor_profiles dp ON dp.user_id = u.id WHERE u.id = $1`, [userId]);
  return rows[0];
};

distributorRouter.get('/profile', async (req, res, next) => {
  try { res.json({ profile: await getProfile(req.user!.sub) }); } catch (error) { next(error); }
});

distributorRouter.patch('/profile', async (req, res, next) => {
  const client = await routerPool.connect();
  try {
    const input = updateSchema.parse(req.body);
    await client.query('BEGIN');
    const { rows: existing } = await client.query('SELECT id FROM store.distributor_profiles WHERE user_id = $1', [req.user!.sub]);
    if (!existing[0]) { res.status(404).json({ error: 'Distributor profile not found' }); await client.query('ROLLBACK'); return; }
    await client.query(`UPDATE store.distributor_profiles SET
      company_name = COALESCE($2, company_name), tax_id = COALESCE($3, tax_id), billing_address = COALESCE($4, billing_address),
      city = COALESCE($5, city), province = COALESCE($6, province), postal_code = COALESCE($7, postal_code), country = COALESCE($8, country),
      website = COALESCE($9, website), contact_person = COALESCE($10, contact_person),
      validation_status = CASE WHEN $8 IS NOT NULL AND $8 IS DISTINCT FROM country THEN 'pending' ELSE validation_status END,
      approved_at = CASE WHEN $8 IS NOT NULL AND $8 IS DISTINCT FROM country THEN NULL ELSE approved_at END,
      approved_by = CASE WHEN $8 IS NOT NULL AND $8 IS DISTINCT FROM country THEN NULL ELSE approved_by END,
      updated_at = now()
      WHERE user_id = $1`, [req.user!.sub, input.company_name, input.tax_id, input.billing_address, input.city, input.province, input.postal_code, input.country, input.website, input.contact_person]);
    await audit({ actorUserId: req.user!.sub, action: 'distributor_profile_updated', entityType: 'distributor_profile', entityId: existing[0].id, payload: { fields: Object.keys(input) } }, client);
    await client.query('COMMIT');
    res.json({ profile: await getProfile(req.user!.sub) });
  } catch (error) { await client.query('ROLLBACK'); next(error); } finally { client.release(); }
});

distributorRouter.post('/documents', async (req, res, next) => {
  let client: any;
  let storedPath: string | undefined;
  let transactionOpen = false;
  try {
    const setting = await routerPool.query(`SELECT value->>'value' AS value FROM store.settings WHERE key = 'document_max_size_bytes'`);
    const maxBytes = Number(setting.rows[0]?.value ?? 10485760);
    const multipart = await readMultipartForm(req, maxBytes);
    if (!multipart.file) { res.status(400).json({ error: 'File is required' }); return; }
    const upload = { documentType: multipart.fields.documentType ?? '', file: multipart.file.buffer, filename: multipart.file.originalFilename, mimeType: multipart.file.mimeType };
    if (!distributorDocumentTypes.includes(upload.documentType as any)) { res.status(400).json({ error: 'Invalid document type' }); return; }
    if (upload.mimeType !== 'application/pdf' || path.extname(upload.filename).toLowerCase() !== '.pdf' || upload.file.subarray(0, 4).toString() !== '%PDF') { res.status(400).json({ error: 'Only valid PDF files are allowed' }); return; }
    if (upload.file.length > maxBytes) { res.status(413).json({ error: 'File too large' }); return; }
    client = await routerPool.connect();
    const profile = await client.query('SELECT id, country FROM store.distributor_profiles WHERE user_id = $1', [req.user!.sub]);
    if (!profile.rows[0]) { res.status(404).json({ error: 'Distributor profile not found' }); return; }
    if (!isAllowedDistributorDocumentType(profile.rows[0].country, upload.documentType)) { res.status(400).json({ error: 'Document type is not required for this country' }); return; }
    const equivalentTypes = distributorDocumentRequirementForType(profile.rows[0].country, upload.documentType)?.acceptedTypes ?? ['otro'];
    await client.query('BEGIN');
    transactionOpen = true;
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`${profile.rows[0].id}:${equivalentTypes.join(',')}`]);
    const current = await client.query(`SELECT id, status FROM store.distributor_documents
      WHERE distributor_profile_id = $1 AND document_type = ANY($2::text[]) AND status <> 'replaced'
      ORDER BY created_at DESC`, [profile.rows[0].id, equivalentTypes]);
    if (current.rows.some((document: any) => !canReplaceDistributorDocument(document.status))) { await client.query('ROLLBACK'); transactionOpen = false; res.status(409).json({ error: 'Approved documents cannot be replaced' }); return; }
    const root = path.resolve(documentsPath, 'distributor-verification', req.user!.sub);
    await mkdir(root, { recursive: true });
    storedPath = path.resolve(root, `${randomUUID()}.pdf`);
    if (!storedPath.startsWith(root + path.sep)) throw Object.assign(new Error('Invalid document path'), { status: 404 });
    await writeFile(storedPath, upload.file, { flag: 'wx' });
    const replaced = await client.query(`UPDATE store.distributor_documents
      SET status = 'replaced', reviewed_at = now(), review_notes = COALESCE(review_notes, 'Replaced by a newer upload of the same document type')
      WHERE distributor_profile_id = $1 AND document_type = ANY($2::text[]) AND status <> 'replaced'
      RETURNING id`, [profile.rows[0].id, equivalentTypes]);
    const { rows } = await client.query(`INSERT INTO store.distributor_documents (distributor_profile_id, document_type, file_name, file_path, mime_type, file_size_bytes, status, uploaded_at, created_at)
      VALUES ($1,$2,$3,$4,'application/pdf',$5,'pending',now(),now()) RETURNING id, document_type, file_name, file_size_bytes, status, created_at, review_notes`, [profile.rows[0].id, upload.documentType, upload.filename, storedPath, upload.file.length]);
    await client.query(`UPDATE store.distributor_profiles
      SET validation_status = 'pending', approved_at = NULL, approved_by = NULL, reviewed_at = NULL, reviewed_by = NULL, updated_at = now()
      WHERE id = $1`, [profile.rows[0].id]);
    if (replaced.rows.length > 0) {
      await audit({ actorUserId: req.user!.sub, action: 'distributor_document_replaced', entityType: 'distributor_profile', entityId: profile.rows[0].id, payload: { document_type: upload.documentType, replaced_document_ids: replaced.rows.map((row: any) => row.id), new_document_id: rows[0].id } }, client);
    }
    await audit({ actorUserId: req.user!.sub, action: 'distributor_document_uploaded', entityType: 'distributor_document', entityId: rows[0].id, payload: { document_type: upload.documentType, validation_status: 'pending' } }, client);
    await client.query('COMMIT');
    transactionOpen = false;
    res.status(201).json({ document: rows[0] });
  } catch (error: any) {
    if (transactionOpen) await client?.query('ROLLBACK');
    if (storedPath) await unlink(storedPath).catch(() => undefined);
    if (error.status) res.status(error.status).json({ error: error.message }); else next(error);
  } finally { client?.release(); }
});

distributorRouter.get('/documents', async (req, res, next) => {
  try {
    const profile = await routerPool.query('SELECT country FROM store.distributor_profiles WHERE user_id = $1', [req.user!.sub]);
    if (!profile.rows[0]) { res.status(404).json({ error: 'Distributor profile not found' }); return; }
    const { rows } = await routerPool.query(`SELECT dd.id, dd.document_type, dd.file_name, dd.file_size_bytes, dd.status, dd.created_at, dd.reviewed_at, dd.review_notes
      FROM store.distributor_documents dd JOIN store.distributor_profiles dp ON dp.id = dd.distributor_profile_id
      WHERE dp.user_id = $1 AND dd.status <> 'replaced' ORDER BY dd.created_at DESC`, [req.user!.sub]);
    res.json({ country: profile.rows[0].country, requirements: requiredDistributorDocuments(profile.rows[0].country), documents: rows });
  } catch (error) { next(error); }
});

distributorRouter.get('/documents/:id/download', async (req, res, next) => {
  try {
    const id = z.string().uuid().parse(req.params.id);
    const { rows } = await routerPool.query(`SELECT dd.file_path, dd.file_name, dd.mime_type FROM store.distributor_documents dd
      JOIN store.distributor_profiles dp ON dp.id = dd.distributor_profile_id
      WHERE dd.id = $1 AND dp.user_id = $2 AND dd.status <> 'replaced'`, [id, req.user!.sub]);
    if (!rows[0]) { res.status(404).json({ error: 'Document not found' }); return; }
    const base = path.resolve(documentsPath); const filePath = path.resolve(rows[0].file_path);
    if (!filePath.startsWith(base + path.sep)) { res.status(404).json({ error: 'Document not found' }); return; }
    try { await access(filePath); } catch { res.status(404).json({ error: 'Document not found' }); return; }
    await audit({ actorUserId: req.user!.sub, action: 'distributor_document_downloaded', entityType: 'distributor_document', entityId: id });
    res.download(filePath, safeDownloadFilename(rows[0].file_name), { headers: { 'Content-Type': 'application/pdf', 'X-Content-Type-Options': 'nosniff' } }, (error) => error ? next(error) : undefined);
  } catch (error) { next(error); }
});
return distributorRouter;
};

export const distributorRouter = createDistributorRouter();
