import axios, { AxiosError } from 'axios';
import express from 'express';
import session from 'express-session';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';

import { logger } from './logger.js';
import { authenticateUser, createUser, deleteUser, ensureDefaultAdmin, listUsers, updateUser } from './authStore.js';
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

export interface EcoordinaConfig {
  url: string;
  user: string;
  token: string;
  brand: string;
  action: string;
  actionType: string;
  instance: string;
  inputFormat: string;
  outputFormat: string;
  timeoutMs: number;
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
  ecoordinaDefaults: EcoordinaConfig;
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
  ecoordinaDefaults,
  simulateScan
}: StartWebInterfaceOptions): Promise<WebInterfaceController | null> => {
  if (!config.enabled) {
    return null;
  }

  await ensureDefaultAdmin({ username: config.username, password: config.password, role: 'admin' });

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

  const ensureAdmin: express.RequestHandler = (req, res, next) => {
    if (req.session?.authenticated && req.session.role === 'admin') {
      next();
      return;
    }

    res.status(403).json({ error: 'FORBIDDEN' });
  };

  const asTrimmedString = (value: unknown): string => {
    return typeof value === 'string' ? value.trim() : '';
  };

  const pickStringOrDefault = (candidate: unknown, fallback: string): string => {
    const parsed = asTrimmedString(candidate);
    return parsed || fallback;
  };

  router.post('/api/login', async (req, res) => {
    const { username, password } = req.body ?? {};

    if (typeof username !== 'string' || typeof password !== 'string') {
      res.status(400).json({ error: 'INVALID_CREDENTIALS' });
      return;
    }

    const user = await authenticateUser(username, password);
    if (!user) {
      logger.warn({ username }, 'Failed login attempt to RFID test interface');
      res.status(401).json({ error: 'INVALID_CREDENTIALS' });
      return;
    }

    if (req.session) {
      req.session.authenticated = true;
      req.session.username = user.username;
      req.session.role = user.role;
    }

    res.json({ authenticated: true, username: user.username, role: user.role });
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
      username: req.session?.username ?? null,
      role: req.session?.role ?? null
    });
  });

  router.get('/api/auth/users', ensureAuthenticated, ensureAdmin, async (_req, res) => {
    const users = await listUsers();
    res.json({ users });
  });

  router.post('/api/auth/users', ensureAuthenticated, ensureAdmin, async (req, res) => {
    const { username, password, role, active = true } = req.body ?? {};

    if (typeof username !== 'string' || username.trim().length < 3) {
      res.status(400).json({ error: 'INVALID_USERNAME' });
      return;
    }

    if (typeof password !== 'string' || password.trim().length < 4) {
      res.status(400).json({ error: 'INVALID_PASSWORD' });
      return;
    }

    if (role !== 'admin' && role !== 'user') {
      res.status(400).json({ error: 'INVALID_ROLE' });
      return;
    }

    try {
      const user = await createUser(username.trim(), password.trim(), role, Boolean(active));
      res.status(201).json({ user });
    } catch (error) {
      const err = error as Error;
      if (err.message === 'USERNAME_EXISTS') {
        res.status(409).json({ error: 'USERNAME_EXISTS' });
        return;
      }

      logger.error({ err }, 'Failed to create app user');
      res.status(500).json({ error: 'USER_CREATION_FAILED' });
    }
  });

  router.patch('/api/auth/users/:username', ensureAuthenticated, ensureAdmin, async (req, res) => {
    const { username } = req.params;
    const { password, role, active } = req.body ?? {};

    const updates: { password?: string; role?: 'admin' | 'user'; active?: boolean } = {};

    if (password !== undefined) {
      if (typeof password !== 'string' || password.trim().length < 4) {
        res.status(400).json({ error: 'INVALID_PASSWORD' });
        return;
      }
      updates.password = password.trim();
    }

    if (role !== undefined) {
      if (role !== 'admin' && role !== 'user') {
        res.status(400).json({ error: 'INVALID_ROLE' });
        return;
      }
      updates.role = role;
    }

    if (active !== undefined) {
      updates.active = Boolean(active);
    }

    try {
      const user = await updateUser(username, updates);
      if (req.session?.username === username && updates.role) {
        req.session.role = updates.role;
      }
      res.json({ user });
    } catch (error) {
      const err = error as Error;
      if (err.message === 'NOT_FOUND') {
        res.status(404).json({ error: 'NOT_FOUND' });
        return;
      }
      if (err.message === 'LAST_ADMIN') {
        res.status(409).json({ error: 'LAST_ADMIN' });
        return;
      }
      logger.error({ err }, 'Failed to update app user');
      res.status(500).json({ error: 'USER_UPDATE_FAILED' });
    }
  });

  router.delete('/api/auth/users/:username', ensureAuthenticated, ensureAdmin, async (req, res) => {
    const { username } = req.params;

    if (req.session?.username === username) {
      res.status(400).json({ error: 'CANNOT_DELETE_SELF' });
      return;
    }

    try {
      await deleteUser(username);
      res.status(204).send();
    } catch (error) {
      const err = error as Error;
      if (err.message === 'NOT_FOUND') {
        res.status(404).json({ error: 'NOT_FOUND' });
        return;
      }
      if (err.message === 'LAST_ADMIN') {
        res.status(409).json({ error: 'LAST_ADMIN' });
        return;
      }
      logger.error({ err }, 'Failed to delete app user');
      res.status(500).json({ error: 'USER_DELETE_FAILED' });
    }
  });

  router.get('/api/ecoordina/defaults', ensureAuthenticated, (_req, res) => {
    res.json({ defaults: ecoordinaDefaults });
  });

  router.post('/api/ecoordina/test', ensureAuthenticated, async (req, res) => {
    const {
      url,
      user,
      token,
      brand,
      action,
      actionType,
      instance,
      inputFormat,
      outputFormat,
      centro_cod: centroCodRaw,
      empresa_cif: empresaCifRaw,
      trabajador_dni: trabajadorDniRaw
    } = req.body ?? {};

    const targetUrl = pickStringOrDefault(url, ecoordinaDefaults.url);
    const authUser = pickStringOrDefault(user, ecoordinaDefaults.user);
    const authToken = pickStringOrDefault(token, ecoordinaDefaults.token);
    const selectedBrand = pickStringOrDefault(brand, ecoordinaDefaults.brand);
    const selectedAction = pickStringOrDefault(action, ecoordinaDefaults.action);
    const selectedActionType = pickStringOrDefault(actionType, ecoordinaDefaults.actionType);
    const selectedInstance = pickStringOrDefault(instance, ecoordinaDefaults.instance);
    const selectedInput = pickStringOrDefault(inputFormat, ecoordinaDefaults.inputFormat);
    const selectedOutput = pickStringOrDefault(outputFormat, ecoordinaDefaults.outputFormat);

    const centroCod = pickStringOrDefault(centroCodRaw, '').toUpperCase();
    const empresaCif = pickStringOrDefault(empresaCifRaw, '').toUpperCase();
    const trabajadorDni = pickStringOrDefault(trabajadorDniRaw, '').toUpperCase();
    if (!targetUrl || !authUser || !authToken || !centroCod || !empresaCif || !trabajadorDni) {
      res.status(400).json({
        error: 'MISSING_FIELDS',
        required: [
          'url',
          'user',
          'token',
          'centro_cod',
          'empresa_cif',
          'trabajador_dni'
        ]
      });
      return;
    }

    const payloadData: Record<string, string> = {
      centro_cod: centroCod,
      empresa_cif: empresaCif,
      trabajador_dni: trabajadorDni
    };

    const form = new URLSearchParams();
    form.set('action', selectedAction);
    form.set('action_type', selectedActionType);
    form.set('brand', selectedBrand);
    form.set('data', JSON.stringify({ data: payloadData }));
    form.set('in', selectedInput);
    form.set('instance', selectedInstance);
    form.set('out', selectedOutput);
    form.set('user', authUser);
    form.set('token', authToken);

    const requestPreview = {
      url: targetUrl,
      action: selectedAction,
      actionType: selectedActionType,
      brand: selectedBrand,
      instance: selectedInstance,
      input: selectedInput,
      output: selectedOutput,
      user: authUser,
      centro_cod: centroCod,
      empresa_cif: empresaCif,
      trabajador_dni: trabajadorDni
    };

    try {
      const response = await axios.post<string>(targetUrl, form.toString(), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: ecoordinaDefaults.timeoutMs,
        responseType: 'text',
        validateStatus: () => true
      });

      const rawText = response.data ?? '';
      let parsed: unknown = null;
      if (rawText) {
        try {
          parsed = JSON.parse(rawText);
        } catch (error) {
          parsed = rawText;
        }
      }

      if (response.status < 200 || response.status >= 300) {
        res.status(response.status).json({
          error: 'ECOORDINA_REQUEST_FAILED',
          status: response.status,
          message: response.statusText,
          payload: requestPreview,
          raw: rawText,
          data: parsed
        });
        return;
      }

      res.json({
        status: response.status,
        payload: requestPreview,
        raw: rawText,
        data: parsed
      });
    } catch (error) {
      const err = error as AxiosError;
      const status = err.response?.status ?? 502;
      const rawText = typeof err.response?.data === 'string' ? err.response.data : undefined;
      res.status(status).json({
        error: err.code === 'ECONNABORTED' ? 'ECOORDINA_TIMEOUT' : 'ECOORDINA_UNAVAILABLE',
        message: err.message,
        payload: requestPreview,
        raw: rawText
      });
    }
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

  const htmlTemplates = new Map<string, string>();
  const basePathForClient = basePath === '/' ? '' : basePath;

  const renderHtml = async (fileName: string, res: express.Response): Promise<void> => {
    try {
      if (!htmlTemplates.has(fileName)) {
        const template = await readFile(path.join(publicDir, fileName), 'utf8');
        htmlTemplates.set(fileName, template);
      }
      const template = htmlTemplates.get(fileName) as string;
      res.setHeader('Cache-Control', 'no-store');
      res.type('html').send(template.replace(/__BASE_PATH__/g, basePathForClient));
    } catch (error) {
      logger.warn({ err: error, fileName }, 'Failed to render HTML template');
      res.status(404).send('Not found');
    }
  };

  router.get(['/', '/index.html'], (_req, res) => {
    void renderHtml('index.html', res);
  });

  router.get(['/elecnor-usuarios', '/elecnor-usuarios.html'], (_req, res) => {
    void renderHtml('elecnor-usuarios.html', res);
  });

  router.get(['/elecnor-tarjetas', '/elecnor-tarjetas.html'], (_req, res) => {
    void renderHtml('elecnor-tarjetas.html', res);
  });

  router.get(['/elecnor-cuentas', '/elecnor-cuentas.html'], (_req, res) => {
    void renderHtml('elecnor-cuentas.html', res);
  });

  router.get(['/elecnor-lecturas', '/elecnor-lecturas.html'], (_req, res) => {
    void renderHtml('elecnor-lecturas.html', res);
  });

  router.get(['/elecnor-webservice', '/elecnor-webservice.html'], (_req, res) => {
    void renderHtml('elecnor-webservice.html', res);
  });

  router.get(['/elecnor-seguimiento', '/elecnor-seguimiento.html'], (_req, res) => {
    void renderHtml('elecnor-seguimiento.html', res);
  });

  router.use(
    express.static(publicDir, {
      index: false,
      setHeaders: (res, servedPath) => {
        res.setHeader('Cache-Control', staticCacheControl(servedPath));
      }
    })
  );

  router.get('*', (_req, res) => {
    void renderHtml('index.html', res);
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

