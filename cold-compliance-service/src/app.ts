import express from 'express';
import { db } from './db/pool';
import { errorHandler } from './middleware/error-handler';
import { alertsRouter } from './modules/alerts/alerts.routes';
import { camerasRouter } from './modules/cameras/cameras.routes';
import { incidentsRouter } from './modules/incidents/incidents.routes';
import { eventsRouter } from './modules/presence/events.routes';
import { reportsRouter } from './modules/reports/reports.routes';
import { tagsRouter } from './modules/tags/tags.routes';
import { workersRouter } from './modules/workers/workers.routes';

export function buildApp() {
  const app = express();
  app.use(express.json({ limit: '2mb' }));

  app.get('/health', (_req, res) => res.json({ status: 'ok' }));
  app.get('/ready', async (_req, res) => {
    await db.query('SELECT 1');
    res.json({ status: 'ready' });
  });

  app.use('/workers', workersRouter);
  app.use('/tags', tagsRouter);
  app.use('/cameras', camerasRouter);
  app.use('/events', eventsRouter);
  app.use('/incidents', incidentsRouter);
  app.use('/alerts', alertsRouter);
  app.use('/reports', reportsRouter);

  app.use(errorHandler);
  return app;
}
