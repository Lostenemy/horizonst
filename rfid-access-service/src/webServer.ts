import express from 'express';
import session from 'express-session';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';

import { logger } from './logger.js';
import type { AccessEvaluationResult, SimulationRequest } from './types.js';

export interface WebInterfaceConfig {
  enabled: boolean;
  port: number;
  basePath: string;
  sessionSecret: string;
  username: string;
  password: string;
  historySize: number;
}

export interface HistoryEvent extends AccessEvaluationResult {
  cardId: string;
  mac: string;
  timestamp: string;
  source: 'mqtt' | 'web';
}

export interface WebInterfaceController {
  recordEvent: (event: HistoryEvent) => void;
  close: () => Promise<void>;
}

interface StartWebInterfaceOptions {
  config: WebInterfaceConfig;
  simulateScan: (input: SimulationRequest) => Promise<AccessEvaluationResult>;
}

const normalizeMacForDisplay = (mac: string): string => mac.trim().toLowerCase();

const buildHistoryRecorder = (history: HistoryEvent[], limit: number) => {
  return (event: HistoryEvent): void => {
    const normalizedEvent: HistoryEvent = {
      ...event,
      mac: normalizeMacForDisplay(event.mac)
    };

    history.unshift(normalizedEvent);
    if (history.length > limit) {
      history.length = limit;
    }
  };
};

export const startWebInterface = async ({
  config,
  simulateScan
}: StartWebInterfaceOptions): Promise<WebInterfaceController | null> => {
  if (!config.enabled) {
    return null;
  }

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  const basePath = config.basePath;
  const history: HistoryEvent[] = [];
  const recordEvent = buildHistoryRecorder(history, config.historySize);

  const router = express.Router();

  router.use(express.json({ limit: '1mb' }));

  router.use(
    session({
      secret: config.sessionSecret,
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        sameSite: 'lax',
        secure: false,
        path: basePath === '/' ? '/' : `${basePath}`
      }
    })
  );

  const ensureAuthenticated: express.RequestHandler = (req, res, next) => {
    if (req.session?.authenticated) {
      next();
      return;
    }

    res.status(401).json({ error: 'UNAUTHENTICATED' });
  };

  router.post('/api/login', (req, res) => {
    const { username, password } = req.body ?? {};

    if (typeof username !== 'string' || typeof password !== 'string') {
      res.status(400).json({ error: 'INVALID_CREDENTIALS' });
      return;
    }

    if (username !== config.username || password !== config.password) {
      logger.warn({ username }, 'Failed login attempt to RFID test interface');
      res.status(401).json({ error: 'INVALID_CREDENTIALS' });
      return;
    }

    if (req.session) {
      req.session.authenticated = true;
      req.session.username = username;
    }

    res.json({ authenticated: true, username });
  });

  router.post('/api/logout', ensureAuthenticated, (req, res) => {
    if (req.session) {
      req.session.destroy((error) => {
        if (error) {
          logger.error({ err: error }, 'Failed to destroy session on logout');
        }
      });
    }

    res.json({ authenticated: false });
  });

  router.get('/api/session', (req, res) => {
    res.json({
      authenticated: Boolean(req.session?.authenticated),
      username: req.session?.username ?? null
    });
  });

  router.get('/api/history', ensureAuthenticated, (_req, res) => {
    res.json({ history });
  });

  router.post('/api/simulate', ensureAuthenticated, async (req, res) => {
    const { cardId, mac, timestamp, additional } = req.body ?? {};

    if (typeof cardId !== 'string' || cardId.trim() === '') {
      res.status(400).json({ error: 'CARD_ID_REQUIRED' });
      return;
    }

    if (typeof mac !== 'string' || mac.trim() === '') {
      res.status(400).json({ error: 'MAC_REQUIRED' });
      return;
    }

    const normalizedMac = normalizeMacForDisplay(mac);
    const normalizedTimestamp =
      typeof timestamp === 'string' && timestamp.trim() !== ''
        ? timestamp
        : new Date().toISOString();

    let additionalData: Record<string, unknown> | undefined;
    if (additional && typeof additional === 'object') {
      additionalData = additional as Record<string, unknown>;
    }

    try {
      const evaluation = await simulateScan({
        cardId: cardId.trim(),
        mac: normalizedMac,
        timestamp: normalizedTimestamp,
        additional: additionalData
      });

      const event: HistoryEvent = {
        ...evaluation,
        cardId: cardId.trim(),
        mac: normalizedMac,
        timestamp: normalizedTimestamp,
        source: 'web'
      };

      recordEvent(event);
      res.json(event);
    } catch (error) {
      logger.error({ err: error }, 'Failed to simulate RFID scan via web interface');
      res.status(500).json({ error: 'SIMULATION_FAILED' });
    }
  });

  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const publicDir = path.join(currentDir, '..', 'public');

  const staticCacheControl = (filePath: string): string => {
    const ext = path.extname(filePath);
    if (ext === '.html') {
      return 'no-store';
    }

    if (ext === '.js') {
      return 'public, max-age=300, immutable';
    }

    if (ext === '.css' || ext === '.png' || ext === '.svg' || ext === '.ico') {
      return 'public, max-age=3600';
    }

    return 'public, max-age=300';
  };

  router.use(
    express.static(publicDir, {
      index: false,
      setHeaders: (res, servedPath) => {
        res.setHeader('Cache-Control', staticCacheControl(servedPath));
      }
    })
  );

  const indexTemplate = await readFile(path.join(publicDir, 'index.html'), 'utf8');
  const basePathForClient = basePath === '/' ? '' : basePath;

  router.get('*', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.type('html').send(indexTemplate.replace(/__BASE_PATH__/g, basePathForClient));
  });

  app.use(basePath, router);

  let controllerClose: () => Promise<void> = async () => {};

  await new Promise<void>((resolve, reject) => {
    const server = app
      .listen(config.port, '0.0.0.0', () => {
        logger.info({ port: config.port, basePath }, 'Web test interface listening');
        resolve();
      })
      .on('error', (error) => {
        reject(error);
      });

    // Attach close handler to controller closure
    controllerClose = () =>
      new Promise<void>((closeResolve, closeReject) => {
        server.close((closeError) => {
          if (closeError) {
            closeReject(closeError);
            return;
          }
          closeResolve();
        });
      });
  });

  return {
    recordEvent,
    close: () => controllerClose()
  };
};

