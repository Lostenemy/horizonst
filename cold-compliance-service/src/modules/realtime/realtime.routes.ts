import { Router } from 'express';
import { db } from '../../db/pool';
import { requireAuth } from '../../middleware/auth';

export const realtimeRouter = Router();
realtimeRouter.use(requireAuth);

async function loadOperationalSnapshot() {
  const [presence, alerts] = await Promise.all([
    db.query(
      `SELECT s.id,
              COALESCE(s.worker_id, wta.worker_id) AS worker_id,
              COALESCE(w.full_name, '(sin trabajador asignado)') AS full_name,
              COALESCE(w.dni, '-') AS dni,
              COALESCE(t.tag_uid, '') AS tag_uid,
              s.started_at,
              EXTRACT(EPOCH FROM (NOW() - s.started_at))::INT AS elapsed_seconds,
              CASE WHEN EXISTS(
                SELECT 1 FROM alerts a
                WHERE a.worker_id = COALESCE(s.worker_id, wta.worker_id) AND a.acknowledged_at IS NULL
              ) THEN 'alarma' ELSE 'dentro' END AS presence_status
       FROM cold_room_sessions s
       LEFT JOIN tags t ON t.id = s.tag_id
       LEFT JOIN worker_tag_assignments wta ON wta.tag_id = s.tag_id AND wta.active = true
       LEFT JOIN workers w ON w.id = COALESCE(s.worker_id, wta.worker_id)
       WHERE s.ended_at IS NULL
       ORDER BY s.started_at ASC`
    ),
    db.query(
      `SELECT id, worker_id, tag_id, severity, alert_type, message, created_at
       FROM alerts
       WHERE acknowledged_at IS NULL
       ORDER BY created_at DESC
       LIMIT 200`
    )
  ]);

  return {
    workersInside: presence.rows,
    activeAlerts: alerts.rows,
    totals: {
      workersInside: presence.rowCount,
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
