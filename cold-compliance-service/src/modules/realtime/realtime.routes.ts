import { Router } from 'express';
import { db } from '../../db/pool';
import { requireAuth } from '../../middleware/auth';

export const realtimeRouter = Router();
realtimeRouter.use(requireAuth);

async function loadOperationalSnapshot() {
  const [presence, grace, alerts] = await Promise.all([
    db.query(
      `SELECT s.id,
              COALESCE(s.worker_id, wta.worker_id) AS worker_id,
              COALESCE(w.full_name, '(sin trabajador asignado)') AS full_name,
              COALESCE(w.dni, '-') AS dni,
              s.started_at,
              EXTRACT(EPOCH FROM (NOW() - s.started_at))::INT AS elapsed_seconds,
              CASE WHEN COALESCE(pos.in_alarm, FALSE) THEN 'alarma' ELSE 'dentro' END AS presence_status
       FROM cold_room_sessions s
       LEFT JOIN presence_operational_state pos ON pos.tag_id = s.tag_id
       LEFT JOIN worker_tag_assignments wta ON wta.tag_id = s.tag_id AND wta.active = true
       LEFT JOIN workers w ON w.id = COALESCE(s.worker_id, wta.worker_id)
       WHERE s.ended_at IS NULL
       ORDER BY s.started_at ASC`
    ),
    db.query(
      `SELECT pos.tag_id,
              COALESCE(w.full_name, '(sin trabajador asignado)') AS full_name,
              GREATEST(0, EXTRACT(EPOCH FROM (pos.grace_until - NOW()))::INT) AS remaining_seconds,
              'gracia' AS presence_status
       FROM presence_operational_state pos
       LEFT JOIN workers w ON w.id = pos.worker_id
       WHERE pos.inside = FALSE
         AND pos.in_grace = TRUE
         AND pos.grace_until IS NOT NULL
         AND pos.grace_until > NOW()
       ORDER BY pos.grace_until ASC`
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
    workersInGrace: grace.rows,
    activeAlerts: alerts.rows,
    totals: {
      workersInside: presence.rowCount,
      workersInGrace: grace.rowCount,
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
