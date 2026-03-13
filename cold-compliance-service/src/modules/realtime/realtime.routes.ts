import { Router } from 'express';
import { db } from '../../db/pool';
import { requireAuth } from '../../middleware/auth';

export const realtimeRouter = Router();
realtimeRouter.use(requireAuth);

realtimeRouter.get('/stream', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const push = async () => {
    const [presence, alerts] = await Promise.all([
      db.query(`SELECT COUNT(*)::INT AS total FROM cold_room_sessions WHERE ended_at IS NULL`),
      db.query(`SELECT COUNT(*)::INT AS total FROM alerts WHERE acknowledged_at IS NULL`)
    ]);
    res.write(`data: ${JSON.stringify({
      activeWorkers: presence.rows[0].total,
      activeAlerts: alerts.rows[0].total,
      ts: new Date().toISOString()
    })}\n\n`);
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
