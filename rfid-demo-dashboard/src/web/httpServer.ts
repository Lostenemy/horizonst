import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import { createServer } from 'node:http';
import { config } from '../config.js';
import { createApiRouter } from './routes.js';
import { logger } from '../logger.js';

export const createHttpServer = () => {
  const app = express();
  app.use(cors({ origin: config.app.corsOrigin }));
  app.use(express.json({ limit: '1mb' }));

  app.use(createApiRouter());

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const publicDir = path.resolve(__dirname, '../../public');

  app.use(express.static(publicDir));

  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    logger.error('Unhandled HTTP error', { err: String(error) });
    res.status(500).json({ error: 'Internal server error' });
  });

  return createServer(app);
};
