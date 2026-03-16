import { Router } from 'express';
import { config } from '../config.js';
import { listRecentEvents } from '../db/repositories/eventsRepo.js';
import { listRegisteredTags, upsertRegisteredTag } from '../db/repositories/registeredTagsRepo.js';
import { listActiveInventory, listUnregistered } from '../db/repositories/stateRepo.js';
import { buildDashboardInitial, mapReadEventPayload } from '../services/dashboardStateService.js';

const sanitizeEpc = (value: unknown): string => String(value ?? '').trim().toUpperCase();

export const createApiRouter = (): Router => {
  const router = Router();

  router.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  router.get('/api/dashboard/initial', async (_req, res, next) => {
    try {
      const data = await buildDashboardInitial();
      res.json(data);
    } catch (error) {
      next(error);
    }
  });

  router.get('/api/dashboard/events', async (req, res, next) => {
    try {
      const limit = Math.max(1, Math.min(500, Number.parseInt(String(req.query.limit ?? '50'), 10) || 50));
      const events = await listRecentEvents(limit);
      res.json({ items: events.map((event) => mapReadEventPayload(event)), limit });
    } catch (error) {
      next(error);
    }
  });

  router.get('/api/dashboard/active', async (_req, res, next) => {
    try {
      const rows = await listActiveInventory(config.business.activeLimit);
      res.json({
        items: rows.map((row) => ({
          epc: row.epc,
          isActive: row.is_active,
          isRegistered: row.is_registered,
          lastReaderMac: row.last_reader_mac,
          lastAntenna: row.last_antenna,
          lastDirection: row.last_direction,
          firstSeenAt: row.first_seen_at.toISOString(),
          lastSeenAt: row.last_seen_at.toISOString(),
          lastEventTs: row.last_event_ts.toISOString(),
          updatedAt: row.updated_at.toISOString()
        }))
      });
    } catch (error) {
      next(error);
    }
  });

  router.get('/api/dashboard/unregistered', async (_req, res, next) => {
    try {
      const rows = await listUnregistered(config.business.activeLimit);
      res.json({
        items: rows.map((row) => ({
          epc: row.epc,
          isActive: row.is_active,
          isRegistered: row.is_registered,
          lastReaderMac: row.last_reader_mac,
          lastAntenna: row.last_antenna,
          lastDirection: row.last_direction,
          firstSeenAt: row.first_seen_at.toISOString(),
          lastSeenAt: row.last_seen_at.toISOString(),
          lastEventTs: row.last_event_ts.toISOString(),
          updatedAt: row.updated_at.toISOString()
        }))
      });
    } catch (error) {
      next(error);
    }
  });

  router.get('/api/tags', async (req, res, next) => {
    try {
      const limit = Math.max(1, Math.min(2000, Number.parseInt(String(req.query.limit ?? '500'), 10) || 500));
      const items = await listRegisteredTags(limit);
      res.json({ items, limit });
    } catch (error) {
      next(error);
    }
  });

  router.post('/api/tags', async (req, res, next) => {
    try {
      const epc = sanitizeEpc(req.body?.epc);
      if (!epc) {
        res.status(400).json({ error: 'epc is required' });
        return;
      }

      const tag = await upsertRegisteredTag({
        epc,
        name: typeof req.body?.name === 'string' ? req.body.name.trim() : null,
        description: typeof req.body?.description === 'string' ? req.body.description.trim() : null
      });

      res.status(201).json({ item: tag });
    } catch (error) {
      next(error);
    }
  });

  return router;
};
