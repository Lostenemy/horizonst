import path from 'node:path';
import { fileURLToPath } from 'node:url';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { ZodError } from 'zod';
import { env } from './config/env.js';
import { authRouter } from './modules/auth/auth.routes.js';
import { catalogRouter } from './modules/catalog/catalog.routes.js';
import { healthRouter } from './modules/health/health.routes.js';
import { customerRouter } from './modules/customer/customer.routes.js';
import { distributorRouter } from './modules/distributor/distributor.routes.js';
import { adminDistributorsRouter } from './modules/admin/distributors.routes.js';
import { adminQuotesRouter } from './modules/admin/quotes.routes.js';
import { adminOrdersRouter } from './modules/admin/orders.routes.js';
import { adminAuditRouter } from './modules/admin/audit.routes.js';
import { adminCatalogRouter } from './modules/admin/catalog.routes.js';
import { adminDashboardRouter } from './modules/admin/dashboard.routes.js';
import { cartRouter } from './modules/cart/cart.routes.js';
import { quotesRouter } from './modules/quotes/quotes.routes.js';
import { ordersRouter } from './modules/orders/orders.routes.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webDist = path.resolve(__dirname, '../web/dist');
const app = express();

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: env.corsOrigin, credentials: false }));
app.use(express.json({ limit: '1mb' }));

app.use('/health', healthRouter);
app.use('/api/health', healthRouter);
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
app.use(express.static(webDist));
app.get('*', (_req, res) => res.sendFile(path.join(webDist, 'index.html')));

app.use((error: any, _req: any, res: any, _next: any) => {
  if (error instanceof ZodError) {
    res.status(400).json({ error: 'Validation error', details: error.flatten() });
    return;
  }
  if (error && typeof error === 'object' && 'code' in error && error.code === '23505') {
    res.status(409).json({ error: 'Resource already exists' });
    return;
  }
  console.error(error);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(env.port, '0.0.0.0', () => {
  console.log(`HorizonST Store listening on ${env.port}`);
});
