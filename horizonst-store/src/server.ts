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
import { distributorResourcesRouter } from './modules/distributor/resources.routes.js';
import { adminDistributorsRouter } from './modules/admin/distributors.routes.js';
import { adminDistributorResourcesRouter } from './modules/admin/distributor-resources.routes.js';
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
import { contactRouter } from './modules/contact/contact.routes.js';
import { lifecycle } from './lifecycle.js';
import { databaseLifecycle } from './db/pool.js';
import { notificationJournal } from './modules/shared/notification-journal.js';
import { notificationsRouter } from './modules/shared/notifications.routes.js';
import { isPublicMarketingHost } from './resources/store-domains.js';
import { indexableCommercialPaths } from './resources/public-pages.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webDist = path.resolve(__dirname, '../web/dist');
export const createServer = (staticRoot = webDist) => {
  const app = express();
  app.use((_req, res, next) => lifecycle.stopping
    ? res.status(503).json({ status: 'degraded', service: 'horizonst-store', database: 'unavailable' }) : next());
  configureTrustProxy(app, env.trustedProxyIp);
  const guidePath = path.join(staticRoot, 'recursos', 'guia-appcc-2026.pdf');

  app.use(helmet({ contentSecurityPolicy: false }));
  app.use((req, res, next) => { if (['horizonst.com.es', 'www.horizonst.com.es'].includes(req.hostname.toLowerCase())) res.set('X-Robots-Tag', 'noindex, nofollow'); next(); });
  app.use(cors({ origin: env.corsOrigin, credentials: false }));
  app.use('/api/contact', contactRouter);
  app.use(express.json({ limit: '16kb' }));
  app.use('/api', notificationsRouter);

  app.use('/health', healthRouter);
  app.use('/api/health', healthRouter);
  app.use('/api/leads', leadsRouter);
  app.use('/api/public/prereservation', prereservationRouter);
  app.use('/api/catalog', catalogRouter);
  app.use('/api/auth', authRouter);
  app.use('/api/customer', customerRouter);
  app.use('/api/distributor', distributorRouter);
  app.use('/api/distributor', distributorResourcesRouter);
  app.use('/api/cart', cartRouter);
  app.use('/api/quotes', quotesRouter);
  app.use('/api/orders', ordersRouter);
  app.use('/api/admin', adminDistributorsRouter);
  app.use('/api/admin', adminDistributorResourcesRouter);
  app.use('/api/admin', adminQuotesRouter);
  app.use('/api/admin', adminOrdersRouter);
  app.use('/api/admin', adminDashboardRouter);
  app.use('/api/admin', adminAuditRouter);
  app.use('/api/admin', adminCatalogRouter);
  app.use('/api/admin', adminCustomersRouter);
  app.use('/api/admin', adminPrereservationsRouter);
  app.use('/api', (_req, res) => res.status(404).json({ error: 'API route not found' }));
  app.get('/recursos/guia-appcc-2026.pdf', (_req, res, next) => {
    res.sendFile(guidePath, { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': 'inline; filename="guia-appcc-2026-horizonst.pdf"' } }, (error) => error ? next(error) : undefined);
  });
  app.all('/recursos/*', (_req, res) => res.status(404).json({ error: 'Resource not found' }));
  app.get('/robots.txt', (req, res) => {
    const production = ['horizonst.es', 'www.horizonst.es'].includes(req.hostname.toLowerCase());
    res.type('text/plain').send(production ? 'User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /prerreserva/\nDisallow: /prerender/\nSitemap: https://horizonst.es/sitemap.xml\n' : 'User-agent: *\nDisallow: /\n');
  });
  app.get('/sitemap.xml', (req, res) => {
    if (!isPublicMarketingHost(req.hostname)) return res.sendStatus(404);
    const urls = indexableCommercialPaths.map(route => `<url><loc>https://horizonst.es${route}</loc></url>`).join('');
    return res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`);
  });
  app.use('/prerender', (_req, res) => res.sendStatus(404));
  app.use(express.static(staticRoot, { index: false }));
  app.get('*', (req, res, next) => {
    const hostname = req.hostname.toLowerCase();
    if (isPublicMarketingHost(hostname)) {
      if (indexableCommercialPaths.includes(req.path as typeof indexableCommercialPaths[number])) {
        const environment = hostname.endsWith('.com.es') ? 'staging' : 'production';
        const filename = req.path === '/' ? 'index.html' : `${req.path.slice(1)}.html`;
        return res.sendFile(path.join(staticRoot, 'prerender', environment, filename), error => error ? next(error) : undefined);
      }
      if (/^\/prerreserva\/(starter|professional|enterprise)$/.test(req.path)) { res.set('X-Robots-Tag', 'noindex, nofollow'); return res.sendFile(path.join(staticRoot, 'index.html')); }
      return res.sendStatus(404);
    }
    const storeRoutes = /^\/(?:|login|register|register-distributor|verify-email|forgot-password|reset-password|dashboard|account|catalog|saas-plans|cart|quotes|orders|aviso-legal|privacidad|prerreserva\/(?:starter|professional|enterprise)|distributor(?:\/(?:profile|documents|resources))?|admin(?:\/(?:distributors(?:\/[^/]+)?|distributor-resources|customers|prereservations(?:\/[^/]+)?|quotes(?:\/[^/]+)?|orders(?:\/[^/]+)?|audit|catalog\/(?:products|saas-plans)))?)\/?$/;
    if (!storeRoutes.test(req.path)) return res.sendStatus(404);
    res.set('X-Robots-Tag', 'noindex, nofollow');
    return res.sendFile(path.join(staticRoot, 'index.html'));
  });

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
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  notificationJournal.start();
  const server = app.listen(env.port, '0.0.0.0', () => console.log(`HorizonST Store listening on ${env.port}`));
  lifecycle.install(server, async () => undefined, () => databaseLifecycle.close());
}
