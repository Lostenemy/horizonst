import path from 'node:path';
import { fileURLToPath } from 'node:url';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { ZodError } from 'zod';
import { env } from './config/env.js';
import { configureTrustProxy } from './config/trust-proxy.js';
import { authRouter } from './modules/auth/auth.routes.js';
import { catalogRouter } from './modules/catalog/catalog.routes.js';
import { healthRouter } from './modules/health/health.routes.js';
import { leadsRouter } from './modules/leads/leads.routes.js';
import { prereservationRouter } from './modules/prereservation/prereservation.routes.js';
import { customerRouter } from './modules/customer/customer.routes.js';
import { distributorRouter } from './modules/distributor/distributor.routes.js';
import { adminDistributorsRouter } from './modules/admin/distributors.routes.js';
import { adminQuotesRouter } from './modules/admin/quotes.routes.js';
import { adminOrdersRouter } from './modules/admin/orders.routes.js';
import { adminAuditRouter } from './modules/admin/audit.routes.js';
import { adminCatalogRouter } from './modules/admin/catalog.routes.js';
import { adminCustomersRouter } from './modules/admin/customers.routes.js';
import { adminPrereservationsRouter } from './modules/admin/prereservations.routes.js';
import { adminDashboardRouter } from './modules/admin/dashboard.routes.js';
import { cartRouter } from './modules/cart/cart.routes.js';
import { quotesRouter } from './modules/quotes/quotes.routes.js';
import { ordersRouter } from './modules/orders/orders.routes.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webDist = path.resolve(__dirname, '../web/dist');
export const createServer = (staticRoot = webDist) => {
  const app = express();
  configureTrustProxy(app);
  const guidePath = path.join(staticRoot, 'recursos', 'guia-appcc-2026.pdf');

  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(cors({ origin: env.corsOrigin, credentials: false }));
  app.use(express.json({ limit: '16kb' }));

  app.use('/health', healthRouter);
  app.use('/api/health', healthRouter);
  app.use('/api/leads', leadsRouter);
  app.use('/api/public/prereservation', prereservationRouter);
  app.use('/api/catalog', catalogRouter);
  app.use('/api/auth', authRouter);
  app.use('/api/customer', customerRouter);
  app.use('/api/distributor', distributorRouter);
  app.use('/api/cart', cartRouter);
  app.use('/api/quotes', quotesRouter);
  app.use('/api/orders', ordersRouter);
  app.use('/api/admin', adminDistributorsRouter);
  app.use('/api/admin', adminQuotesRouter);
  app.use('/api/admin', adminOrdersRouter);
  app.use('/api/admin', adminDashboardRouter);
  app.use('/api/admin', adminAuditRouter);
  app.use('/api/admin', adminCatalogRouter);
  app.use('/api/admin', adminCustomersRouter);
  app.use('/api/admin', adminPrereservationsRouter);
  app.get('/recursos/guia-appcc-2026.pdf', (_req, res, next) => {
    res.sendFile(guidePath, { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': 'inline; filename="guia-appcc-2026-horizonst.pdf"' } }, (error) => error ? next(error) : undefined);
  });
  app.all('/recursos/*', (_req, res) => res.status(404).json({ error: 'Resource not found' }));
  app.use(express.static(staticRoot));
  app.get('*', (_req, res) => res.sendFile(path.join(staticRoot, 'index.html')));

  app.use((error: any, _req: any, res: any, _next: any) => {
    if (error instanceof ZodError) return res.status(400).json({ error: 'Validation error', details: error.flatten() });
    if (error?.status === 404) return res.status(404).json({ error: 'Resource not found' });
    if (error && typeof error === 'object' && 'code' in error && error.code === '23505') return res.status(409).json({ error: 'Resource already exists' });
    console.error(error);
    return res.status(500).json({ error: 'Internal server error' });
  });

  return app;
};

export const app = createServer();
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) app.listen(env.port, '0.0.0.0', () => console.log(`HorizonST Store listening on ${env.port}`));
