import { Router } from 'express';
import { db } from '../../db/pool';
import { requireAuth } from '../../middleware/auth';
import { loadPresenceStateSnapshot, PresenceWorkerSummary } from '../presence/presence-state.service';

export const realtimeRouter = Router();
realtimeRouter.use(requireAuth);

function withPresenceStatus(workers: PresenceWorkerSummary[], workerIdsWithAlerts: Set<string>): Array<PresenceWorkerSummary & { presence_status: 'dentro' | 'alarma' | 'gracia' }> {
  return workers.map((worker) => {
    if (worker.worker_id && workerIdsWithAlerts.has(worker.worker_id)) {
      return { ...worker, presence_status: 'alarma' as const };
    }
    return { ...worker, presence_status: 'dentro' as const };
  });
}

async function loadOperationalSnapshot() {
  const [presence, alerts] = await Promise.all([
    loadPresenceStateSnapshot(),
    db.query(
      `SELECT id, worker_id, tag_id, severity, alert_type, message, created_at
       FROM alerts
       WHERE acknowledged_at IS NULL
       ORDER BY created_at DESC
       LIMIT 200`
    )
  ]);

  const workerIdsWithAlerts = new Set(
    alerts.rows
      .map((alert) => alert.worker_id)
      .filter((workerId): workerId is string => typeof workerId === 'string' && workerId.length > 0)
  );

  const workersInside = withPresenceStatus(presence.inside, workerIdsWithAlerts);
  const workersGrace = presence.grace.map((worker) => ({ ...worker, presence_status: 'gracia' as const }));

  return {
    workersInside,
    workersGrace,
    activeAlerts: alerts.rows,
    totals: {
      workersInside: workersInside.length,
      workersGrace: workersGrace.length,
      activeAlerts: alerts.rowCount
    },
    ts: new Date().toISOString()
  };
}

realtimeRouter.get('/snapshot', async (_req, res, next) => {
  try {
    res.json(await loadOperationalSnapshot());
  } catch (error) {
    next(error);
  }
});

realtimeRouter.get('/stream', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const push = async () => {
    const payload = await loadOperationalSnapshot();
    res.write(`event: snapshot\n`);
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  const timer = setInterval(() => {
    push().catch(() => {
      clearInterval(timer);
      res.end();
    });
  }, 5000);

  push().catch(() => {
    clearInterval(timer);
    res.end();
  });

  req.on('close', () => clearInterval(timer));
});
