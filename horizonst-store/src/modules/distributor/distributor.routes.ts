import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Router } from 'express';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { pool } from '../../db/pool.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { writeAuditLog } from '../shared/audit.js';

const documentTypes = ['certificado_censal', 'modelo_036', 'modelo_037', 'cif_empresa', 'certificado_autonomo', 'escrituras', 'otro'] as const;

export const distributorRouter = Router();
distributorRouter.use(requireAuth, requireRole('distributor'));

const profileSelect = `
  u.id AS user_id, u.email, u.full_name, u.phone, u.role, u.status AS user_status, u.created_at AS user_created_at, u.updated_at AS user_updated_at,
  dp.id AS distributor_profile_id, dp.company_name, dp.tax_id, dp.billing_address, dp.city, dp.province, dp.postal_code, dp.country,
  dp.website, dp.contact_person, dp.validation_status, dp.discount_percent, dp.approved_at, dp.approved_by, dp.review_notes,
  dp.created_at AS profile_created_at, dp.updated_at AS profile_updated_at`;

const getProfile = async (userId: string) => {
  const { rows } = await pool.query(`SELECT ${profileSelect} FROM store.users u LEFT JOIN store.distributor_profiles dp ON dp.user_id = u.id WHERE u.id = $1`, [userId]);
  return rows[0];
};

const updateSchema = z.object({
  company_name: z.string().min(1).max(200).optional(),
  tax_id: z.string().min(1).max(80).optional(),
  billing_address: z.string().max(500).nullable().optional(),
  city: z.string().max(120).nullable().optional(),
  province: z.string().max(120).nullable().optional(),
  postal_code: z.string().max(30).nullable().optional(),
  country: z.string().max(2).nullable().optional(),
  website: z.string().url().max(300).nullable().optional(),
  contact_person: z.string().max(200).nullable().optional()
}).strict();

distributorRouter.get('/profile', async (req, res, next) => {
  try { res.json({ profile: await getProfile(req.user!.sub) }); } catch (error) { next(error); }
});

distributorRouter.patch('/profile', async (req, res, next) => {
  const client = await pool.connect();
  try {
    const input = updateSchema.parse(req.body);
    await client.query('BEGIN');
    const { rows: existing } = await client.query('SELECT id FROM store.distributor_profiles WHERE user_id = $1', [req.user!.sub]);
    if (!existing[0]) { res.status(404).json({ error: 'Distributor profile not found' }); await client.query('ROLLBACK'); return; }
    await client.query(`UPDATE store.distributor_profiles SET
      company_name = COALESCE($2, company_name), tax_id = COALESCE($3, tax_id), billing_address = COALESCE($4, billing_address),
      city = COALESCE($5, city), province = COALESCE($6, province), postal_code = COALESCE($7, postal_code), country = COALESCE($8, country),
      website = COALESCE($9, website), contact_person = COALESCE($10, contact_person), updated_at = now()
      WHERE user_id = $1`, [req.user!.sub, input.company_name, input.tax_id, input.billing_address, input.city, input.province, input.postal_code, input.country, input.website, input.contact_person]);
    await writeAuditLog({ actorUserId: req.user!.sub, action: 'distributor_profile_updated', entityType: 'distributor_profile', entityId: existing[0].id, payload: { fields: Object.keys(input) } }, client);
    await client.query('COMMIT');
    res.json({ profile: await getProfile(req.user!.sub) });
  } catch (error) { await client.query('ROLLBACK'); next(error); } finally { client.release(); }
});

const readMultipart = async (req: any, maxBytes: number): Promise<{ documentType: string; file: any; filename: string; mimeType: string }> => new Promise((resolve, reject) => {
  const contentType = req.headers['content-type'] ?? '';
  const match = /boundary=(?:(?:"([^"]+)")|([^;]+))/i.exec(contentType);
  if (!match) { reject(Object.assign(new Error('Multipart boundary missing'), { status: 400 })); return; }
  const chunks: any[] = []; let size = 0;
  req.on('data', (chunk: any) => { size += chunk.length; if (size > maxBytes + 1024 * 1024) { req.destroy(); reject(Object.assign(new Error('File too large'), { status: 413 })); } else chunks.push(chunk); });
  req.on('end', () => {
    const body = Buffer.concat(chunks); const boundary = Buffer.from(`--${match[1] ?? match[2]}`);
    const parts = body.toString('binary').split(boundary.toString('binary'));
    let documentType = ''; let file: any; let filename = ''; let mimeType = '';
    for (const part of parts) {
      const sep = part.indexOf('\r\n\r\n'); if (sep < 0) continue;
      const headers = part.slice(0, sep); let content: any = Buffer.from(part.slice(sep + 4).replace(/\r\n--$/, '').replace(/\r\n$/, ''), 'binary');
      const name = /name="([^"]+)"/i.exec(headers)?.[1];
      if (name === 'documentType') documentType = content.toString('utf8').trim();
      if (name === 'file') { filename = path.basename(/filename="([^"]*)"/i.exec(headers)?.[1] ?? 'document.pdf').replace(/[^a-zA-Z0-9._-]/g, '_'); mimeType = /content-type:\s*([^\r\n]+)/i.exec(headers)?.[1]?.trim() ?? ''; file = content; }
    }
    if (!file) reject(Object.assign(new Error('File is required'), { status: 400 })); else resolve({ documentType, file, filename, mimeType });
  });
  req.on('error', reject);
});

distributorRouter.post('/documents', async (req, res, next) => {
  const client = await pool.connect();
  try {
    const setting = await pool.query(`SELECT value->>'value' AS value FROM store.settings WHERE key = 'document_max_size_bytes'`);
    const maxBytes = Number(setting.rows[0]?.value ?? 10485760);
    const upload = await readMultipart(req, maxBytes);
    if (!documentTypes.includes(upload.documentType as any)) { res.status(400).json({ error: 'Invalid document type' }); return; }
    if (upload.mimeType !== 'application/pdf' || upload.file.subarray(0, 4).toString() !== '%PDF') { res.status(400).json({ error: 'Only PDF files are allowed' }); return; }
    if (upload.file.length > maxBytes) { res.status(413).json({ error: 'File too large' }); return; }
    const { rows: profiles } = await client.query('SELECT id FROM store.distributor_profiles WHERE user_id = $1', [req.user!.sub]);
    if (!profiles[0]) { res.status(404).json({ error: 'Distributor profile not found' }); return; }
    const dir = path.resolve(env.documentsPath, req.user!.sub); await mkdir(dir, { recursive: true });
    const safeName = `${randomUUID()}-${upload.filename.endsWith('.pdf') ? upload.filename : `${upload.filename}.pdf`}`;
    const filePath = path.resolve(dir, safeName); if (!filePath.startsWith(path.resolve(env.documentsPath))) throw new Error('Invalid document path');
    await writeFile(filePath, upload.file, { flag: 'wx' });
    await client.query('BEGIN');
    const replaced = await client.query(`UPDATE store.distributor_documents
      SET status = 'replaced', reviewed_at = now(), review_notes = COALESCE(review_notes, 'Replaced by a newer upload of the same document type')
      WHERE distributor_profile_id = $1 AND document_type = $2 AND status <> 'replaced'
      RETURNING id`, [profiles[0].id, upload.documentType]);
    const { rows } = await client.query(`INSERT INTO store.distributor_documents (distributor_profile_id, document_type, file_name, file_path, mime_type, file_size_bytes, status, uploaded_at, created_at)
      VALUES ($1,$2,$3,$4,'application/pdf',$5,'pending',now(),now()) RETURNING id, document_type, status, created_at`, [profiles[0].id, upload.documentType, upload.filename, filePath, upload.file.length]);
    await client.query(`UPDATE store.distributor_profiles
      SET validation_status = 'pending', approved_at = NULL, approved_by = NULL, reviewed_at = NULL, reviewed_by = NULL, updated_at = now()
      WHERE id = $1`, [profiles[0].id]);
    if (replaced.rows.length > 0) {
      await writeAuditLog({ actorUserId: req.user!.sub, action: 'distributor_document_replaced', entityType: 'distributor_profile', entityId: profiles[0].id, payload: { document_type: upload.documentType, replaced_document_ids: replaced.rows.map((row: any) => row.id), new_document_id: rows[0].id } }, client);
    }
    await writeAuditLog({ actorUserId: req.user!.sub, action: 'distributor_document_uploaded', entityType: 'distributor_document', entityId: rows[0].id, payload: { document_type: upload.documentType, validation_status: 'pending' } }, client);
    await client.query('COMMIT'); res.status(201).json({ document: rows[0] });
  } catch (error: any) { await client.query('ROLLBACK'); if (error.status) res.status(error.status).json({ error: error.message }); else next(error); } finally { client.release(); }
});

distributorRouter.get('/documents', async (req, res, next) => {
  try {
    const { rows } = await pool.query(`SELECT dd.id, dd.document_type, dd.status, dd.created_at FROM store.distributor_documents dd JOIN store.distributor_profiles dp ON dp.id = dd.distributor_profile_id WHERE dp.user_id = $1 ORDER BY dd.created_at DESC`, [req.user!.sub]);
    res.json(rows);
  } catch (error) { next(error); }
});
