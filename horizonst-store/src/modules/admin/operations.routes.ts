import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../../db/pool.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { writeAuditLog } from '../shared/audit.js';

export const adminOperationsRouter = Router();
adminOperationsRouter.use(requireAuth, requireRole('admin'));

const idSchema = z.string().uuid();
const limitSchema = z.coerce.number().int().min(1).max(200).default(100);
const optionalDate = z.string().datetime().or(z.string().date()).optional();

adminOperationsRouter.get('/audit', async (req, res, next) => {
  try {
    const q = z.object({ action: z.string().trim().optional(), entity_type: z.string().trim().optional(), actor_user_id: z.string().uuid().optional(), entity_id: z.string().uuid().optional(), date_from: optionalDate, date_to: optionalDate, search: z.string().trim().optional(), limit: limitSchema }).parse(req.query);
    const params: unknown[] = []; const where: string[] = [];
    for (const [key, col] of [['action','a.action'], ['entity_type','a.entity_type'], ['actor_user_id','a.actor_user_id'], ['entity_id','a.entity_id']] as const) {
      const v = q[key]; if (v) { params.push(v); where.push(`${col} = $${params.length}`); }
    }
    if (q.date_from) { params.push(q.date_from); where.push(`a.created_at >= $${params.length}`); }
    if (q.date_to) { params.push(q.date_to); where.push(`a.created_at <= $${params.length}`); }
    if (q.search) { params.push(`%${q.search}%`); where.push(`(a.action ILIKE $${params.length} OR a.entity_type ILIKE $${params.length} OR a.payload::text ILIKE $${params.length} OR u.email ILIKE $${params.length})`); }
    params.push(q.limit);
    const { rows } = await pool.query(`SELECT a.id, a.actor_user_id, a.action, a.entity_type, a.entity_id, a.payload, a.created_at,
      u.email AS actor_email, u.full_name AS actor_full_name
      FROM store.audit_log a LEFT JOIN store.users u ON u.id = a.actor_user_id
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY a.created_at DESC LIMIT $${params.length}`, params);
    res.json({ events: rows });
  } catch (error) { next(error); }
});

adminOperationsRouter.get('/dashboard', async (_req, res, next) => {
  try {
    const [customers, distributors, quoteCounts, values, audit, quotes, dist] = await Promise.all([
      pool.query(`SELECT COUNT(*)::int AS count FROM store.users WHERE role = 'customer'`),
      pool.query(`SELECT validation_status, COUNT(*)::int AS count FROM store.distributor_profiles WHERE validation_status IN ('pending','approved') GROUP BY validation_status`),
      pool.query(`SELECT status, COUNT(*)::int AS count FROM store.quotes WHERE status IN ('submitted','in_review','sent','accepted') GROUP BY status`),
      pool.query(`SELECT COALESCE(SUM(total_cents) FILTER (WHERE status IN ('submitted','in_review','sent')),0)::int AS open_value_cents, COALESCE(SUM(total_cents) FILTER (WHERE status = 'accepted'),0)::int AS accepted_value_cents FROM store.quotes`),
      pool.query(`SELECT a.id, a.action, a.entity_type, a.entity_id, a.created_at, u.email AS actor_email FROM store.audit_log a LEFT JOIN store.users u ON u.id = a.actor_user_id ORDER BY a.created_at DESC LIMIT 10`),
      pool.query(`SELECT q.id, q.quote_number, q.status, q.total_cents, q.created_at, u.email FROM store.quotes q JOIN store.users u ON u.id = q.user_id ORDER BY q.created_at DESC LIMIT 10`),
      pool.query(`SELECT dp.id, dp.company_name, dp.validation_status, dp.created_at, u.email FROM store.distributor_profiles dp JOIN store.users u ON u.id = dp.user_id ORDER BY dp.created_at DESC LIMIT 10`)
    ]);
    const distributorMap = Object.fromEntries(distributors.rows.map((r) => [r.validation_status, r.count]));
    const quoteMap = Object.fromEntries(quoteCounts.rows.map((r) => [r.status, r.count]));
    res.json({ metrics: { customers_registered: customers.rows[0].count, distributors_pending: distributorMap.pending ?? 0, distributors_approved: distributorMap.approved ?? 0, quotes_submitted: quoteMap.submitted ?? 0, quotes_in_review: quoteMap.in_review ?? 0, quotes_sent: quoteMap.sent ?? 0, quotes_accepted: quoteMap.accepted ?? 0, open_value_cents: values.rows[0].open_value_cents, accepted_value_cents: values.rows[0].accepted_value_cents }, latestAudit: audit.rows, latestQuotes: quotes.rows, latestDistributors: dist.rows });
  } catch (error) { next(error); }
});

const productSchema = z.object({ sku: z.string().trim().min(1).max(80), name: z.string().trim().min(1).max(200), description: z.string().trim().max(2000).nullable().optional(), category: z.enum(['hardware','accessory']), price_cents: z.number().int().min(0), tax_rate: z.number().min(0).max(100).optional(), is_active: z.boolean().optional() }).strict();
const productPatchSchema = productSchema.partial();
const planSchema = z.object({ code: z.string().trim().min(1).max(80), name: z.string().trim().min(1).max(200), description: z.string().trim().max(2000).nullable().optional(), annual_price_cents: z.number().int().min(0).nullable().optional(), tax_rate: z.number().min(0).max(100).optional(), max_tags: z.number().int().min(0).nullable().optional(), max_gateways: z.number().int().min(0).nullable().optional(), is_enterprise: z.boolean().default(false), is_active: z.boolean().optional() }).strict().refine((v) => v.is_enterprise || v.annual_price_cents != null, { message: 'annual_price_cents is required unless is_enterprise=true' }).refine((v) => !v.is_enterprise || v.annual_price_cents == null, { message: 'Enterprise plans must not have annual_price_cents' });
const planPatchSchema = planSchema.partial().refine((v) => v.is_enterprise !== true || v.annual_price_cents == null, { message: 'Enterprise plans must not have annual_price_cents' });

adminOperationsRouter.get('/products', async (_req, res, next) => { try { const { rows } = await pool.query('SELECT * FROM store.products ORDER BY created_at DESC'); res.json({ products: rows }); } catch (e) { next(e); } });
adminOperationsRouter.get('/products/:id', async (req, res, next) => { try { const { rows } = await pool.query('SELECT * FROM store.products WHERE id=$1', [idSchema.parse(req.params.id)]); if (!rows[0]) { res.status(404).json({ error: 'Product not found' }); return; } res.json({ product: rows[0] }); } catch (e) { next(e); } });
adminOperationsRouter.post('/products', async (req, res, next) => { const client = await pool.connect(); try { const i = productSchema.parse(req.body); await client.query('BEGIN'); const { rows } = await client.query(`INSERT INTO store.products (sku,name,description,category,price_cents,tax_rate,is_active) VALUES ($1,$2,$3,$4,$5,COALESCE($6,21),COALESCE($7,true)) RETURNING *`, [i.sku,i.name,i.description??null,i.category,i.price_cents,i.tax_rate??null,i.is_active??null]); await writeAuditLog({ actorUserId:req.user!.sub, action:'product_created', entityType:'product', entityId:rows[0].id, payload:i }, client); await client.query('COMMIT'); res.status(201).json({ product: rows[0] }); } catch(e){ await client.query('ROLLBACK'); next(e); } finally { client.release(); } });
adminOperationsRouter.patch('/products/:id', async (req, res, next) => { const client = await pool.connect(); try { const id=idSchema.parse(req.params.id); const i=productPatchSchema.parse(req.body); const sets:string[]=[]; const params:unknown[]=[id]; Object.entries(i).forEach(([k,v])=>{ params.push(v); sets.push(`${k}=$${params.length}`); }); if(!sets.length){ res.status(400).json({error:'No changes provided'}); return; } await client.query('BEGIN'); const { rows } = await client.query(`UPDATE store.products SET ${sets.join(', ')}, updated_at=now() WHERE id=$1 RETURNING *`, params); if(!rows[0]){ await client.query('ROLLBACK'); res.status(404).json({error:'Product not found'}); return; } await writeAuditLog({ actorUserId:req.user!.sub, action:i.is_active===false?'product_deactivated':'product_updated', entityType:'product', entityId:id, payload:i }, client); await client.query('COMMIT'); res.json({ product: rows[0] }); } catch(e){ await client.query('ROLLBACK'); next(e); } finally { client.release(); } });
adminOperationsRouter.get('/saas-plans', async (_req, res, next) => { try { const { rows } = await pool.query('SELECT * FROM store.saas_plans ORDER BY is_enterprise ASC, annual_price_cents ASC NULLS LAST'); res.json({ saasPlans: rows }); } catch (e) { next(e); } });
adminOperationsRouter.get('/saas-plans/:id', async (req, res, next) => { try { const { rows } = await pool.query('SELECT * FROM store.saas_plans WHERE id=$1', [idSchema.parse(req.params.id)]); if (!rows[0]) { res.status(404).json({ error: 'SaaS plan not found' }); return; } res.json({ saasPlan: rows[0] }); } catch (e) { next(e); } });
adminOperationsRouter.post('/saas-plans', async (req, res, next) => { const client=await pool.connect(); try { const i=planSchema.parse(req.body); await client.query('BEGIN'); const { rows }=await client.query(`INSERT INTO store.saas_plans (code,name,description,annual_price_cents,tax_rate,max_tags,max_gateways,is_enterprise,is_active) VALUES ($1,$2,$3,$4,COALESCE($5,21),$6,$7,$8,COALESCE($9,true)) RETURNING *`, [i.code,i.name,i.description??null,i.is_enterprise?null:i.annual_price_cents??null,i.tax_rate??null,i.max_tags??null,i.max_gateways??null,i.is_enterprise,i.is_active??null]); await writeAuditLog({ actorUserId:req.user!.sub, action:'saas_plan_created', entityType:'saas_plan', entityId:rows[0].id, payload:i }, client); await client.query('COMMIT'); res.status(201).json({ saasPlan: rows[0] }); } catch(e){ await client.query('ROLLBACK'); next(e); } finally { client.release(); } });
adminOperationsRouter.patch('/saas-plans/:id', async (req, res, next) => { const client=await pool.connect(); try { const id=idSchema.parse(req.params.id); const i=planPatchSchema.parse(req.body); const sets:string[]=[]; const params:unknown[]=[id]; Object.entries(i).forEach(([k,v])=>{ params.push(k==='annual_price_cents' && i.is_enterprise?null:v); sets.push(`${k}=$${params.length}`); }); if(!sets.length){ res.status(400).json({error:'No changes provided'}); return; } await client.query('BEGIN'); const { rows }=await client.query(`UPDATE store.saas_plans SET ${sets.join(', ')}, updated_at=now() WHERE id=$1 RETURNING *`, params); if(!rows[0]){ await client.query('ROLLBACK'); res.status(404).json({error:'SaaS plan not found'}); return; } if(!rows[0].is_enterprise && rows[0].annual_price_cents == null){ await client.query('ROLLBACK'); res.status(400).json({error:'annual_price_cents is required unless is_enterprise=true'}); return; } await writeAuditLog({ actorUserId:req.user!.sub, action:i.is_active===false?'saas_plan_deactivated':'saas_plan_updated', entityType:'saas_plan', entityId:id, payload:i }, client); await client.query('COMMIT'); res.json({ saasPlan: rows[0] }); } catch(e){ await client.query('ROLLBACK'); next(e); } finally { client.release(); } });
