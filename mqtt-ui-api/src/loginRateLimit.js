// Protección local del único login técnico; no participa en el tráfico MQTT.
// Para varias réplicas debe existir además un límite compartido en el perímetro.
export function createLoginRateLimit(now = Date.now) {
  let windowEnd = 0;
  let globalAttempts = 0;
  const attempts = new Map();
  return (req, res, next) => {
    const time = now();
    if (time >= windowEnd) {
      windowEnd = time + 15 * 60_000;
      globalAttempts = 0;
      attempts.clear();
    }
    const source = req.ip || req.socket.remoteAddress || 'unknown';
    const count = (attempts.get(source) || 0) + 1;
    globalAttempts += 1;
    if (attempts.size < 1000 || attempts.has(source)) attempts.set(source, count);
    res.setHeader('Cache-Control', 'no-store');
    if (count > 10 || globalAttempts > 120 || attempts.size >= 1000) {
      res.setHeader('Retry-After', String(Math.max(1, Math.ceil((windowEnd - time) / 1000))));
      return res.status(429).json({ error: 'rate_limit_exceeded' });
    }
    next();
  };
}
