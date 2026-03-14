import path from 'node:path';
import express from 'express';
import { db } from './db/pool';
import { errorHandler } from './middleware/error-handler';
import { alarmRulesRouter } from './modules/alarm-rules/alarm-rules.routes';
import { alertsRouter } from './modules/alerts/alerts.routes';
import { authRouter } from './modules/auth/auth.routes';
import { camerasRouter } from './modules/cameras/cameras.routes';
import { dashboardRouter } from './modules/dashboard/dashboard.routes';
import { eventsRouter } from './modules/presence/events.routes';
import { gatewaysRouter } from './modules/gateways/gateways.routes';
import { incidentsRouter } from './modules/incidents/incidents.routes';
import { realtimeRouter } from './modules/realtime/realtime.routes';
import { reportsRouter } from './modules/reports/reports.routes';
import { tagsRouter } from './modules/tags/tags.routes';
import { tagControlRouter } from './modules/tag-control/tag-control.routes';
import { usersRouter } from './modules/workers/users.routes';
import { workersRouter } from './modules/workers/workers.routes';

export function buildApp() {
  const app = express();
  app.set('trust proxy', true);
  app.use(express.json({ limit: '2mb' }));

  app.get('/health', (_req, res) => res.json({ status: 'ok' }));
  app.get('/ready', async (_req, res) => {
    await db.query('SELECT 1');
    res.json({ status: 'ready' });
  });

  app.use('/auth', authRouter);
  app.use('/users', usersRouter);
  app.use('/workers', workersRouter);
  app.use('/tags', tagsRouter);
  app.use('/gateways', gatewaysRouter);
  app.use('/cameras', camerasRouter);
  app.use('/events', eventsRouter);
  app.use('/incidents', incidentsRouter);
  app.use('/alerts', alertsRouter);
  app.use('/alarm-rules', alarmRulesRouter);
  app.use('/dashboard', dashboardRouter);
  app.use('/realtime', realtimeRouter);
  app.use('/reports', reportsRouter);
  app.use('/tag-control', tagControlRouter);

  const webDir = path.resolve(process.cwd(), 'web');
  app.use('/web', express.static(webDir));
  app.get('/', (_req, res) => res.sendFile(path.join(webDir, 'index.html')));

  app.use(errorHandler);
  return app;
}
